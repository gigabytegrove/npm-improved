import _ from "lodash";
import errs from "../lib/error.js";
import { castJsonIfNeed } from "../lib/helpers.js";
import { deleteUncommittedRow, restoreModelRow, snapshotModelRow } from "../lib/model-rollback.js";
import utils from "../lib/utils.js";
import redirectionHostModel from "../models/redirection_host.js";
import internalAuditLog from "./audit-log.js";
import internalCertificate from "./certificate.js";
import internalHost from "./host.js";
import internalNginx from "./nginx.js";

const omissions = () => {
	return ["is_deleted"];
};

const internalRedirectionHost = {
	/**
	 * @param   {Access}  access
	 * @param   {Object}  data
	 * @returns {Promise}
	 */
	create: async (access, data) => {
		let thisData = { ...(data || {}) };
		const createCertificate = thisData.certificate_id === "new";
		if (createCertificate) delete thisData.certificate_id;

		await access.can("redirection_hosts:create", thisData);
		const checks = await Promise.all(thisData.domain_names.map((domainName) => internalHost.isHostnameTaken(domainName)));
		for (const result of checks) {
			if (result.is_taken) throw new errs.ValidationError(`${result.hostname} is already in use`);
		}

		thisData.owner_user_id = access.token.getUserId(1);
		thisData = internalHost.cleanSslHstsData(thisData);
		thisData = internalHost.cleanProtectionData(thisData);
		if (typeof thisData.advanced_config === "undefined") thisData.advanced_config = "";

		const row = await redirectionHostModel.query().insertAndFetch(thisData).then(utils.omitRow(omissions()));
		let freshRow;
		try {
			if (createCertificate) {
				const cert = await internalCertificate.createQuickCertificate(access, thisData);
				thisData.certificate_id = cert.id;
				await redirectionHostModel.query().where("id", row.id).patch({ certificate_id: cert.id });
			}
			freshRow = await internalRedirectionHost.get(access, {
				id: row.id,
				expand: ["certificate", "owner"],
			});
			if (freshRow.enabled) {
				const newMeta = await internalNginx.configure(redirectionHostModel, "redirection_host", freshRow, {
					userId: access.token.getUserId(1),
					operation: "create",
				});
				freshRow.meta = newMeta;
			}
		} catch (err) {
			try {
				await deleteUncommittedRow(redirectionHostModel, row.id);
			} catch (rollbackErr) {
				err.rollbackError = rollbackErr;
			}
			throw err;
		}

		thisData.meta = _.assign({}, thisData.meta || {}, freshRow.meta);
		await internalAuditLog.add(access, {
			action: "created",
			object_type: "redirection-host",
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
		let thisData = { ...(data || {}) };
		const createCertificate = thisData.certificate_id === "new";
		if (createCertificate) delete thisData.certificate_id;

		await access.can("redirection_hosts:update", thisData.id);
		if (typeof thisData.domain_names !== "undefined") {
			const checks = await Promise.all(
				thisData.domain_names.map((domainName) => internalHost.isHostnameTaken(domainName, "redirection", thisData.id)),
			);
			for (const result of checks) {
				if (result.is_taken) throw new errs.ValidationError(`${result.hostname} is already in use`);
			}
		}

		const currentRow = await internalRedirectionHost.get(access, { id: thisData.id });
		if (currentRow.id !== thisData.id) {
			throw new errs.InternalValidationError(
				`Redirection Host could not be updated, IDs do not match: ${currentRow.id} !== ${thisData.id}`,
			);
		}
		const previousState = await snapshotModelRow(redirectionHostModel, currentRow.id);

		if (createCertificate) {
			const cert = await internalCertificate.createQuickCertificate(access, {
				domain_names: thisData.domain_names || currentRow.domain_names,
				meta: _.assign({}, currentRow.meta, thisData.meta),
			});
			thisData.certificate_id = cert.id;
		}

		thisData = _.assign({}, { domain_names: currentRow.domain_names }, thisData);
		thisData = internalHost.cleanSslHstsData(thisData, currentRow);
		thisData = internalHost.cleanProtectionData(thisData, currentRow);
		await redirectionHostModel.query().where({ id: thisData.id }).patch(thisData);

		let updatedRow;
		try {
			updatedRow = await internalRedirectionHost.get(access, {
				id: thisData.id,
				expand: ["owner", "certificate"],
			});
			if (updatedRow.enabled) {
				const newMeta = await internalNginx.configure(redirectionHostModel, "redirection_host", updatedRow, {
					userId: access.token.getUserId(1),
					operation: "update",
					previousSnapshot: previousState,
				});
				updatedRow.meta = newMeta;
			}
		} catch (err) {
			await restoreModelRow(redirectionHostModel, currentRow.id, previousState);
			throw err;
		}

		await internalAuditLog.add(access, {
			action: "updated",
			object_type: "redirection-host",
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
			.can("redirection_hosts:get", thisData.id)
			.then((access_data) => {
				const query = redirectionHostModel
					.query()
					.where("is_deleted", 0)
					.andWhere("id", thisData.id)
					.allowGraph(redirectionHostModel.defaultAllowGraph)
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
				let thisRow = row;
				if (!thisRow?.id) {
					throw new errs.ItemNotFoundError(thisData.id);
				}
				thisRow = internalHost.cleanRowCertificateMeta(thisRow);
				// Custom omissions
				if (typeof thisData.omit !== "undefined" && thisData.omit !== null) {
					return _.omit(thisRow, thisData.omit);
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
		await access.can("redirection_hosts:delete", data.id);
		const row = await internalRedirectionHost.get(access, { id: data.id });
		if (!row?.id) throw new errs.ItemNotFoundError(data.id);

		const previousState = await snapshotModelRow(redirectionHostModel, row.id);
		await redirectionHostModel.query().where("id", row.id).patch({ is_deleted: 1 });
		try {
			await internalNginx.removeConfigTransactional(redirectionHostModel, "redirection_host", row, {
				userId: access.token.getUserId(1),
				operation: "delete",
				previousSnapshot: previousState,
			});
		} catch (err) {
			await restoreModelRow(redirectionHostModel, row.id, previousState);
			throw err;
		}

		await internalAuditLog.add(access, {
			action: "deleted",
			object_type: "redirection-host",
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
		await access.can("redirection_hosts:update", data.id);
		const row = await internalRedirectionHost.get(access, {
			id: data.id,
			expand: ["certificate", "owner"],
		});
		if (!row?.id) throw new errs.ItemNotFoundError(data.id);
		if (row.enabled) throw new errs.ValidationError("Host is already enabled");

		const previousState = await snapshotModelRow(redirectionHostModel, row.id);
		row.enabled = 1;
		await redirectionHostModel.query().where("id", row.id).patch({ enabled: 1 });
		try {
			await internalNginx.configure(redirectionHostModel, "redirection_host", row, {
				userId: access.token.getUserId(1),
				operation: "enable",
				previousSnapshot: previousState,
			});
		} catch (err) {
			await restoreModelRow(redirectionHostModel, row.id, previousState);
			throw err;
		}

		await internalAuditLog.add(access, {
			action: "enabled",
			object_type: "redirection-host",
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
		await access.can("redirection_hosts:update", data.id);
		const row = await internalRedirectionHost.get(access, { id: data.id });
		if (!row?.id) throw new errs.ItemNotFoundError(data.id);
		if (!row.enabled) throw new errs.ValidationError("Host is already disabled");

		const previousState = await snapshotModelRow(redirectionHostModel, row.id);
		row.enabled = 0;
		await redirectionHostModel.query().where("id", row.id).patch({ enabled: 0 });
		try {
			await internalNginx.removeConfigTransactional(redirectionHostModel, "redirection_host", row, {
				userId: access.token.getUserId(1),
				operation: "disable",
				previousSnapshot: previousState,
			});
		} catch (err) {
			await restoreModelRow(redirectionHostModel, row.id, previousState);
			throw err;
		}

		await internalAuditLog.add(access, {
			action: "disabled",
			object_type: "redirection-host",
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
	getAll: (access, expand, search_query) => {
		return access
			.can("redirection_hosts:list")
			.then((access_data) => {
				const query = redirectionHostModel
					.query()
					.where("is_deleted", 0)
					.groupBy("id")
					.allowGraph(redirectionHostModel.defaultAllowGraph)
					.orderBy(castJsonIfNeed("domain_names"), "ASC");

				if (access_data.permission_visibility !== "all") {
					query.andWhere("owner_user_id", access.token.getUserId(1));
				}

				// Query is used for searching
				if (typeof search_query === "string" && search_query.length > 0) {
					query.where(function () {
						this.where(castJsonIfNeed("domain_names"), "like", `%${search_query}%`);
					});
				}

				if (typeof expand !== "undefined" && expand !== null) {
					query.withGraphFetched(`[${expand.join(", ")}]`);
				}

				return query.then(utils.omitRows(omissions()));
			})
			.then((rows) => {
				if (typeof expand !== "undefined" && expand !== null && expand.indexOf("certificate") !== -1) {
					return internalHost.cleanAllRowsCertificateMeta(rows);
				}

				return rows;
			});
	},

	/**
	 * Report use
	 *
	 * @param   {Number}  user_id
	 * @param   {String}  visibility
	 * @returns {Promise}
	 */
	getCount: (user_id, visibility) => {
		const query = redirectionHostModel.query().count("id as count").where("is_deleted", 0);

		if (visibility !== "all") {
			query.andWhere("owner_user_id", user_id);
		}

		return query.first().then((row) => {
			return Number.parseInt(row.count, 10);
		});
	},
};

export default internalRedirectionHost;
