/**
 * Captures a plain copy of a database row before an external side effect
 * (Nginx activation) is attempted. The snapshot intentionally omits immutable
 * timestamps/primary key so it can be patched back safely.
 */
export const snapshotModelRow = async (model, id) => {
	const row = await model.query().findById(id);
	if (!row) {
		return null;
	}

	const snapshot = typeof row.toJSON === "function" ? row.toJSON() : { ...row };
	delete snapshot.id;
	delete snapshot.created_on;
	delete snapshot.modified_on;
	return structuredClone(snapshot);
};

export const restoreModelRow = async (model, id, snapshot) => {
	if (!snapshot) {
		return;
	}
	await model.query().where("id", id).patch(structuredClone(snapshot));
};

export const deleteUncommittedRow = async (model, id) => {
	await model.query().deleteById(id);
};

export default {
	snapshotModelRow,
	restoreModelRow,
	deleteUncommittedRow,
};
