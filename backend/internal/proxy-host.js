import _ from "lodash";
import errs from "../lib/error.js";
import { castJsonIfNeed } from "../lib/helpers.js";
import { deleteUncommittedRow, restoreModelRow, snapshotModelRow } from "../lib/model-rollback.js";
import utils from "../lib/utils.js";
import proxyHostModel from "../models/proxy_host.js";
import internalAuditLog from "./audit-log.js";
import internalCertificate from "./certificate.js";
import internalHost from "./host.js";
import internalNginx from "./nginx.js";

const omissions = () => {
	return ["is_deleted", "owner.is_deleted"];
};

const internalProxyHost = {
	/**
	 * @param   {Access}  access
	 * @param   {Object}  data
	 * @returns {Promise}
	 */
	create: async (access, data) => {
		let thisData = { ...data };
		const createCertificate = thisData.certificate_id === "new";
		if (createCertificate) {
			delete thisData.certificate_id;
		}

		await access.can("proxy_hosts:create", thisData);

		const checks = await Promise.all(thisData.domain_names.map((domainName) => internalHost.isHostnameTaken(domainName)));
		for (const result of checks) {
			if (result.is_taken) {
				throw new errs.ValidationError(`${result.hostname} is already in use`);
			}
		}

		thisData.owner_user_id = access.token.getUserId(1);
		thisData = internalHost.cleanSslHstsData(thisData);
		if (typeof thisData.advanced_config === "undefined") {
			thisData.advanced_config = "";
		}

		const row = await proxyHostModel.query().insertAndFetch(thisData).then(utils.omitRow(omissions()));
		let freshRow;

		try {
			if (createCertificate) {
				const cert = await internalCertificate.createQuickCertificate(access, thisData);
				thisData.certificate_id = cert.id;
				await proxyHostModel.query().where("id", row.id).patch({ certificate_id: cert.id });
			}

			freshRow = await internalProxyHost.get(access, {
				id: row.id,
				expand: ["certificate", "owner", "access_list.[clients,items]"],
			});

			if (freshRow.enabled) {
				const newMeta = await internalNginx.configure(proxyHostModel, "proxy_host", freshRow);
				freshRow.meta = newMeta;
			}
		} catch (err) {
			await deleteUncommittedRow(proxyHostModel, row.id).catch((rollbackErr) => {
				debug(console, "Failed to remove uncommitted proxy host:", rollbackErr.message);
			});
			throw err;
		}

		thisData.meta = _.assign({}, thisData.meta || {}, freshRow.meta);
		await internalAuditLog.add(access, {
			action: "created",
			object_type: "proxy-host",
			object_id: freshRow.id,
			meta: thisData,
		});

		return freshRow;
	},

	/**
	 * @param  {Access}  access
	 * @param  {Object}  data
	 * @param  {Number}  data.id
	 * @return {Promise}
	 */
	update: async (access, data) => {
		let thisData = { ...data };
		const createCertificate = thisData.certificate_id === "new";
		if (createCertificate) {
			delete thisData.certificate_id;
		}

		await access.can("proxy_hosts:update", thisData.id);

		if (typeof thisData.domain_names !== "undefined") {
			const checks = await Promise.all(
				thisData.domain_names.map((domainName) => internalHost.isHostnameTaken(domainName, "proxy", thisData.id)),
			);
			for (const result of checks) {
				if (result.is_taken) {
					throw new errs.ValidationError(`${result.hostname} is already in use`);
				}
			}
		}

		const currentRow = await internalProxyHost.get(access, { id: thisData.id });
		if (currentRow.id !== thisData.id) {
			throw new errs.InternalValidationError(
				`Proxy Host could not be updated, IDs do not match: ${currentRow.id} !== ${thisData.id}`,
			);
		}
		const previousState = await snapshotModelRow(proxyHostModel, currentRow.id);

		if (createCertificate) {
			const cert = await internalCertificate.createQuickCertificate(access, {
				domain_names: thisData.domain_names || currentRow.domain_names,
				meta: _.assign({}, currentRow.meta, thisData.meta),
			});
			thisData.certificate_id = cert.id;
		}

		thisData = _.assign({}, { domain_names: currentRow.domain_names }, thisData);
		thisData = internalHost.cleanSslHstsData(thisData, currentRow);

		await proxyHostModel.query().where({ id: thisData.id }).patch(thisData);

		let updatedRow;
		try {
			updatedRow = await internalProxyHost.get(access, {
				id: thisData.id,
				expand: ["owner", "certificate", "access_list.[clients,items]"],
			});

			if (updatedRow.enabled) {
				const newMeta = await internalNginx.configure(proxyHostModel, "proxy_host", updatedRow);
				updatedRow.meta = newMeta;
			}
		} catch (err) {
			await restoreModelRow(proxyHostModel, currentRow.id, previousState);
			throw err;
		}

		await internalAuditLog.add(access, {
			action: "updated",
			object_type: "proxy-host",
			object_id: currentRow.id,
			meta: thisData,
		});

		return _.omit(internalHost.cleanRowCertificateMeta(updatedRow), omissions());
	},

	/**
	 * @param  {Access}   access
	 * @param  {Object}   data
	 * @param  {Number}   data.id
	 * @param  {Array}    [data.expand]
	 * @param  {Array}    [data.omit]
	 * @return {Promise}
	 */
	get: (access, data) => {
		const thisData = data || {};
		return access
			.can("proxy_hosts:get", thisData.id)
			.then((access_data) => {
				const query = proxyHostModel
					.query()
					.where("is_deleted", 0)
					.andWhere("id", thisData.id)
					.allowGraph(proxyHostModel.defaultAllowGraph)
					.first();

				if (access_data.permission_visibility !== "all") {
					query.andWhere("owner_user_id", access.token.getUserId(1));
				}

				if (typeof thisData.expand !== "undefined" && thisData.expand !== null) {
					query.withGraphFetched(`[${thisData.expand.join(", ")}]`);
				}

				return query.then(utils.omitRow(omissions()));
			})
			.then((row) => {
				if (!row?.id) {
					throw new errs.ItemNotFoundError(thisData.id);
				}
				const thisRow = internalHost.cleanRowCertificateMeta(row);
				// Custom omissions
				if (typeof thisData.omit !== "undefined" && thisData.omit !== null) {
					return _.omit(row, thisData.omit);
				}
				return thisRow;
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
		await access.can("proxy_hosts:delete", data.id);
		const row = await internalProxyHost.get(access, { id: data.id });
		if (!row?.id) {
			throw new errs.ItemNotFoundError(data.id);
		}

		const previousState = await snapshotModelRow(proxyHostModel, row.id);
		await proxyHostModel.query().where("id", row.id).patch({ is_deleted: 1 });

		try {
			await internalNginx.removeConfigTransactional("proxy_host", row);
		} catch (err) {
			await restoreModelRow(proxyHostModel, row.id, previousState);
			throw err;
		}

		await internalAuditLog.add(access, {
			action: "deleted",
			object_type: "proxy-host",
			object_id: row.id,
			meta: _.omit(row, omissions()),
		});
		return true;
	},

	/**
	 * @param {Access}  access
	 * @param {Object}  data
	 * @param {Number}  data.id
	 * @param {String}  [data.reason]
	 * @returns {Promise}
	 */
	enable: async (access, data) => {
		await access.can("proxy_hosts:update", data.id);
		const row = await internalProxyHost.get(access, {
			id: data.id,
			expand: ["certificate", "owner", "access_list"],
		});
		if (!row?.id) {
			throw new errs.ItemNotFoundError(data.id);
		}
		if (row.enabled) {
			throw new errs.ValidationError("Host is already enabled");
		}

		const previousState = await snapshotModelRow(proxyHostModel, row.id);
		row.enabled = 1;
		await proxyHostModel.query().where("id", row.id).patch({ enabled: 1 });

		try {
			await internalNginx.configure(proxyHostModel, "proxy_host", row);
		} catch (err) {
			await restoreModelRow(proxyHostModel, row.id, previousState);
			throw err;
		}

		await internalAuditLog.add(access, {
			action: "enabled",
			object_type: "proxy-host",
			object_id: row.id,
			meta: _.omit(row, omissions()),
		});
		return true;
	},

	/**
	 * @param {Access}  access
	 * @param {Object}  data
	 * @param {Number}  data.id
	 * @param {String}  [data.reason]
	 * @returns {Promise}
	 */
	disable: async (access, data) => {
		await access.can("proxy_hosts:update", data.id);
		const row = await internalProxyHost.get(access, { id: data.id });
		if (!row?.id) {
			throw new errs.ItemNotFoundError(data.id);
		}
		if (!row.enabled) {
			throw new errs.ValidationError("Host is already disabled");
		}

		const previousState = await snapshotModelRow(proxyHostModel, row.id);
		row.enabled = 0;
		await proxyHostModel.query().where("id", row.id).patch({ enabled: 0 });

		try {
			await internalNginx.removeConfigTransactional("proxy_host", row);
		} catch (err) {
			await restoreModelRow(proxyHostModel, row.id, previousState);
			throw err;
		}

		await internalAuditLog.add(access, {
			action: "disabled",
			object_type: "proxy-host",
			object_id: row.id,
			meta: _.omit(row, omissions()),
		});
		return true;
	},

	/**
	 * All Hosts
	 *
	 * @param   {Access}  access
	 * @param   {Array}   [expand]
	 * @param   {String}  [search_query]
	 * @returns {Promise}
	 */
	getAll: async (access, expand, searchQuery) => {
		const accessData = await access.can("proxy_hosts:list");

		const query = proxyHostModel
			.query()
			.where("is_deleted", 0)
			.groupBy("id")
			.allowGraph(proxyHostModel.defaultAllowGraph)
			.orderBy(castJsonIfNeed("domain_names"), "ASC");

		if (accessData.permission_visibility !== "all") {
			query.andWhere("owner_user_id", access.token.getUserId(1));
		}

		// Query is used for searching
		if (typeof searchQuery === "string" && searchQuery.length > 0) {
			query.where(function () {
				this.where(castJsonIfNeed("domain_names"), "like", `%${searchQuery}%`);
			});
		}

		if (typeof expand !== "undefined" && expand !== null) {
			query.withGraphFetched(`[${expand.join(", ")}]`);
		}

		const rows = await query.then(utils.omitRows(omissions()));
		if (typeof expand !== "undefined" && expand !== null && expand.indexOf("certificate") !== -1) {
			return internalHost.cleanAllRowsCertificateMeta(rows);
		}
		return rows;
	},

	/**
	 * Report use
	 *
	 * @param   {Number}  user_id
	 * @param   {String}  visibility
	 * @returns {Promise}
	 */
	getCount: (user_id, visibility) => {
		const query = proxyHostModel.query().count("id as count").where("is_deleted", 0);

		if (visibility !== "all") {
			query.andWhere("owner_user_id", user_id);
		}

		return query.first().then((row) => {
			return Number.parseInt(row.count, 10);
		});
	},
};

export default internalProxyHost;
