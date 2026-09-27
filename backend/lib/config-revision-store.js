import fs from "node:fs";
import configRevisionModel from "../models/config_revision.js";

export const CONFIG_REVISION_STATUS = Object.freeze({
	PENDING: "pending",
	ACTIVE: "active",
	SUPERSEDED: "superseded",
	FAILED: "failed",
});

export const captureModelSnapshot = async (model, id) => {
	const row = await model.query().findById(id);
	if (!row) return null;
	return structuredClone(typeof row.toJSON === "function" ? row.toJSON() : { ...row });
};

export const revisionSnapshotForPatch = (snapshot) => {
	const patch = structuredClone(snapshot || {});
	delete patch.id;
	delete patch.created_on;
	delete patch.modified_on;
	return patch;
};

export const readConfigIfExists = (filename) => {
	try {
		return fs.readFileSync(filename, { encoding: "utf8" });
	} catch (err) {
		if (err.code === "ENOENT") return "";
		throw err;
	}
};

export const ensureBaselineRevision = async ({
	userId = 0,
	objectType,
	objectId,
	snapshot,
	configText = "",
}) => {
	if (!snapshot) return null;

	const existing = await configRevisionModel
		.query()
		.where({
			object_type: objectType,
			object_id: objectId,
			status: CONFIG_REVISION_STATUS.ACTIVE,
		})
		.orderBy("id", "DESC")
		.first();

	if (existing) return existing;

	return await configRevisionModel.query().insertAndFetch({
		user_id: userId || 0,
		object_type: objectType,
		object_id: objectId,
		operation: "baseline",
		status: CONFIG_REVISION_STATUS.ACTIVE,
		config_text: configText || "",
		snapshot: structuredClone(snapshot),
		error_text: null,
		meta: {
			baseline: true,
		},
	});
};

export const beginConfigRevision = async ({
	userId = 0,
	objectType,
	objectId,
	operation,
	snapshot,
	meta = {},
}) => {
	if (!objectType || !objectId || !operation) {
		throw new Error("Configuration revision requires object type, object id, and operation");
	}

	return await configRevisionModel.query().insertAndFetch({
		user_id: userId || 0,
		object_type: objectType,
		object_id: objectId,
		operation,
		status: CONFIG_REVISION_STATUS.PENDING,
		config_text: "",
		snapshot: snapshot || {},
		error_text: null,
		meta,
	});
};

export const setRevisionCandidate = async (revisionId, configText) => {
	if (!revisionId) return;
	await configRevisionModel.query().findById(revisionId).patch({
		config_text: configText || "",
	});
};

export const failConfigRevision = async (revisionId, err, meta = {}) => {
	if (!revisionId) return;
	const message = err instanceof Error ? err.message : String(err);
	await configRevisionModel.query().findById(revisionId).patch({
		status: CONFIG_REVISION_STATUS.FAILED,
		error_text: message,
		meta: {
			...meta,
			phase: err?.phase || meta.phase || "unknown",
		},
	});
};

export const activateConfigRevision = async (revisionId, { snapshot, configText, meta = {} } = {}) => {
	if (!revisionId) return null;
	const revision = await configRevisionModel.query().findById(revisionId);
	if (!revision) {
		throw new Error(`Configuration revision ${revisionId} no longer exists`);
	}

	const knex = configRevisionModel.knex();
	await knex.transaction(async (trx) => {
		await configRevisionModel
			.query(trx)
			.where({
				object_type: revision.object_type,
				object_id: revision.object_id,
				status: CONFIG_REVISION_STATUS.ACTIVE,
			})
			.whereNot("id", revisionId)
			.patch({
				status: CONFIG_REVISION_STATUS.SUPERSEDED,
			});

		await configRevisionModel.query(trx).findById(revisionId).patch({
			status: CONFIG_REVISION_STATUS.ACTIVE,
			error_text: null,
			...(typeof snapshot !== "undefined" ? { snapshot } : {}),
			...(typeof configText !== "undefined" ? { config_text: configText } : {}),
			meta: {
				...(revision.meta || {}),
				...meta,
			},
		});
	});

	return await configRevisionModel.query().findById(revisionId);
};

export default {
	CONFIG_REVISION_STATUS,
	captureModelSnapshot,
	revisionSnapshotForPatch,
	readConfigIfExists,
	ensureBaselineRevision,
	beginConfigRevision,
	setRevisionCandidate,
	failConfigRevision,
	activateConfigRevision,
};
