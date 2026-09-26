import _ from "lodash";
import errs from "../lib/error.js";
import { castJsonIfNeed } from "../lib/helpers.js";
import { deleteUncommittedRow, restoreModelRow, snapshotModelRow } from "../lib/model-rollback.js";
import utils from "../lib/utils.js";
import streamModel from "../models/stream.js";
import internalAuditLog from "./audit-log.js";
import internalCertificate from "./certificate.js";
import internalHost from "./host.js";
import internalNginx from "./nginx.js";

const omissions = () => {
	return ["is_deleted", "owner.is_deleted", "certificate.is_deleted"];
};

const internalStream = {
	/**
	 * @param   {Access}  access
	 * @param   {Object}  data
	 * @returns {Promise}
	 */
	create: async (access, data) => {
		let thisData = { ...data };
		const createCertificate = thisData.certificate_id === "new";
		if (createCertificate) delete thisData.certificate_id;

		await access.can("streams:create", thisData);
		thisData.owner_user_id = access.token.getUserId(1);
		if (typeof thisData.meta === "undefined") thisData.meta = {};

		const dataNoDomains = structuredClone(thisData);
		delete dataNoDomains.domain_names;
		const row = await streamModel.query().insertAndFetch(dataNoDomains).then(utils.omitRow(omissions()));
		let freshRow;

		try {
			if (createCertificate) {
				const cert = await internalCertificate.createQuickCertificate(access, thisData);
				thisData.certificate_id = cert.id;
				await streamModel.query().where("id", row.id).patch({ certificate_id: cert.id });
			}
			freshRow = await internalStream.get(access, {
				id: row.id,
				expand: ["certificate", "owner"],
			});
			if (freshRow.enabled) {
				const newMeta = await internalNginx.configure(streamModel, "stream", freshRow);
				freshRow.meta = newMeta;
			}
		} catch (err) {
			try {
				await deleteUncommittedRow(streamModel, row.id);
			} catch (rollbackErr) {
				err.rollbackError = rollbackErr;
			}
			throw err;
		}

		await internalAuditLog.add(access, {
			action: "created",
			object_type: "stream",
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

		await access.can("streams:update", thisData.id);
		const currentRow = await internalStream.get(access, { id: thisData.id });
		if (currentRow.id !== thisData.id) {
			throw new errs.InternalValidationError(
				`Stream could not be updated, IDs do not match: ${currentRow.id} !== ${thisData.id}`,
			);
		}
		const previousState = await snapshotModelRow(streamModel, currentRow.id);

		if (createCertificate) {
			const cert = await internalCertificate.createQuickCertificate(access, {
				domain_names: thisData.domain_names || currentRow.domain_names,
				meta: _.assign({}, currentRow.meta, thisData.meta),
			});
			thisData.certificate_id = cert.id;
		}

		const patchData = structuredClone(thisData);
		delete patchData.domain_names;
		await streamModel.query().patchAndFetchById(currentRow.id, patchData);

		let updatedRow;
		try {
			updatedRow = await internalStream.get(access, {
				id: thisData.id,
				expand: ["owner", "certificate"],
			});
			if (updatedRow.enabled) {
				const newMeta = await internalNginx.configure(streamModel, "stream", updatedRow);
				updatedRow.meta = newMeta;
			}
		} catch (err) {
			await restoreModelRow(streamModel, currentRow.id, previousState);
			throw err;
		}

		await internalAuditLog.add(access, {
			action: "updated",
			object_type: "stream",
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
			.can("streams:get", thisData.id)
			.then((access_data) => {
				const query = streamModel
					.query()
					.where("is_deleted", 0)
					.andWhere("id", thisData.id)
					.allowGraph(streamModel.defaultAllowGraph)
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
		await access.can("streams:delete", data.id);
		const row = await internalStream.get(access, { id: data.id });
		if (!row?.id) throw new errs.ItemNotFoundError(data.id);

		const previousState = await snapshotModelRow(streamModel, row.id);
		await streamModel.query().where("id", row.id).patch({ is_deleted: 1 });
		try {
			await internalNginx.removeConfigTransactional("stream", row);
		} catch (err) {
			await restoreModelRow(streamModel, row.id, previousState);
			throw err;
		}

		await internalAuditLog.add(access, {
			action: "deleted",
			object_type: "stream",
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
		await access.can("streams:update", data.id);
		const row = await internalStream.get(access, {
			id: data.id,
			expand: ["certificate", "owner"],
		});
		if (!row?.id) throw new errs.ItemNotFoundError(data.id);
		if (row.enabled) throw new errs.ValidationError("Stream is already enabled");

		const previousState = await snapshotModelRow(streamModel, row.id);
		row.enabled = 1;
		await streamModel.query().where("id", row.id).patch({ enabled: 1 });
		try {
			await internalNginx.configure(streamModel, "stream", row);
		} catch (err) {
			await restoreModelRow(streamModel, row.id, previousState);
			throw err;
		}

		await internalAuditLog.add(access, {
			action: "enabled",
			object_type: "stream",
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
		await access.can("streams:update", data.id);
		const row = await internalStream.get(access, { id: data.id });
		if (!row?.id) throw new errs.ItemNotFoundError(data.id);
		if (!row.enabled) throw new errs.ValidationError("Stream is already disabled");

		const previousState = await snapshotModelRow(streamModel, row.id);
		row.enabled = 0;
		await streamModel.query().where("id", row.id).patch({ enabled: 0 });
		try {
			await internalNginx.removeConfigTransactional("stream", row);
		} catch (err) {
			await restoreModelRow(streamModel, row.id, previousState);
			throw err;
		}

		await internalAuditLog.add(access, {
			action: "disabled",
			object_type: "stream",
			object_id: row.id,
			meta: _.omit(row, omissions()),
		});
		return true;
	},

	/**
	 * All Streams
	 *
	 * @param   {Access}  access
	 * @param   {Array}   [expand]
	 * @param   {String}  [search_query]
	 * @returns {Promise}
	 */
	getAll: (access, expand, search_query) => {
		return access
			.can("streams:list")
			.then((access_data) => {
				const query = streamModel
					.query()
					.where("is_deleted", 0)
					.groupBy("id")
					.allowGraph(streamModel.defaultAllowGraph)
					.orderBy("incoming_port", "ASC");

				if (access_data.permission_visibility !== "all") {
					query.andWhere("owner_user_id", access.token.getUserId(1));
				}

				// Query is used for searching
				if (typeof search_query === "string" && search_query.length > 0) {
					query.where(function () {
						this.where(castJsonIfNeed("incoming_port"), "like", `%${search_query}%`);
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
		const query = streamModel.query().count("id AS count").where("is_deleted", 0);

		if (visibility !== "all") {
			query.andWhere("owner_user_id", user_id);
		}

		return query.first().then((row) => {
			return Number.parseInt(row.count, 10);
		});
	},
};

export default internalStream;
