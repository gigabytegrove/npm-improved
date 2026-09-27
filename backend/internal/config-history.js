import errs from "../lib/error.js";
import {
	CONFIG_REVISION_STATUS,
	captureModelSnapshot,
	revisionSnapshotForPatch,
} from "../lib/config-revision-store.js";
import configRevisionModel from "../models/config_revision.js";
import deadHostModel from "../models/dead_host.js";
import proxyHostModel from "../models/proxy_host.js";
import redirectionHostModel from "../models/redirection_host.js";
import streamModel from "../models/stream.js";
import internalAuditLog from "./audit-log.js";
import internalNginx from "./nginx.js";

const OBJECTS = Object.freeze({
	proxy_host: {
		model: proxyHostModel,
		hostType: "proxy_host",
		label: "proxy-host",
	},
	redirection_host: {
		model: redirectionHostModel,
		hostType: "redirection_host",
		label: "redirection-host",
	},
	dead_host: {
		model: deadHostModel,
		hostType: "dead_host",
		label: "dead-host",
	},
	stream: {
		model: streamModel,
		hostType: "stream",
		label: "stream",
	},
});

const getObjectHandler = (objectType) => {
	const handler = OBJECTS[objectType];
	if (!handler) {
		throw new errs.ValidationError("Unsupported configuration revision object type");
	}
	return handler;
};

const internalConfigHistory = {
	list: async (access, data = {}) => {
		await access.can("auditlog:list");

		const limit = Math.min(Math.max(Number.parseInt(data.limit, 10) || 100, 1), 250);
		const query = configRevisionModel
			.query()
			.orderBy("created_on", "DESC")
			.orderBy("id", "DESC")
			.limit(limit)
			.allowGraph("[user]")
			.withGraphFetched("[user]");

		if (data.object_type) query.where("object_type", data.object_type);
		if (data.object_id) query.where("object_id", data.object_id);
		if (data.status) query.where("status", data.status);

		return await query;
	},

	get: async (access, id) => {
		await access.can("auditlog:list");
		const row = await configRevisionModel
			.query()
			.findById(id)
			.allowGraph("[user]")
			.withGraphFetched("[user]");

		if (!row?.id) {
			throw new errs.ItemNotFoundError(id);
		}
		return row;
	},

	restore: async (access, id) => {
		await access.can("settings:update", "config-history");

		const revision = await configRevisionModel.query().findById(id);
		if (!revision?.id) {
			throw new errs.ItemNotFoundError(id);
		}
		if (revision.status === CONFIG_REVISION_STATUS.ACTIVE) {
			throw new errs.ValidationError("This configuration revision is already active");
		}
		if (revision.status !== CONFIG_REVISION_STATUS.SUPERSEDED) {
			throw new errs.ValidationError("Only superseded configuration revisions can be restored");
		}
		if (!revision.snapshot || typeof revision.snapshot !== "object") {
			throw new errs.ValidationError("This configuration revision does not contain a restorable snapshot");
		}

		const handler = getObjectHandler(revision.object_type);
		const currentSnapshot = await captureModelSnapshot(handler.model, revision.object_id);
		if (!currentSnapshot) {
			throw new errs.ItemNotFoundError(revision.object_id);
		}

		const targetPatch = revisionSnapshotForPatch(revision.snapshot);
		const currentPatch = revisionSnapshotForPatch(currentSnapshot);
		await handler.model.query().findById(revision.object_id).patch(targetPatch);

		try {
			const restoredRaw = await handler.model.query().findById(revision.object_id);
			if (!restoredRaw) {
				throw new errs.ItemNotFoundError(revision.object_id);
			}

			const revisionContext = {
				userId: access.token.getUserId(1),
				operation: "restore",
				previousSnapshot: currentSnapshot,
				sourceRevisionId: revision.id,
			};

			if (!restoredRaw.is_deleted && restoredRaw.enabled) {
				const restoredHost = await handler.model
					.query()
					.findById(revision.object_id)
					.allowGraph(handler.model.defaultAllowGraph)
					.withGraphFetched(handler.model.defaultAllowGraph);
				await internalNginx.configure(handler.model, handler.hostType, restoredHost, revisionContext);
			} else {
				await internalNginx.removeConfigTransactional(
					handler.model,
					handler.hostType,
					restoredRaw,
					revisionContext,
				);
			}
		} catch (err) {
			await handler.model.query().findById(revision.object_id).patch(currentPatch);
			throw err;
		}

		await internalAuditLog.add(access, {
			action: "restored",
			object_type: "config-revision",
			object_id: revision.id,
			meta: {
				source_revision_id: revision.id,
				object_type: revision.object_type,
				object_id: revision.object_id,
			},
		});

		return await configRevisionModel
			.query()
			.where({
				object_type: revision.object_type,
				object_id: revision.object_id,
				status: CONFIG_REVISION_STATUS.ACTIVE,
			})
			.orderBy("id", "DESC")
			.first();
	},
};

export default internalConfigHistory;
