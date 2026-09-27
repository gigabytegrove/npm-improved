import _ from "lodash";
import errs from "../lib/error.js";
import { castJsonIfNeed } from "../lib/helpers.js";
import { deleteUncommittedRow, restoreModelRow, snapshotModelRow } from "../lib/model-rollback.js";
import utils from "../lib/utils.js";
import deadHostModel from "../models/dead_host.js";
import internalAuditLog from "./audit-log.js";
import internalCertificate from "./certificate.js";
import internalHost from "./host.js";
import internalNginx from "./nginx.js";

const omissions = () => {
	return ["is_deleted"];
};

const internalDeadHost = {
	/**
	 * @param   {Access}  access
	 * @param   {Object}  data
	 * @returns {Promise}
	 */
	create: async (access, data) => {
		let thisData = { ...data };
		const createCertificate = thisData.certificate_id === "new";
		if (createCertificate) delete thisData.certificate_id;

		await access.can("dead_hosts:create", thisData);
		const checks = await Promise.all(thisData.domain_names.map((domainName) => internalHost.isHostnameTaken(domainName)));
		for (const result of checks) {
			if (result.is_taken) throw new errs.ValidationError(`${result.hostname} is already in use`);
		}

		thisData.owner_user_id = access.token.getUserId(1);
		thisData = internalHost.cleanSslHstsData(thisData);
		thisData = internalHost.cleanProtectionData(thisData);
		if (typeof thisData.advanced_config === "undefined") thisData.advanced_config = "";

		const row = await deadHostModel.query().insertAndFetch(thisData).then(utils.omitRow(omissions()));
		let freshRow;
		try {
			if (createCertificate) {
				const cert = await internalCertificate.createQuickCertificate(access, thisData);
				thisData.certificate_id = cert.id;
				await deadHostModel.query().where("id", row.id).patch({ certificate_id: cert.id });
			}
			freshRow = await internalDeadHost.get(access, {
				id: row.id,
				expand: ["certificate", "owner"],
			});
			if (createCertificate && !freshRow.certificate_id) {
				throw new errs.InternalValidationError("The host was created but the Certificate creation failed.");
			}
			if (freshRow.enabled) {
				const newMeta = await internalNginx.configure(deadHostModel, "dead_host", freshRow);
				freshRow.meta = newMeta;
			}
		} catch (err) {
			try {
				await deleteUncommittedRow(deadHostModel, row.id);
			} catch (rollbackErr) {
				err.rollbackError = rollbackErr;
			}
			throw err;
		}

		await internalAuditLog.add(access, {
			action: "created",
			object_type: "dead-host",
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
		if (createCertificate) delete thisData.certificate_id;

		await access.can("dead_hosts:update", thisData.id);
		if (typeof thisData.domain_names !== "undefined") {
			const checks = await Promise.all(
				thisData.domain_names.map((domainName) => internalHost.isHostnameTaken(domainName, "dead", thisData.id)),
			);
			for (const result of checks) {
				if (result.is_taken) throw new errs.ValidationError(`${result.hostname} is already in use`);
			}
		}

		const currentRow = await internalDeadHost.get(access, { id: thisData.id });
		if (currentRow.id !== thisData.id) {
			throw new errs.InternalValidationError(
				`404 Host could not be updated, IDs do not match: ${currentRow.id} !== ${thisData.id}`,
			);
		}
		const previousState = await snapshotModelRow(deadHostModel, currentRow.id);

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
		await deadHostModel.query().where({ id: thisData.id }).patch(thisData);

		let updatedRow;
		try {
			updatedRow = await internalDeadHost.get(access, {
				id: thisData.id,
				expand: ["owner", "certificate"],
			});
			if (updatedRow.enabled) {
				const newMeta = await internalNginx.configure(deadHostModel, "dead_host", updatedRow);
				updatedRow.meta = newMeta;
			}
		} catch (err) {
			await restoreModelRow(deadHostModel, currentRow.id, previousState);
			throw err;
		}

		await internalAuditLog.add(access, {
			action: "updated",
			object_type: "dead-host",
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
	get: async (access, data) => {
		const accessData = await access.can("dead_hosts:get", data.id);
		const query = deadHostModel
			.query()
			.where("is_deleted", 0)
			.andWhere("id", data.id)
			.allowGraph(deadHostModel.defaultAllowGraph)
			.first();

		if (accessData.permission_visibility !== "all") {
			query.andWhere("owner_user_id", access.token.getUserId(1));
		}

		if (typeof data.expand !== "undefined" && data.expand !== null) {
			query.withGraphFetched(`[${data.expand.join(", ")}]`);
		}

		const row = await query.then(utils.omitRow(omissions()));
		if (!row?.id) {
			throw new errs.ItemNotFoundError(data.id);
		}
		// Custom omissions
		if (typeof data.omit !== "undefined" && data.omit !== null) {
			return _.omit(row, data.omit);
		}
		return row;
	},

	/**
	 * @param {Access}  access
	 * @param {Object}  data
	 * @param {Number}  data.id
	 * @param {String}  [data.reason]
	 * @returns {Promise}
	 */
	delete: async (access, data) => {
		await access.can("dead_hosts:delete", data.id);
		const row = await internalDeadHost.get(access, { id: data.id });
		if (!row?.id) throw new errs.ItemNotFoundError(data.id);

		const previousState = await snapshotModelRow(deadHostModel, row.id);
		await deadHostModel.query().where("id", row.id).patch({ is_deleted: 1 });
		try {
			await internalNginx.removeConfigTransactional("dead_host", row);
		} catch (err) {
			await restoreModelRow(deadHostModel, row.id, previousState);
			throw err;
		}

		await internalAuditLog.add(access, {
			action: "deleted",
			object_type: "dead-host",
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
		await access.can("dead_hosts:update", data.id);
		const row = await internalDeadHost.get(access, {
			id: data.id,
			expand: ["certificate", "owner"],
		});
		if (!row?.id) throw new errs.ItemNotFoundError(data.id);
		if (row.enabled) throw new errs.ValidationError("Host is already enabled");

		const previousState = await snapshotModelRow(deadHostModel, row.id);
		row.enabled = 1;
		await deadHostModel.query().where("id", row.id).patch({ enabled: 1 });
		try {
			await internalNginx.configure(deadHostModel, "dead_host", row);
		} catch (err) {
			await restoreModelRow(deadHostModel, row.id, previousState);
			throw err;
		}

		await internalAuditLog.add(access, {
			action: "enabled",
			object_type: "dead-host",
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
		await access.can("dead_hosts:update", data.id);
		const row = await internalDeadHost.get(access, { id: data.id });
		if (!row?.id) throw new errs.ItemNotFoundError(data.id);
		if (!row.enabled) throw new errs.ValidationError("Host is already disabled");

		const previousState = await snapshotModelRow(deadHostModel, row.id);
		row.enabled = 0;
		await deadHostModel.query().where("id", row.id).patch({ enabled: 0 });
		try {
			await internalNginx.removeConfigTransactional("dead_host", row);
		} catch (err) {
			await restoreModelRow(deadHostModel, row.id, previousState);
			throw err;
		}

		await internalAuditLog.add(access, {
			action: "disabled",
			object_type: "dead-host",
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
	 * @param   {String}  [searchQuery]
	 * @returns {Promise}
	 */
	getAll: async (access, expand, searchQuery) => {
		const accessData = await access.can("dead_hosts:list");
		const query = deadHostModel
			.query()
			.where("is_deleted", 0)
			.groupBy("id")
			.allowGraph(deadHostModel.defaultAllowGraph)
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
			internalHost.cleanAllRowsCertificateMeta(rows);
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
	getCount: async (user_id, visibility) => {
		const query = deadHostModel.query().count("id as count").where("is_deleted", 0);

		if (visibility !== "all") {
			query.andWhere("owner_user_id", user_id);
		}

		const row = await query.first();
		return Number.parseInt(row.count, 10);
	},
};

export default internalDeadHost;
