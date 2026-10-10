import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { reconcileOrphanedHostConfigs } from "../lib/orphan-config-reconciliation.js";

const makeModel = ({ active = [], rows = {}, failDatabase = false } = {}) => ({
	query: () => {
		const q = {
			select: () => q,
			where: () => q,
			andWhere: async () => {
				if (failDatabase) throw new Error("Database unavailable");
				return active.map((id) => ({ id }));
			},
			findById: async (id) => rows[id] || null,
		};
		return q;
	},
});

const fixture = () => {
	const base = fs.mkdtempSync(path.join(os.tmpdir(), "npm-improved-orphans-"));
	const liveDir = path.join(base, "proxy_host");
	const quarantineDir = path.join(base, "orphan-quarantine");
	fs.mkdirSync(liveDir);
	return {
		base, liveDir, quarantineDir,
		groups: (model) => [{ type: "proxy_host", model, directory: liveDir }],
		getConfigName: (_, id) => path.join(liveDir, `${id}.conf`),
		cleanup: () => fs.rmSync(base, { recursive: true, force: true }),
	};
};

test("quarantines missing host #40 without touching authoritative host #41", async () => {
	const f = fixture();
	try {
		fs.writeFileSync(path.join(f.liveDir, "40.conf"), "server_name osc.gigabytegrove.net; # stale");
		fs.writeFileSync(path.join(f.liveDir, "41.conf"), "server_name osc.gigabytegrove.net; # correct ACME");
		fs.writeFileSync(path.join(f.liveDir, "42.conf.candidate"), "incomplete candidate");
		let validations = 0;
		let reloads = 0;
		const result = await reconcileOrphanedHostConfigs({
			groups: f.groups(makeModel({
				active: [41],
				rows: { 41: { id: 41, enabled: 1, is_deleted: 0 } },
			})),
			getConfigName: f.getConfigName,
			validate: async () => { validations++; },
			reload: async () => { reloads++; },
			quarantineDir: f.quarantineDir,
		});
		assert.equal(result.errors.length, 0);
		assert.equal(result.quarantined.length, 1);
		assert.equal(result.quarantined[0].id, 40);
		assert.equal(fs.existsSync(path.join(f.liveDir, "40.conf")), false);
		assert.match(fs.readFileSync(path.join(f.liveDir, "41.conf"), "utf8"), /correct ACME/);
		assert.equal(fs.existsSync(path.join(f.liveDir, "42.conf.candidate")), true);
		assert.match(fs.readFileSync(result.quarantined[0].backup, "utf8"), /stale/);
		assert.equal(validations, 2);
		assert.equal(reloads, 1);
	} finally { f.cleanup(); }
});

test("failed Nginx validation restores orphan file and previous configuration", async () => {
	const f = fixture();
	try {
		const live = path.join(f.liveDir, "40.conf");
		fs.writeFileSync(live, "critical old config");
		let tests = 0;
		let reloads = 0;
		const result = await reconcileOrphanedHostConfigs({
			groups: f.groups(makeModel()),
			getConfigName: f.getConfigName,
			validate: async () => {
				tests++;
				if (tests === 2) throw new Error("candidate config invalid");
			},
			reload: async () => { reloads++; },
			quarantineDir: f.quarantineDir,
		});
		assert.equal(result.quarantined.length, 0);
		assert.equal(result.errors.length, 1);
		assert.match(result.errors[0], /candidate config invalid/);
		assert.equal(fs.readFileSync(live, "utf8"), "critical old config");
		assert.equal(reloads, 1);
	} finally { f.cleanup(); }
});

test("skips all cleanup when database lookup fails", async () => {
	const f = fixture();
	try {
		const live = path.join(f.liveDir, "40.conf");
		fs.writeFileSync(live, "must remain");
		const result = await reconcileOrphanedHostConfigs({
			groups: f.groups(makeModel({ failDatabase: true })),
			getConfigName: f.getConfigName,
			validate: async () => { throw new Error("should not validate"); },
			reload: async () => { throw new Error("should not reload"); },
			quarantineDir: f.quarantineDir,
		});
		assert.equal(result.quarantined.length, 0);
		assert.equal(result.errors.length, 1);
		assert.equal(fs.readFileSync(live, "utf8"), "must remain");
	} finally { f.cleanup(); }
});

test("does not quarantine a host reenabled after initial scan", async () => {
	const f = fixture();
	try {
		const live = path.join(f.liveDir, "40.conf");
		fs.writeFileSync(live, "new active host");
		const result = await reconcileOrphanedHostConfigs({
			groups: f.groups(makeModel({ rows: { 40: { id: 40, enabled: 1, is_deleted: 0 } } })),
			getConfigName: f.getConfigName,
			validate: async () => { throw new Error("should not validate"); },
			reload: async () => { throw new Error("should not reload"); },
			quarantineDir: f.quarantineDir,
		});
		assert.equal(result.quarantined.length, 0);
		assert.equal(result.skipped.length, 1);
		assert.equal(fs.readFileSync(live, "utf8"), "new active host");
	} finally { f.cleanup(); }
});

test("keeps symlinks and non-generated nginx files out of cleanup", async () => {
	const f = fixture();
	try {
		fs.writeFileSync(path.join(f.base, "outside.conf"), "external");
		fs.symlinkSync(path.join(f.base, "outside.conf"), path.join(f.liveDir, "40.conf"));
		fs.writeFileSync(path.join(f.liveDir, "custom.conf"), "custom");
		const result = await reconcileOrphanedHostConfigs({
			groups: f.groups(makeModel()),
			getConfigName: f.getConfigName,
			validate: async () => { throw new Error("should not validate"); },
			reload: async () => { throw new Error("should not reload"); },
			quarantineDir: f.quarantineDir,
		});
		assert.equal(result.quarantined.length, 0);
		assert.equal(fs.readFileSync(path.join(f.base, "outside.conf"), "utf8"), "external");
		assert.equal(fs.existsSync(path.join(f.liveDir, "custom.conf")), true);
	} finally { f.cleanup(); }
});
