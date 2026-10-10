import fs from "node:fs";
import https from "node:https";
import path from "path";
import { ZipArchive } from "archiver";
import _ from "lodash";
import moment from "moment";
import { ProxyAgent } from "proxy-agent";
import tempWrite from "temp-write";
import dnsPlugins from "../certbot/dns-plugins.json" with { type: "json" };
import { installPlugin } from "../lib/certbot.js";
import { explainCertbotFailure, readNewCertbotLog, snapshotCertbotLog } from "../lib/certbot-diagnostics.js";
import { applyAtomicCertificateFiles, runCertificateMutationWithRollback } from "../lib/certificate-transaction.js";
import { calculateCertificateLifecycle, normalizeCertificateLifecyclePolicy } from "../lib/certificate-lifecycle.js";
import { useLetsencryptServer, useLetsencryptStaging } from "../lib/config.js";
import error from "../lib/error.js";
import { restoreModelRow, snapshotModelRow } from "../lib/model-rollback.js";
import { withSharedMysqlLock } from "../lib/shared-database.js";
import utils from "../lib/utils.js";
import { debug, ssl as logger } from "../logger.js";
import certificateModel from "../models/certificate.js";
import deadHostModel from "../models/dead_host.js";
import proxyHostModel from "../models/proxy_host.js";
import redirectionHostModel from "../models/redirection_host.js";
import settingModel from "../models/setting.js";
import streamModel from "../models/stream.js";
import tokenModel from "../models/token.js";
import userModel from "../models/user.js";
import internalAuditLog from "./audit-log.js";
import internalHost from "./host.js";
import internalNginx from "./nginx.js";

const letsencryptConfig = "/etc/letsencrypt.ini";
const certbotCommand = "certbot";
const certbotLogsDir = "/data/logs";
const certbotWorkDir = "/tmp/letsencrypt-lib";

const omissions = () => {
	return ["is_deleted", "owner.is_deleted", "meta.dns_provider_credentials", "meta.certificate_key"];
};

const internalCertificate = {
	allowedSslFiles: ["certificate", "certificate_key", "intermediate_certificate"],
	intervalTimeout: 1000 * 60 * 60, // 1 hour
	interval: null,
	intervalProcessing: false,
	lifecycleInterval: null,
	lifecycleProcessing: false,
	lifecycleIntervalTimeout: 1000 * 60 * 60, // 1 hour
	renewBeforeExpirationBy: [30, "days"],

	initTimer: () => {
		logger.info("Let's Encrypt Renewal Timer initialized");
		internalCertificate.interval = setInterval(
			internalCertificate.processExpiringHosts,
			internalCertificate.intervalTimeout,
		);

		logger.info("Certificate Lifecycle Timer initialized");
		internalCertificate.lifecycleInterval = setInterval(
			internalCertificate.processCertificateLifecycle,
			internalCertificate.lifecycleIntervalTimeout,
		);

		// Run both maintenance passes at startup as well.
		internalCertificate.processExpiringHosts();
		internalCertificate.processCertificateLifecycle();
	},

	/**
	 * Triggered by a timer, this will check for expiring hosts and renew their ssl certs if required
	 */
	processExpiringHosts: async () => {
		if (internalCertificate.intervalProcessing) {
			return;
		}

		internalCertificate.intervalProcessing = true;
		try {
			await withSharedMysqlLock("npmi:certificate-maintenance", async () => {
				logger.info(
					`Renewing SSL certs expiring within ${internalCertificate.renewBeforeExpirationBy[0]} ${internalCertificate.renewBeforeExpirationBy[1]} ...`,
				);

			const expirationThreshold = moment()
				.add(internalCertificate.renewBeforeExpirationBy[0], internalCertificate.renewBeforeExpirationBy[1])
				.format("YYYY-MM-DD HH:mm:ss");

			const [certificates, usageMap] = await Promise.all([
				certificateModel
					.query()
					.where("is_deleted", 0)
					.andWhere("provider", "letsencrypt")
					.andWhere("expires_on", "<", expirationThreshold),
				internalCertificate.getUsageMap(),
			]);

			for (const certificate of certificates) {
				if ((usageMap.get(certificate.id) || 0) === 0) {
					logger.info(`Skipping renewal for unused Cert #${certificate.id}`);
					continue;
				}

				try {
					await internalCertificate.renew(
						{
							can: () => Promise.resolve({ permission_visibility: "all" }),
							token: tokenModel(),
						},
						{ id: certificate.id },
					);
				} catch (err) {
					logger.error(err.message);
				}
			}

				logger.info("Completed SSL cert renew process");
			}, 600);
		} catch (err) {
			logger.error(err);
		} finally {
			internalCertificate.intervalProcessing = false;
		}
	},

	getUsageMap: async () => {
		const countByCertificate = async (model) =>
			model
				.query()
				.select("certificate_id")
				.count("id as count")
				.where("is_deleted", 0)
				.andWhere("certificate_id", ">", 0)
				.groupBy("certificate_id");

		const resultSets = await Promise.all([
			countByCertificate(proxyHostModel),
			countByCertificate(redirectionHostModel),
			countByCertificate(deadHostModel),
			countByCertificate(streamModel),
		]);

		const usageMap = new Map();
		for (const rows of resultSets) {
			for (const row of rows) {
				const certificateId = Number.parseInt(row.certificate_id, 10);
				const count = Number.parseInt(row.count, 10) || 0;
				usageMap.set(certificateId, (usageMap.get(certificateId) || 0) + count);
			}
		}
		return usageMap;
	},

	getLifecyclePolicy: async () => {
		const row = await settingModel.query().where("id", "certificate-lifecycle").first();
		return normalizeCertificateLifecyclePolicy(row);
	},

	decorateLifecycle: (certificate, usageMap, policy) => {
		const state = calculateCertificateLifecycle({
			certificate,
			usageCount: usageMap.get(certificate.id) || 0,
			policy,
		});

		certificate.is_in_use = state.isInUse;
		certificate.usage_count = state.usageCount;
		certificate.unused_since = state.unusedSince;
		certificate.purge_eligible_on = state.purgeEligibleOn;
		certificate.auto_purge_eligible = state.autoPurgeEligible;
		return certificate;
	},

	processCertificateLifecycle: async () => {
		if (internalCertificate.lifecycleProcessing) {
			return;
		}

		internalCertificate.lifecycleProcessing = true;
		try {
			await withSharedMysqlLock("npmi:certificate-maintenance", async () => {
				const [policy, certificates, usageMap] = await Promise.all([
				internalCertificate.getLifecyclePolicy(),
				certificateModel.query().where("is_deleted", 0),
				internalCertificate.getUsageMap(),
			]);

			const now = new Date();
			for (const certificate of certificates) {
				const state = calculateCertificateLifecycle({
					certificate,
					usageCount: usageMap.get(certificate.id) || 0,
					policy,
					now,
				});
				const meta = _.cloneDeep(certificate.meta || {});
				let changed = false;

				if (state.isInUse) {
					if (meta.lifecycle_unused_since || meta.lifecycle_purge_after) {
						delete meta.lifecycle_unused_since;
						delete meta.lifecycle_purge_after;
						changed = true;
					}
				} else {
					if (meta.lifecycle_unused_since !== state.unusedSince) {
						meta.lifecycle_unused_since = state.unusedSince;
						changed = true;
					}
					if (meta.lifecycle_purge_after !== state.purgeEligibleOn) {
						meta.lifecycle_purge_after = state.purgeEligibleOn;
						changed = true;
					}
				}

				if (changed) {
					await certificateModel.query().patchAndFetchById(certificate.id, { meta });
				}

				if (state.shouldPurge) {
					try {
						await internalCertificate.purgeUnusedCertificate({ ...certificate, meta });
					} catch (err) {
						// One certificate must never stop lifecycle processing for every
						// other certificate. The next hourly pass will retry it.
						logger.error(`Auto-purge failed for Cert #${certificate.id}: ${err.message}`);
					}
				}
				}
			}, 600);
		} catch (err) {
			logger.error(`Certificate lifecycle processing failed: ${err.message}`);
		} finally {
			internalCertificate.lifecycleProcessing = false;
		}
	},

	purgeUnusedCertificate: async (certificate) => {
		// Usage can change between the lifecycle scan and purge. Re-check at the
		// final destructive boundary and abort if any host now references it.
		const usageMap = await internalCertificate.getUsageMap();
		if ((usageMap.get(certificate.id) || 0) > 0) {
			const fresh = await certificateModel.query().findById(certificate.id);
			if (fresh) {
				const meta = _.cloneDeep(fresh.meta || {});
				delete meta.lifecycle_unused_since;
				delete meta.lifecycle_purge_after;
				await certificateModel.query().patchAndFetchById(certificate.id, { meta });
			}
			logger.info(`Cancelled purge for Cert #${certificate.id}; it is in use again`);
			return false;
		}

		const fresh = await certificateModel.query().findById(certificate.id);
		if (!fresh || fresh.is_deleted) {
			return false;
		}

		if (fresh.provider === "letsencrypt") {
			const fullchain = `${internalCertificate.getLiveCertPath(fresh.id)}/fullchain.pem`;
			if (fs.existsSync(fullchain)) {
				await internalCertificate.revokeLetsEncryptSsl(fresh, true);
			} else {
				fs.rmSync(internalCertificate.getLiveCertPath(fresh.id), { recursive: true, force: true });
				fs.rmSync(`/etc/letsencrypt/archive/npm-${fresh.id}`, { recursive: true, force: true });
				fs.rmSync(`/etc/letsencrypt/renewal/npm-${fresh.id}.conf`, { force: true });
				fs.rmSync(`/etc/letsencrypt/credentials/credentials-${fresh.id}`, { force: true });
			}
		} else {
			fs.rmSync(`/data/custom_ssl/npm-${fresh.id}`, { recursive: true, force: true });
		}

		await certificateModel.query().deleteById(fresh.id);

		try {
			await internalAuditLog.add(
				{ token: { getUserId: () => 1 } },
				{
					action: "auto-purged",
					object_type: "certificate",
					object_id: fresh.id,
					meta: {
						system: true,
						provider: fresh.provider,
						domain_names: fresh.domain_names,
						unused_since: fresh.meta?.lifecycle_unused_since || null,
					},
				},
			);
		} catch (err) {
			logger.error(`Cert #${fresh.id} purged but audit logging failed: ${err.message}`);
		}

		logger.info(`Auto-purged unused Cert #${fresh.id}: ${fresh.nice_name}`);
		return true;
	},

	/**
	 * @param   {Access}  access
	 * @param   {Object}  data
	 * @returns {Promise}
	 */
	create: async (access, data) => {
		await access.can("certificates:create", data);
		data.owner_user_id = access.token.getUserId(1);

		if (data.provider === "letsencrypt") {
			data.nice_name = data.domain_names.join(", ");
		}

		// this command really should clean up and delete the cert if it can't fully succeed
		const certificate = await certificateModel.query().insertAndFetch(data);

		try {
			if (certificate.provider === "letsencrypt") {
				// Request a new Cert from LE. Let the fun begin.

				// 1. Find out any hosts that are using any of the hostnames in this cert
				// 2. Disable them in nginx temporarily
				// 3. Generate the LE config
				// 4. Request cert
				// 5. Remove LE config
				// 6. Re-instate previously disabled hosts

				// 1. Find out any hosts that are using any of the hostnames in this cert
				const inUseResult = await internalHost.getHostsWithDomains(certificate.domain_names);

				// 2. Disable them in nginx temporarily
				// DNS-01 retains the legacy host suspension behavior. HTTP-01 no
				// longer needs it: every host (including a private access-list host)
				// has a dedicated ACME location, as does the default server.
				if (certificate.meta?.dns_challenge) {
					await internalCertificate.disableInUseHosts(inUseResult);
				}

				const user = await userModel.query().where("is_deleted", 0).andWhere("id", data.owner_user_id).first();
				if (!user?.email) {
					throw new error.ValidationError(
						"A valid email address must be set on your user account to use Let's Encrypt",
					);
				}

				// With DNS challenge no config is needed, so skip 3 and 5.
				if (certificate.meta?.dns_challenge) {
					try {
						await internalNginx.reload();
						// 4. Request cert
						await internalCertificate.requestLetsEncryptSslWithDnsChallenge(certificate, user.email);
						await internalNginx.reload();
						// 6. Re-instate previously disabled hosts
						await internalCertificate.enableInUseHosts(inUseResult);
					} catch (err) {
						// In the event of failure, revert things and throw err back
						await internalCertificate.enableInUseHosts(inUseResult);
						await internalNginx.reload();
						throw err;
					}
				} else {
					// HTTP-01 now uses the NPMX-aware ACME location on the
					// existing host (or the fallback/default host). Creating a
					// second server_name used to cause conflicting virtual hosts
					// and could route validation into a private access list.
					// Never disable the real proxy to issue a certificate.
					await internalNginx.test();
					await internalCertificate.requestLetsEncryptSsl(certificate, user.email);
				}

				// At this point, the letsencrypt cert should exist on disk.
				// Lets get the expiry date from the file and update the row silently
				try {
					const certInfo = await internalCertificate.getCertificateInfoFromFile(
						`${internalCertificate.getLiveCertPath(certificate.id)}/fullchain.pem`,
					);
					const savedRow = await certificateModel
						.query()
						.patchAndFetchById(certificate.id, {
							expires_on: moment(certInfo.dates.to, "X").format("YYYY-MM-DD HH:mm:ss"),
						})
						.then(utils.omitRow(omissions()));

					// Add cert data for audit log
					savedRow.meta = _.assign({}, savedRow.meta, {
						letsencrypt_certificate: certInfo,
					});

					await internalCertificate.addCreatedAuditLog(access, certificate.id, savedRow);

					return savedRow;
				} catch (err) {
					// Delete the certificate from the database if it was not created successfully
					await certificateModel.query().deleteById(certificate.id);
					throw err;
				}
			}
		} catch (err) {
			// Delete the certificate here. This is a hard delete, since it never existed properly
			await certificateModel.query().deleteById(certificate.id);
			throw err;
		}

		data.meta = _.assign({}, data.meta || {}, certificate.meta);

		// Add to audit log
		await internalCertificate.addCreatedAuditLog(access, certificate.id, utils.omitRow(omissions())(data));

		return utils.omitRow(omissions())(certificate);
	},

	addCreatedAuditLog: async (access, certificate_id, meta) => {
		await internalAuditLog.add(access, {
			action: "created",
			object_type: "certificate",
			object_id: certificate_id,
			meta: meta,
		});
	},

	/**
	 * @param  {Access}  access
	 * @param  {Object}  data
	 * @param  {Number}  data.id
	 * @param  {String}  [data.email]
	 * @param  {String}  [data.name]
	 * @return {Promise}
	 */
	update: async (access, data) => {
		await access.can("certificates:update", data.id);
		const row = await internalCertificate.get(access, { id: data.id });

		if (row.id !== data.id) {
			// Sanity check that something crazy hasn't happened
			throw new error.InternalValidationError(
				`Certificate could not be updated, IDs do not match: ${row.id} !== ${data.id}`,
			);
		}

		const savedRow = await certificateModel
			.query()
			.patchAndFetchById(row.id, data)
			.then(utils.omitRow(omissions()));

		savedRow.meta = internalCertificate.cleanMeta(savedRow.meta);
		data.meta = internalCertificate.cleanMeta(data.meta);

		// Add row.nice_name for custom certs
		if (savedRow.provider === "other") {
			data.nice_name = savedRow.nice_name;
		}

		// Add to audit log
		await internalAuditLog.add(access, {
			action: "updated",
			object_type: "certificate",
			object_id: row.id,
			meta: _.omit(data, ["expires_on"]), // this prevents json circular reference because expires_on might be raw
		});

		return savedRow;
	},

	/**
	 * @param  {Access}   access
	 * @param  {Object}   data
	 * @param  {Number}   data.id
	 * @param  {Array}    [data.expand]
	 * @param  {Array}    [data.omit]
	 * @return {Promise}
	 */
	get: async (access, data) => {
		const accessData = await access.can("certificates:get", data.id);
		const query = certificateModel
			.query()
			.where("is_deleted", 0)
			.andWhere("id", data.id)
			.allowGraph("[owner,proxy_hosts,redirection_hosts,dead_hosts,streams]")
			.first();

		if (accessData.permission_visibility !== "all") {
			query.andWhere("owner_user_id", access.token.getUserId(1));
		}

		if (typeof data.expand !== "undefined" && data.expand !== null) {
			query.withGraphFetched(`[${data.expand.join(", ")}]`);
		}

		let row = await query.then(utils.omitRow(omissions()));
		if (!row?.id) {
			throw new error.ItemNotFoundError(data.id);
		}

		row = internalCertificate.cleanExpansions(row);
		const [usageMap, policy] = await Promise.all([
			internalCertificate.getUsageMap(),
			internalCertificate.getLifecyclePolicy(),
		]);
		row = internalCertificate.decorateLifecycle(row, usageMap, policy);

		if (typeof data.omit !== "undefined" && data.omit !== null) {
			return _.omit(row, [...data.omit]);
		}
		return row;
	},

	cleanExpansions: (row) => {
		if (typeof row.proxy_hosts !== "undefined") {
			row.proxy_hosts = utils.omitRows(["is_deleted"])(row.proxy_hosts);
		}
		if (typeof row.redirection_hosts !== "undefined") {
			row.redirection_hosts = utils.omitRows(["is_deleted"])(row.redirection_hosts);
		}
		if (typeof row.dead_hosts !== "undefined") {
			row.dead_hosts = utils.omitRows(["is_deleted"])(row.dead_hosts);
		}
		if (typeof row.streams !== "undefined") {
			row.streams = utils.omitRows(["is_deleted"])(row.streams);
		}
		return row;
	},

	/**
	 * @param   {Access}  access
	 * @param   {Object}  data
	 * @param   {Number}  data.id
	 * @returns {Promise}
	 */
	download: async (access, data) => {
		await access.can("certificates:get", data);
		const certificate = await internalCertificate.get(access, data);
		if (certificate.provider === "letsencrypt") {
			const zipDirectory = internalCertificate.getLiveCertPath(data.id);
			if (!fs.existsSync(zipDirectory)) {
				throw new error.ItemNotFoundError(`Certificate ${certificate.nice_name} does not exists`);
			}

			const certFiles = fs
				.readdirSync(zipDirectory)
				.filter((fn) => fn.endsWith(".pem"))
				.map((fn) => fs.realpathSync(path.join(zipDirectory, fn)));

			const downloadName = `npm-${data.id}-${Date.now()}.zip`;
			const opName = `/tmp/${downloadName}`;

			await internalCertificate.zipFiles(certFiles, opName);
			debug(logger, "zip completed : ", opName);
			return {
				fileName: opName,
			};
		}
		throw new error.ValidationError("Only Let'sEncrypt certificates can be downloaded");
	},

	/**
	 * @param   {String}  source
	 * @param   {String}  out
	 * @returns {Promise}
	 */
	zipFiles: async (source, out) => {
		const archive = new ZipArchive({ zlib: { level: 9 } });
		const stream = fs.createWriteStream(out);

		return new Promise((resolve, reject) => {
			source.map((fl) => {
				const fileName = path.basename(fl);
				debug(logger, fl, "added to certificate zip");
				archive.file(fl, { name: fileName });
				return true;
			});
			archive.on("error", (err) => reject(err)).pipe(stream);
			stream.on("close", () => resolve());
			archive.finalize();
		});
	},

	/**
	 * @param {Access}  access
	 * @param {Object}  data
	 * @param {Number}  data.id
	 * @param {String}  [data.reason]
	 * @returns {Promise}
	 */
	delete: async (access, data) => {
		await access.can("certificates:delete", data.id);
		const row = await internalCertificate.get(access, { id: data.id });

		if (!row?.id) {
			throw new error.ItemNotFoundError(data.id);
		}

		const usageMap = await internalCertificate.getUsageMap();
		const usageCount = usageMap.get(row.id) || 0;
		if (usageCount > 0) {
			throw new error.ValidationError(
				`Certificate is still referenced by ${usageCount} host${usageCount === 1 ? "" : "s"}`,
			);
		}

		if (row.provider === "letsencrypt") {
			const fullchain = `${internalCertificate.getLiveCertPath(row.id)}/fullchain.pem`;
			if (fs.existsSync(fullchain)) {
				await internalCertificate.revokeLetsEncryptSsl(row, true);
			} else {
				fs.rmSync(internalCertificate.getLiveCertPath(row.id), { recursive: true, force: true });
				fs.rmSync(`/etc/letsencrypt/archive/npm-${row.id}`, { recursive: true, force: true });
				fs.rmSync(`/etc/letsencrypt/renewal/npm-${row.id}.conf`, { force: true });
				fs.rmSync(`/etc/letsencrypt/credentials/credentials-${row.id}`, { force: true });
			}
		} else {
			fs.rmSync(`/data/custom_ssl/npm-${row.id}`, { recursive: true, force: true });
		}

		await certificateModel.query().where("id", row.id).patch({
			is_deleted: 1,
		});

		row.meta = internalCertificate.cleanMeta(row.meta);
		await internalAuditLog.add(access, {
			action: "deleted",
			object_type: "certificate",
			object_id: row.id,
			meta: _.omit(row, omissions()),
		});
		return true;
	},

	/**
	 * All Certs
	 *
	 * @param   {Access}  access
	 * @param   {Array}   [expand]
	 * @param   {String}  [searchQuery]
	 * @returns {Promise}
	 */
	getAll: async (access, expand, searchQuery) => {
		const accessData = await access.can("certificates:list");

		const query = certificateModel
			.query()
			.where("is_deleted", 0)
			.groupBy("id")
			.allowGraph("[owner,proxy_hosts,redirection_hosts,dead_hosts,streams]")
			.orderBy("nice_name", "ASC");

		if (accessData.permission_visibility !== "all") {
			query.andWhere("owner_user_id", access.token.getUserId(1));
		}

		if (typeof searchQuery === "string") {
			query.where(function () {
				this.where("nice_name", "like", `%${searchQuery}%`);
			});
		}

		if (typeof expand !== "undefined" && expand !== null) {
			query.withGraphFetched(`[${expand.join(", ")}]`);
		}

		const [rows, usageMap, policy] = await Promise.all([
			query.then(utils.omitRows(omissions())),
			internalCertificate.getUsageMap(),
			internalCertificate.getLifecyclePolicy(),
		]);

		for (let i = 0; i < rows.length; i++) {
			rows[i] = internalCertificate.decorateLifecycle(
				internalCertificate.cleanExpansions(rows[i]),
				usageMap,
				policy,
			);
		}
		return rows;
	},

	/**
	 * Report use
	 *
	 * @param   {Number}  userId
	 * @param   {String}  visibility
	 * @returns {Promise}
	 */
	getCount: async (userId, visibility) => {
		const query = certificateModel.query().count("id as count").where("is_deleted", 0);

		if (visibility !== "all") {
			query.andWhere("owner_user_id", userId);
		}

		const row = await query.first();
		return Number.parseInt(row.count, 10);
	},

	/**
	 * @param   {Object} certificate
	 * @returns {Promise}
	 */
	writeCustomCert: async (certificate) => {
		logger.info("Writing Custom Certificate:", certificate.id);

		if (certificate.provider === "letsencrypt") {
			throw new Error("Refusing to write letsencrypt certs here");
		}
		if (!certificate.meta?.certificate || !certificate.meta?.certificate_key) {
			throw new error.ValidationError("Both a certificate and private key are required");
		}

		let certData = certificate.meta.certificate;
		if (certificate.meta.intermediate_certificate) {
			certData = `${certData}\n${certificate.meta.intermediate_certificate}`;
		}

		const dir = `/data/custom_ssl/npm-${certificate.id}`;
		await applyAtomicCertificateFiles({
			files: [
				{ key: "fullchain", path: `${dir}/fullchain.pem`, content: certData, mode: 0o644 },
				{ key: "privkey", path: `${dir}/privkey.pem`, content: certificate.meta.certificate_key, mode: 0o600 },
			],
			validate: async (paths) => {
				await internalCertificate.getCertificateInfoFromFile(paths.fullchain, true);
				await internalCertificate.validateCertificatePairFiles(paths.fullchain, paths.privkey);
			},
			log: (message) => logger.error(message),
		});
	},

	/**
	 * @param   {Access}   access
	 * @param   {Object}   data
	 * @param   {Array}    data.domain_names
	 * @returns {Promise}
	 */
	createQuickCertificate: async (access, data) => {
		return await internalCertificate.create(access, {
			provider: "letsencrypt",
			domain_names: data.domain_names,
			meta: data.meta,
		});
	},

	/**
	 * Validates that the certs provided are good.
	 * No access required here, nothing is changed or stored.
	 *
	 * @param   {Object}  data
	 * @param   {Object}  data.files
	 * @returns {Promise}
	 */
	validate: (data) => {
		// Put file contents into an object
		const files = {};
		_.map(data.files, (file, name) => {
			if (internalCertificate.allowedSslFiles.indexOf(name) !== -1) {
				files[name] = file.data.toString();
			}
		});

		// For each file, create a temp file and write the contents to it
		// Then test it depending on the file type
		const promises = [];
		_.map(files, (content, type) => {
			promises.push(
				new Promise((resolve) => {
					if (type === "certificate_key") {
						resolve(internalCertificate.checkPrivateKey(content));
					} else {
						// this should handle `certificate` and intermediate certificate
						resolve(internalCertificate.getCertificateInfo(content, true));
					}
				}).then((res) => {
					return { [type]: res };
				}),
			);
		});

		return Promise.all(promises).then((files) => {
			let data = {};
			_.each(files, (file) => {
				data = _.assign({}, data, file);
			});
			return data;
		});
	},

	/**
	 * @param   {Access}  access
	 * @param   {Object}  data
	 * @param   {Number}  data.id
	 * @param   {Object}  data.files
	 * @returns {Promise}
	 */
	upload: async (access, data) => {
		const row = await internalCertificate.get(access, { id: data.id });
		if (row.provider !== "other") {
			throw new error.ValidationError("Cannot upload certificates for this type of provider");
		}

		const validations = await internalCertificate.validate(data);
		if (typeof validations.certificate === "undefined") {
			throw new error.ValidationError("Certificate file was not provided");
		}

		// Fetch the unfiltered row so an existing private key can be retained when
		// the upload only replaces the certificate/chain.
		const rawRow = await certificateModel.query().findById(data.id);
		if (!rawRow) {
			throw new error.ItemNotFoundError(data.id);
		}

		const mergedMeta = _.cloneDeep(rawRow.meta || {});
		_.map(data.files, (file, name) => {
			if (internalCertificate.allowedSslFiles.indexOf(name) !== -1) {
				mergedMeta[name] = file.data.toString();
			}
		});

		if (!mergedMeta.certificate || !mergedMeta.certificate_key) {
			throw new error.ValidationError("Both a certificate and private key are required");
		}

		let fullchain = mergedMeta.certificate;
		if (mergedMeta.intermediate_certificate) {
			fullchain = `${fullchain}\n${mergedMeta.intermediate_certificate}`;
		}

		const dir = `/data/custom_ssl/npm-${data.id}`;
		const fullchainPath = `${dir}/fullchain.pem`;
		const privkeyPath = `${dir}/privkey.pem`;
		const previousState = await snapshotModelRow(certificateModel, data.id);

		const newExpiresOn = moment(validations.certificate.dates.to, "X").format("YYYY-MM-DD HH:mm:ss");
		const newDomainNames = validations.certificate.cn ? [validations.certificate.cn] : [];

		await applyAtomicCertificateFiles({
			files: [
				{ key: "fullchain", path: fullchainPath, content: fullchain, mode: 0o644 },
				{ key: "privkey", path: privkeyPath, content: mergedMeta.certificate_key, mode: 0o600 },
			],
			validate: async (paths) => {
				await internalCertificate.getCertificateInfoFromFile(paths.fullchain, true);
				await internalCertificate.validateCertificatePairFiles(paths.fullchain, paths.privkey);
			},
			activate: () => internalNginx.reload(),
			commit: async () => {
				try {
					await certificateModel.query().patchAndFetchById(data.id, {
						expires_on: newExpiresOn,
						domain_names: newDomainNames,
						meta: mergedMeta,
					});
				} catch (err) {
					await restoreModelRow(certificateModel, data.id, previousState).catch((rollbackErr) => {
						err.databaseRollbackError = rollbackErr;
					});
					throw err;
				}
			},
			log: (message) => logger.error(message),
		});

		try {
			await internalAuditLog.add(access, {
				action: "updated",
				object_type: "certificate",
				object_id: data.id,
				meta: {
					domain_names: newDomainNames,
					expires_on: newExpiresOn,
					provider: "other",
				},
			});
		} catch (err) {
			// The certificate is already atomically committed and serving. Do not
			// falsely report the upload as failed solely because audit persistence
			// had a transient problem.
			logger.error(`Certificate #${data.id} committed but audit logging failed: ${err.message}`);
		}

		return _.pick(mergedMeta, internalCertificate.allowedSslFiles);
	},

	/**
	 * Uses the openssl command to validate the private key.
	 * It will save the file to disk first, then run commands on it, then delete the file.
	 *
	 * @param {String}  privateKey    This is the entire key contents as a string
	 */
	checkPrivateKey: async (privateKey) => {
		const filepath = await tempWrite(privateKey);
		const failTimeout = setTimeout(() => {
			throw new error.ValidationError(
				"Result Validation Error: Validation timed out. This could be due to the key being passphrase-protected.",
			);
		}, 10000);

		try {
			const result = await utils.exec(`openssl pkey -in ${filepath} -check -noout 2>&1 `);
			clearTimeout(failTimeout);
			if (!result.toLowerCase().includes("key is valid")) {
				throw new error.ValidationError(`Result Validation Error: ${result}`);
			}
			fs.unlinkSync(filepath);
			return true;
		} catch (err) {
			clearTimeout(failTimeout);
			fs.unlinkSync(filepath);
			throw new error.ValidationError(`Certificate Key is not valid (${err.message})`, err);
		}
	},

	/**
	 * Uses the openssl command to both validate and get info out of the certificate.
	 * It will save the file to disk first, then run commands on it, then delete the file.
	 *
	 * @param {String}  certificate      This is the entire cert contents as a string
	 * @param {Boolean} [throwExpired]  Throw when the certificate is out of date
	 */
	getCertificateInfo: async (certificate, throwExpired) => {
		const filepath = await tempWrite(certificate);
		try {
			const certData = await internalCertificate.getCertificateInfoFromFile(filepath, throwExpired);
			fs.unlinkSync(filepath);
			return certData;
		} catch (err) {
			fs.unlinkSync(filepath);
			throw err;
		}
	},

	/**
	 * Uses the openssl command to both validate and get info out of the certificate.
	 * It will save the file to disk first, then run commands on it, then delete the file.
	 *
	 * @param {String}  certificateFile The file location on disk
	 * @param {Boolean} [throw_expired]  Throw when the certificate is out of date
	 */
	getCertificateInfoFromFile: async (certificateFile, throw_expired) => {
		const certData = {};

		try {
			const result = await utils.execFile("openssl", ["x509", "-in", certificateFile, "-subject", "-noout"]);

			// Examples:
			// subject=CN = *.jc21.com
			// subject=CN = something.example.com
			// subject=CN=*.jc21.com
			const regex = /(?:subject=)?[^=]+=\s*(\S+)/gim;
			const match = regex.exec(result);
			if (match && typeof match[1] !== "undefined") {
				certData.cn = match[1].trim();
			}

			const result2 = await utils.execFile("openssl", ["x509", "-in", certificateFile, "-issuer", "-noout"]);
			// Examples:
			// issuer=C = US, O = Let's Encrypt, CN = Let's Encrypt Authority X3
			// issuer=C = US, O = Let's Encrypt, CN = E5
			// issuer=O = NginxProxyManager, CN = NginxProxyManager Intermediate CA","O = NginxProxyManager, CN = NginxProxyManager Intermediate CA
			const regex2 = /^(?:issuer=)?(.*)$/gim;
			const match2 = regex2.exec(result2);
			if (match2 && typeof match2[1] !== "undefined") {
				certData.issuer = match2[1];
			}

			const result3 = await utils.execFile("openssl", ["x509", "-in", certificateFile, "-dates", "-noout"]);
			// notBefore=Jul 14 04:04:29 2018 GMT
			// notAfter=Oct 12 04:04:29 2018 GMT
			let validFrom = null;
			let validTo = null;

			const lines = result3.split("\n");
			lines.map((str) => {
				const regex = /^(\S+)=(.*)$/gim;
				const match = regex.exec(str.trim());

				if (match && typeof match[2] !== "undefined") {
					const date = Number.parseInt(moment(match[2], "MMM DD HH:mm:ss YYYY z").format("X"), 10);

					if (match[1].toLowerCase() === "notbefore") {
						validFrom = date;
					} else if (match[1].toLowerCase() === "notafter") {
						validTo = date;
					}
				}
				return true;
			});

			if (!validFrom || !validTo) {
				throw new error.ValidationError(`Could not determine dates from certificate: ${result}`);
			}

			if (throw_expired && validTo < Number.parseInt(moment().format("X"), 10)) {
				throw new error.ValidationError("Certificate has expired");
			}

			certData.dates = {
				from: validFrom,
				to: validTo,
			};

			return certData;
		} catch (err) {
			throw new error.ValidationError(`Certificate is not valid (${err.message})`, err);
		}
	},

	/**
	 * Cleans the ssl keys from the meta object and sets them to "true"
	 *
	 * @param   {Object}  meta
	 * @param   {Boolean} [remove]
	 * @returns {Object}
	 */
	/**
	 * Verifies that a certificate file and private-key file are both valid and
	 * contain the same public key.
	 *
	 * @param {String} certificateFile
	 * @param {String} privateKeyFile
	 * @returns {Promise<Boolean>}
	 */
	validateCertificatePairFiles: async (certificateFile, privateKeyFile) => {
		try {
			const [certificatePublicKey, privateKeyPublicKey] = await Promise.all([
				utils.execFile("openssl", ["x509", "-in", certificateFile, "-pubkey", "-noout"]),
				utils.execFile("openssl", ["pkey", "-in", privateKeyFile, "-pubout"]),
			]);

			const normalize = (value) => value.replace(/\r/g, "").trim();
			if (normalize(certificatePublicKey) !== normalize(privateKeyPublicKey)) {
				throw new error.ValidationError("Certificate and private key do not match");
			}

			await utils.execFile("openssl", ["pkey", "-in", privateKeyFile, "-check", "-noout"]);
			return true;
		} catch (err) {
			if (err instanceof error.ValidationError) {
				throw err;
			}
			throw new error.ValidationError(`Certificate/private-key validation failed (${err.message})`, err);
		}
	},

	cleanMeta: (meta, remove) => {
		internalCertificate.allowedSslFiles.map((key) => {
			if (typeof meta[key] !== "undefined" && meta[key]) {
				if (remove) {
					delete meta[key];
				} else {
					meta[key] = true;
				}
			}
			return true;
		});
		return meta;
	},

	/**
	 * Request a certificate using the http challenge
	 * @param   {Object}  certificate   the certificate row
	 * @param   {String}  email         the email address to use for registration
	 * @returns {Promise}
	 */
	requestLetsEncryptSsl: async (certificate, email) => {
		logger.info(
			`Requesting LetsEncrypt certificates for Cert #${certificate.id}: ${certificate.domain_names.join(", ")}`,
		);

		const args = [
			"certonly",
			"-n", // non-interactive
			"--config",
			letsencryptConfig,
			"--work-dir",
			certbotWorkDir,
			"--logs-dir",
			certbotLogsDir,
			"--cert-name",
			`npm-${certificate.id}`,
			"--agree-tos",
			"--authenticator",
			"webroot",
			"-m",
			email,
			"--preferred-challenges",
			"http",
			"--domains",
			certificate.domain_names.join(","),
		];

		// Add key-type parameter if specified
		if (certificate.meta?.key_type) {
			args.push("--key-type", certificate.meta.key_type);
		}

		const adds = internalCertificate.getAdditionalCertbotArgs(certificate.id);
		args.push(...adds.args);

		logger.info(`Command: ${certbotCommand} ${args ? args.join(" ") : ""}`);

		const logSnapshot = snapshotCertbotLog();
		try {
			const result = await utils.execFile(certbotCommand, args, adds.opts);
			logger.success(result);
			return result;
		} catch (err) {
			const message = explainCertbotFailure(readNewCertbotLog(logSnapshot), certificate.domain_names);
			logger.error("Let's Encrypt HTTP-01 failed: " + message);
			throw new error.ValidationError(message, err);
		}
	},

	/**
	 * @param   {Object}   certificate  the certificate row
	 * @param   {String}   email        the email address to use for registration
	 * @returns {Promise}
	 */
	requestLetsEncryptSslWithDnsChallenge: async (certificate, email) => {
		await installPlugin(certificate.meta.dns_provider);
		const dnsPlugin = dnsPlugins[certificate.meta.dns_provider];
		logger.info(
			`Requesting LetsEncrypt certificates via ${dnsPlugin.name} for Cert #${certificate.id}: ${certificate.domain_names.join(", ")}`,
		);

		const credentialsLocation = `/etc/letsencrypt/credentials/credentials-${certificate.id}`;
		fs.mkdirSync("/etc/letsencrypt/credentials", { recursive: true });
		fs.writeFileSync(credentialsLocation, certificate.meta.dns_provider_credentials, { mode: 0o600 });

		// Whether the plugin has a --<name>-credentials argument
		const hasConfigArg = certificate.meta.dns_provider !== "route53";

		const args = [
			"certonly",
			"-n", // non-interactive
			"--config",
			letsencryptConfig,
			"--work-dir",
			certbotWorkDir,
			"--logs-dir",
			certbotLogsDir,
			"--cert-name",
			`npm-${certificate.id}`,
			"--agree-tos",
			"-m",
			email,
			"--preferred-challenges",
			"dns",
			"--domains",
			certificate.domain_names.join(","),
			"--authenticator",
			dnsPlugin.full_plugin_name,
		];

		if (hasConfigArg) {
			args.push(`--${dnsPlugin.full_plugin_name}-credentials`, credentialsLocation);
		}
		if (certificate.meta.propagation_seconds !== undefined) {
			args.push(
				`--${dnsPlugin.full_plugin_name}-propagation-seconds`,
				certificate.meta.propagation_seconds.toString(),
			);
		}

		// Add key-type parameter if specified
		if (certificate.meta?.key_type) {
			args.push("--key-type", certificate.meta.key_type);
		}

		const adds = internalCertificate.getAdditionalCertbotArgs(certificate.id, certificate.meta.dns_provider);
		args.push(...adds.args);

		logger.info(`Command: ${certbotCommand} ${args ? args.join(" ") : ""}`);

		const logSnapshot = snapshotCertbotLog();
		try {
			const result = await utils.execFile(certbotCommand, args, adds.opts);
			logger.info(result);
			return result;
		} catch (err) {
			const message = explainCertbotFailure(readNewCertbotLog(logSnapshot), certificate.domain_names);
			logger.error("Let's Encrypt DNS-01 failed: " + message);
			throw new error.ValidationError(message, err);
		} finally {
			// Remove the credentials file whether certbot succeeded or failed.
			//
			// This cleanup used to sit in a catch block, so it only ran when issuance FAILED.
			// A certificate that issued successfully left its DNS provider API credentials in
			// /etc/letsencrypt/credentials for the entire life of that certificate. Nothing
			// reads the file between certbot runs, so there is no reason to keep it:
			// renewLetsEncryptSslWithDnsChallenge() writes it again immediately before each
			// renewal.
			//
			// unlink is fire-and-forget with an empty callback. If the file is already gone
			// that is the end state we wanted anyway, and a missing file must never turn a
			// successful issuance into a failure.
			fs.unlink(credentialsLocation, () => {});
		}
	},

	/**
	 * @param   {Access}  access
	 * @param   {Object}  data
	 * @param   {Number}  data.id
	 * @returns {Promise}
	 */
	renew: async (access, data) => {
		await access.can("certificates:update", data);
		const certificate = await internalCertificate.get(access, data);

		if (certificate.provider !== "letsencrypt") {
			throw new error.ValidationError("Only Let'sEncrypt certificates can be renewed");
		}

		const renewMethod = certificate.meta.dns_challenge
			? internalCertificate.renewLetsEncryptSslWithDnsChallenge
			: internalCertificate.renewLetsEncryptSsl;

		const livePath = internalCertificate.getLiveCertPath(certificate.id);
		const certificatePaths = [
			`${livePath}/cert.pem`,
			`${livePath}/chain.pem`,
			`${livePath}/fullchain.pem`,
			`${livePath}/privkey.pem`,
		];
		const previousState = await snapshotModelRow(certificateModel, certificate.id);
		let certInfo = null;
		let updatedCertificate = null;

		await runCertificateMutationWithRollback({
			paths: certificatePaths,
			mutate: () => renewMethod(certificate),
			validate: async () => {
				certInfo = await internalCertificate.getCertificateInfoFromFile(`${livePath}/fullchain.pem`, true);
				await internalCertificate.validateCertificatePairFiles(
					`${livePath}/fullchain.pem`,
					`${livePath}/privkey.pem`,
				);
			},
			activate: () => internalNginx.reload(),
			commit: async () => {
				updatedCertificate = await certificateModel.query().patchAndFetchById(certificate.id, {
					expires_on: moment(certInfo.dates.to, "X").format("YYYY-MM-DD HH:mm:ss"),
				});
			},
			rollbackCommit: () => restoreModelRow(certificateModel, certificate.id, previousState),
			log: (message) => logger.error(message),
		});

		try {
			await internalAuditLog.add(access, {
				action: "renewed",
				object_type: "certificate",
				object_id: updatedCertificate.id,
				meta: updatedCertificate,
			});
		} catch (err) {
			logger.error(`Certificate #${certificate.id} renewed but audit logging failed: ${err.message}`);
		}

		return updatedCertificate;
	},

	/**
	 * @param   {Object}  certificate   the certificate row
	 * @returns {Promise}
	 */
	renewLetsEncryptSsl: async (certificate) => {
		logger.info(
			`Renewing LetsEncrypt certificates for Cert #${certificate.id}: ${certificate.domain_names.join(", ")}`,
		);

		const args = [
			"renew",
			"--force-renewal",
			"--config",
			letsencryptConfig,
			"--work-dir",
			certbotWorkDir,
			"--logs-dir",
			certbotLogsDir,
			"--cert-name",
			`npm-${certificate.id}`,
			"--preferred-challenges",
			"http",
			"--no-random-sleep-on-renew",
			"--disable-hook-validation",
		];

		// Add key-type parameter if specified
		if (certificate.meta?.key_type) {
			args.push("--key-type", certificate.meta.key_type);
		}

		const adds = internalCertificate.getAdditionalCertbotArgs(certificate.id, certificate.meta.dns_provider);
		args.push(...adds.args);

		logger.info(`Command: ${certbotCommand} ${args ? args.join(" ") : ""}`);

		const result = await utils.execFile(certbotCommand, args, adds.opts);
		logger.info(result);
		return result;
	},

	/**
	 * @param   {Object}  certificate   the certificate row
	 * @returns {Promise}
	 */
	renewLetsEncryptSslWithDnsChallenge: async (certificate) => {
		const dnsPlugin = dnsPlugins[certificate.meta.dns_provider];
		if (!dnsPlugin) {
			throw Error(`Unknown DNS provider '${certificate.meta.dns_provider}'`);
		}

		logger.info(
			`Renewing LetsEncrypt certificates via ${dnsPlugin.name} for Cert #${certificate.id}: ${certificate.domain_names.join(", ")}`,
		);

		// certbot reads the DNS credentials back from the path recorded in the renewal config
		// it wrote at issuance time, for example:
		//
		//     authenticator = dns-cloudflare
		//     dns_cloudflare_credentials = /etc/letsencrypt/credentials/credentials-27
		//
		// so the file has to be present for the duration of this run. Write it here and remove
		// it again below rather than leaving it on disk between renewals.
		//
		// Leaving it is an avoidable exposure. Anything running as root - a compromised
		// process, a script, malware - can read the token and use it to issue valid Let's
		// Encrypt certificates for the domain. Those certificates are genuinely trusted, so
		// traffic presented with them passes TLS inspection, IDS/IPS and DLP that would
		// otherwise flag it, and an exfiltration path built on them looks like ordinary
		// HTTPS. The exposure window should be one certbot run, not the life of the
		// certificate.
		//
		// The value is not on the certificate object we were handed: renew() sources that from
		// internalCertificate.get(), which pipes the row through utils.omitRow(omissions()) so
		// meta.dns_provider_credentials can never travel out over the API. Read the row from
		// the model directly to get at it.
		const row = await certificateModel.query().where("id", certificate.id).first();
		const credentials = row?.meta?.dns_provider_credentials;
		const credentialsLocation = `/etc/letsencrypt/credentials/credentials-${certificate.id}`;

		if (credentials) {
			fs.mkdirSync("/etc/letsencrypt/credentials", { recursive: true });
			fs.writeFileSync(credentialsLocation, credentials, { mode: 0o600 });
		} else {
			// Nothing stored to write. A certificate issued under the previous behaviour may
			// still have its file on disk; leave it be and let certbot decide. Throwing here
			// would break a renewal that would otherwise have succeeded.
			logger.warn(
				`No stored DNS credentials for Cert #${certificate.id}; relying on any existing ${credentialsLocation}`,
			);
		}

		const args = [
			"renew",
			"--force-renewal",
			"--config",
			letsencryptConfig,
			"--work-dir",
			certbotWorkDir,
			"--logs-dir",
			certbotLogsDir,
			"--cert-name",
			`npm-${certificate.id}`,
			"--preferred-challenges",
			"dns",
			"--disable-hook-validation",
			"--no-random-sleep-on-renew",
		];

		// Add key-type parameter if specified
		if (certificate.meta?.key_type) {
			args.push("--key-type", certificate.meta.key_type);
		}

		const adds = internalCertificate.getAdditionalCertbotArgs(certificate.id, certificate.meta.dns_provider);
		args.push(...adds.args);

		logger.info(`Command: ${certbotCommand} ${args ? args.join(" ") : ""}`);

		try {
			const result = await utils.execFile(certbotCommand, args, adds.opts);
			logger.info(result);
			return result;
		} finally {
			// Only clean up a file we put there ourselves. If `credentials` came back empty we
			// wrote nothing, and an older file left on disk by the previous behaviour is the
			// only thing keeping that certificate renewable - deleting it would break the next
			// run for no gain.
			if (credentials) {
				fs.unlink(credentialsLocation, () => {});
			}
		}
	},

	/**
	 * @param   {Object}  certificate    the certificate row
	 * @param   {Boolean} [throwErrors]
	 * @returns {Promise}
	 */
	revokeLetsEncryptSsl: async (certificate, throwErrors) => {
		logger.info(
			`Revoking LetsEncrypt certificates for Cert #${certificate.id}: ${certificate.domain_names.join(", ")}`,
		);

		const args = [
			"revoke",
			"--config",
			letsencryptConfig,
			"--work-dir",
			certbotWorkDir,
			"--logs-dir",
			certbotLogsDir,
			"--cert-path",
			`${internalCertificate.getLiveCertPath(certificate.id)}/fullchain.pem`,
			"--delete-after-revoke",
		];

		const adds = internalCertificate.getAdditionalCertbotArgs(certificate.id);
		args.push(...adds.args);

		logger.info(`Command: ${certbotCommand} ${args ? args.join(" ") : ""}`);

		try {
			const result = await utils.execFile(certbotCommand, args, adds.opts);
			await utils.exec(`rm -f '/etc/letsencrypt/credentials/credentials-${certificate.id}' || true`);
			logger.info(result);
			return result;
		} catch (err) {
			logger.error(err.message);
			if (throwErrors) {
				throw err;
			}
		}
	},

	/**
	 * @param   {Object}  certificate
	 * @returns {Boolean}
	 */
	hasLetsEncryptSslCerts: (certificate) => {
		const letsencryptPath = internalCertificate.getLiveCertPath(certificate.id);
		return fs.existsSync(`${letsencryptPath}/fullchain.pem`) && fs.existsSync(`${letsencryptPath}/privkey.pem`);
	},

	/**
	 * @param   {Object}  inUseResult
	 * @param   {Number}  inUseResult.total_count
	 * @param   {Array}   inUseResult.proxy_hosts
	 * @param   {Array}   inUseResult.redirection_hosts
	 * @param   {Array}   inUseResult.dead_hosts
	 * @returns {Promise}
	 */
	disableInUseHosts: async (inUseResult) => {
		if (inUseResult?.total_count) {
			if (inUseResult?.proxy_hosts.length) {
				await internalNginx.bulkDeleteConfigs("proxy_host", inUseResult.proxy_hosts);
			}

			if (inUseResult?.redirection_hosts.length) {
				await internalNginx.bulkDeleteConfigs("redirection_host", inUseResult.redirection_hosts);
			}

			if (inUseResult?.dead_hosts.length) {
				await internalNginx.bulkDeleteConfigs("dead_host", inUseResult.dead_hosts);
			}
		}
	},

	/**
	 * @param   {Object}  inUseResult
	 * @param   {Number}  inUseResult.total_count
	 * @param   {Array}   inUseResult.proxy_hosts
	 * @param   {Array}   inUseResult.redirection_hosts
	 * @param   {Array}   inUseResult.dead_hosts
	 * @returns {Promise}
	 */
	enableInUseHosts: async (inUseResult) => {
		if (inUseResult.total_count) {
			if (inUseResult.proxy_hosts.length) {
				await internalNginx.bulkGenerateConfigs("proxy_host", inUseResult.proxy_hosts);
			}

			if (inUseResult.redirection_hosts.length) {
				await internalNginx.bulkGenerateConfigs("redirection_host", inUseResult.redirection_hosts);
			}

			if (inUseResult.dead_hosts.length) {
				await internalNginx.bulkGenerateConfigs("dead_host", inUseResult.dead_hosts);
			}
		}
	},

	/**
	 *
	 * @param   {Object}    payload
	 * @param   {string[]}  payload.domains
	 * @returns
	 */
	testHttpsChallenge: async (access, payload) => {
		await access.can("certificates:list");

		// Create a test challenge file
		const testChallengeDir = "/data/letsencrypt-acme-challenge/.well-known/acme-challenge";
		const testChallengeFile = `${testChallengeDir}/test-challenge`;
		fs.mkdirSync(testChallengeDir, { recursive: true });
		fs.writeFileSync(testChallengeFile, "Success", { encoding: "utf8" });

		const results = {};
		for (const domain of payload.domains) {
			results[domain] = await internalCertificate.performTestForDomain(domain);
		}

		// Remove the test challenge file
		fs.unlinkSync(testChallengeFile);

		return results;
	},

	performTestForDomain: async (domain) => {
		logger.info(`Testing http challenge for ${domain}`);
		const agent = new ProxyAgent();
		const url = `http://${domain}/.well-known/acme-challenge/test-challenge`;
		const formBody = `method=G&url=${encodeURI(url)}&bodytype=T&requestbody=&headername=User-Agent&headervalue=None&locationid=1&ch=false&cc=false`;
		const options = {
			method: "POST",
			headers: {
				"User-Agent": "Mozilla/5.0",
				"Content-Type": "application/x-www-form-urlencoded",
				"Content-Length": Buffer.byteLength(formBody),
			},
			agent,
		};

		const result = await new Promise((resolve) => {
			const req = https.request("https://www.site24x7.com/tools/restapi-tester", options, (res) => {
				let responseBody = "";

				res.on("data", (chunk) => {
					responseBody = responseBody + chunk;
				});

				res.on("end", () => {
					try {
						const parsedBody = JSON.parse(`${responseBody}`);
						if (res.statusCode !== 200) {
							logger.warn(
								`Failed to test HTTP challenge for domain ${domain} because HTTP status code ${res.statusCode} was returned: ${parsedBody.message}`,
							);
							resolve(undefined);
						} else {
							resolve(parsedBody);
						}
					} catch (err) {
						if (res.statusCode !== 200) {
							logger.warn(
								`Failed to test HTTP challenge for domain ${domain} because HTTP status code ${res.statusCode} was returned`,
							);
						} else {
							logger.warn(
								`Failed to test HTTP challenge for domain ${domain} because response failed to be parsed: ${err.message}`,
							);
						}
						resolve(undefined);
					}
				});
			});

			// Make sure to write the request body.
			req.write(formBody);
			req.end();
			req.on("error", (e) => {
				logger.warn(`Failed to test HTTP challenge for domain ${domain}`, e);
				resolve(undefined);
			});
		});

		if (!result) {
			// Some error occurred while trying to get the data
			return "failed";
		}
		if (result.error) {
			logger.info(
				`HTTP challenge test failed for domain ${domain} because error was returned: ${result.error.msg}`,
			);
			return `other:${result.error.msg}`;
		}
		if (`${result.responsecode}` === "200" && result.htmlresponse === "Success") {
			// Server exists and has responded with the correct data
			return "ok";
		}
		if (`${result.responsecode}` === "200") {
			// Server exists but has responded with wrong data
			logger.info(
				`HTTP challenge test failed for domain ${domain} because of invalid returned data:`,
				result.htmlresponse,
			);
			return "wrong-data";
		}
		if (`${result.responsecode}` === "404") {
			// Server exists but responded with a 404
			logger.info(`HTTP challenge test failed for domain ${domain} because code 404 was returned`);
			return "404";
		}
		if (
			`${result.responsecode}` === "0" ||
			(typeof result.reason === "string" && result.reason.toLowerCase() === "host unavailable")
		) {
			// Server does not exist at domain
			logger.info(`HTTP challenge test failed for domain ${domain} the host was not found`);
			return "no-host";
		}
		// Other errors
		logger.info(`HTTP challenge test failed for domain ${domain} because code ${result.responsecode} was returned`);
		return `other:${result.responsecode}`;
	},

	getAdditionalCertbotArgs: (certificate_id, dns_provider) => {
		const args = [];
		if (useLetsencryptServer() !== null) {
			args.push("--server", useLetsencryptServer());
		}
		if (useLetsencryptStaging() && useLetsencryptServer() === null) {
			args.push("--staging");
		}

		// For route53, add the credentials file as an environment variable,
		// inheriting the process env
		const opts = {};
		if (certificate_id && dns_provider === "route53") {
			opts.env = process.env;
			opts.env.AWS_CONFIG_FILE = `/etc/letsencrypt/credentials/credentials-${certificate_id}`;
		}

		if (dns_provider === "duckdns") {
			args.push("--dns-duckdns-no-txt-restore");
		}

		return { args: args, opts: opts };
	},

	getLiveCertPath: (certificateId) => {
		return `/etc/letsencrypt/live/npm-${certificateId}`;
	},
};

export default internalCertificate;
