import { Model } from "objection";
import db from "../db.js";
import now from "./now_helper.js";
import User from "./user.js";

Model.knex(db());

class ConfigRevision extends Model {
	$beforeInsert() {
		this.created_on = now();
		this.modified_on = now();
		if (typeof this.snapshot === "undefined") this.snapshot = {};
		if (typeof this.meta === "undefined") this.meta = {};
		if (typeof this.config_text === "undefined") this.config_text = "";
	}

	$beforeUpdate() {
		this.modified_on = now();
	}

	static get name() {
		return "ConfigRevision";
	}

	static get tableName() {
		return "config_revision";
	}

	static get jsonAttributes() {
		return ["snapshot", "meta"];
	}

	static get relationMappings() {
		return {
			user: {
				relation: Model.HasOneRelation,
				modelClass: User,
				join: {
					from: "config_revision.user_id",
					to: "user.id",
				},
			},
		};
	}
}

export default ConfigRevision;
