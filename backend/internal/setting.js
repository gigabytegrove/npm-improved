import fs from "node:fs";
import errs from "../lib/error.js";
import { applyConfigTransaction } from "../lib/nginx-transaction.js";
import { normalizeProtectionSetting, renderProtectionPolicy } from "../lib/protection.js";
import settingModel from "../models/setting.js";
import internalNginx from "./nginx.js";

const restoreSetting = async (row) => {
	await settingModel.query().where({ id: row.id }).patch({
		name: row.name,
		description: row.description,
		value: row.value,
		meta: row.meta,
	});
};

const validateSetting = (data) => {
	if (data.id === "instance-sync") {
		throw new errs.ValidationError(
			"Instance synchronization must be changed through the cluster settings API",
		);
	}

	if (data.id === "default-site") {
		const validValues = ["congratulations", "404", "444", "redirect", "html"];
		if (!validValues.includes(data.value)) {
			throw new errs.ValidationError("Default site mode is invalid");
		}
		if (data.value === "redirect" && (typeof data.meta?.redirect !== "string" || !data.meta.redirect.trim())) {
			throw new errs.ValidationError("Default site redirect URL is required");
		}
		if (data.value === "html" && typeof data.meta?.html !== "string") {
			throw new errs.ValidationError("Default site HTML must be a string");
		}
	}

	if (data.id === "certificate-lifecycle") {
		if (!["enabled", "disabled"].includes(data.value)) {
			throw new errs.ValidationError("Certificate lifecycle must be enabled or disabled");
		}

		const retentionDays = Number.parseInt(data.meta?.unused_retention_days, 10);
		if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
			throw new errs.ValidationError("Unused certificate retention must be between 1 and 3650 days");
		}
		if (typeof data.meta?.purge_custom_certificates !== "boolean") {
			throw new errs.ValidationError("Custom certificate purge setting must be true or false");
		}

		data.meta = {
			unused_retention_days: retentionDays,
			purge_custom_certificates: data.meta.purge_custom_certificates,
		};
	}

	if (data.id === "http-protection") {
		try {
			const normalized = normalizeProtectionSetting(data);
			data.value = normalized.value;
			data.meta = normalized.meta;
		} catch (err) {
			throw new errs.ValidationError(err instanceof Error ? err.message : String(err));
		}
	}
};

const configureDefaultSite = async (row, previousRow) => {
	const htmlPath = "/data/nginx/default_www/index.html";
	let previousHtml = null;
	let previousHtmlExists = false;

	try {
		if (fs.existsSync(htmlPath)) {
			previousHtmlExists = true;
			previousHtml = fs.readFileSync(htmlPath, { encoding: "utf8" });
		}

		if (row.value === "html") {
			fs.writeFileSync(htmlPath, row.meta.html, { encoding: "utf8" });
		}

		await applyConfigTransaction({
			livePath: internalNginx.getConfigName("default", 0),
			renderCandidate: (candidatePath) => internalNginx.generateConfig("default", row, candidatePath),
			validate: () => internalNginx.test(),
			reload: () => internalNginx.reload(),
		});
	} catch (err) {
		await restoreSetting(previousRow);
		if (previousHtmlExists) {
			fs.writeFileSync(htmlPath, previousHtml, { encoding: "utf8" });
		} else if (fs.existsSync(htmlPath)) {
			fs.unlinkSync(htmlPath);
		}
		throw err;
	}
};

const configureProtection = async (row, previousRow) => {
	try {
		await applyConfigTransaction({
			livePath: "/data/nginx/protection/policy.conf",
			renderCandidate: async (candidatePath) => {
				fs.mkdirSync("/data/nginx/protection", { recursive: true });
				fs.writeFileSync(candidatePath, renderProtectionPolicy(row), { encoding: "utf8", mode: 0o640 });
			},
			validate: () => internalNginx.test(),
			reload: () => internalNginx.reload(),
		});
	} catch (err) {
		await restoreSetting(previousRow);
		throw err;
	}
};

const internalSetting = {
	/**
	 * @param  {Access}  access
	 * @param  {Object}  data
	 * @param  {String}  data.id
	 * @return {Promise}
	 */
	update: async (access, data) => {
		validateSetting(data);
		await access.can("settings:update", data.id);

		const previousRow = await internalSetting.get(access, { id: data.id });
		if (previousRow.id !== data.id) {
			throw new errs.InternalValidationError(
				`Setting could not be updated, IDs do not match: ${previousRow.id} !== ${data.id}`,
			);
		}

		await settingModel.query().where({ id: data.id }).patch(data);
		const row = await internalSetting.get(access, { id: data.id });

		if (row.id === "default-site") {
			await configureDefaultSite(row, previousRow);
		} else if (row.id === "http-protection") {
			await configureProtection(row, previousRow);
		}

		return row;
	},

	/**
	 * @param  {Access}   access
	 * @param  {Object}   data
	 * @param  {String}   data.id
	 * @return {Promise}
	 */
	get: (access, data) => {
		return access
			.can("settings:get", data.id)
			.then(() => {
				return settingModel.query().where("id", data.id).first();
			})
			.then((row) => {
				if (row) {
					return row;
				}
				throw new errs.ItemNotFoundError(data.id);
			});
	},

	/**
	 * This will only count the settings
	 *
	 * @param   {Access}  access
	 * @returns {*}
	 */
	getCount: (access) => {
		return access
			.can("settings:list")
			.then(() => settingModel.query().count("id as count").first())
			.then((row) => Number.parseInt(row.count, 10));
	},

	/**
	 * All settings
	 *
	 * @param   {Access}  access
	 * @returns {Promise}
	 */
	getAll: (access) => {
		return access.can("settings:list").then(() => settingModel.query().orderBy("description", "ASC"));
	},
};

export default internalSetting;
