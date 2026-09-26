import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	applyConfigTransaction,
	removeConfigTransaction,
} from "../lib/nginx-transaction.js";

const fixture = () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "npm-improved-nginx-transaction-"));
	const livePath = path.join(root, "proxy_host", "1.conf");
	fs.mkdirSync(path.dirname(livePath), { recursive: true });
	return {
		livePath,
		cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
	};
};

test("commits a valid candidate and removes rollback artifacts", async (t) => {
	const f = fixture();
	t.after(f.cleanup);
	fs.writeFileSync(f.livePath, "old");

	let validated = 0;
	let reloaded = 0;
	await applyConfigTransaction({
		livePath: f.livePath,
		renderCandidate: async (candidate) => fs.writeFileSync(candidate, "new"),
		validate: async () => {
			validated++;
		},
		reload: async () => {
			reloaded++;
		},
	});

	assert.equal(fs.readFileSync(f.livePath, "utf8"), "new");
	assert.equal(validated, 1);
	assert.equal(reloaded, 1);
	assert.equal(fs.existsSync(`${f.livePath}.candidate`), false);
	assert.equal(fs.existsSync(`${f.livePath}.last-good`), false);
	assert.equal(fs.existsSync(`${f.livePath}.err`), false);
});

test("validation failure restores the previous live config and never reloads", async (t) => {
	const f = fixture();
	t.after(f.cleanup);
	fs.writeFileSync(f.livePath, "old");

	let reloads = 0;
	await assert.rejects(
		applyConfigTransaction({
			livePath: f.livePath,
			renderCandidate: async (candidate) => fs.writeFileSync(candidate, "broken"),
			validate: async () => {
				throw new Error("nginx: [emerg] invalid directive");
			},
			reload: async () => {
				reloads++;
			},
		}),
		(err) => err.phase === "validate" && err.message.includes("invalid directive"),
	);

	assert.equal(fs.readFileSync(f.livePath, "utf8"), "old");
	assert.equal(fs.readFileSync(`${f.livePath}.err`, "utf8"), "broken");
	assert.equal(reloads, 0);
});

test("validation failure for a new host leaves no live config", async (t) => {
	const f = fixture();
	t.after(f.cleanup);

	await assert.rejects(
		applyConfigTransaction({
			livePath: f.livePath,
			renderCandidate: async (candidate) => fs.writeFileSync(candidate, "broken"),
			validate: async () => {
				throw new Error("invalid");
			},
			reload: async () => {},
		}),
	);

	assert.equal(fs.existsSync(f.livePath), false);
	assert.equal(fs.readFileSync(`${f.livePath}.err`, "utf8"), "broken");
});

test("reload failure restores and reloads last-known-good configuration", async (t) => {
	const f = fixture();
	t.after(f.cleanup);
	fs.writeFileSync(f.livePath, "old");

	let reloads = 0;
	await assert.rejects(
		applyConfigTransaction({
			livePath: f.livePath,
			renderCandidate: async (candidate) => fs.writeFileSync(candidate, "new"),
			validate: async () => {},
			reload: async () => {
				reloads++;
				if (reloads === 1) {
					throw new Error("reload rejected");
				}
			},
		}),
		(err) => err.phase === "reload",
	);

	assert.equal(fs.readFileSync(f.livePath, "utf8"), "old");
	assert.equal(fs.readFileSync(`${f.livePath}.err`, "utf8"), "new");
	assert.equal(reloads, 2);
});

test("render failure never touches the previous live config", async (t) => {
	const f = fixture();
	t.after(f.cleanup);
	fs.writeFileSync(f.livePath, "old");

	await assert.rejects(
		applyConfigTransaction({
			livePath: f.livePath,
			renderCandidate: async () => {
				throw new Error("template failure");
			},
			validate: async () => {},
			reload: async () => {},
		}),
		/template failure/,
	);

	assert.equal(fs.readFileSync(f.livePath, "utf8"), "old");
	assert.equal(fs.existsSync(`${f.livePath}.candidate`), false);
	assert.equal(fs.existsSync(`${f.livePath}.last-good`), false);
});

test("transactional removal deletes config only after validate and reload succeed", async (t) => {
	const f = fixture();
	t.after(f.cleanup);
	fs.writeFileSync(f.livePath, "old");

	await removeConfigTransaction({
		livePath: f.livePath,
		validate: async () => {},
		reload: async () => {},
	});

	assert.equal(fs.existsSync(f.livePath), false);
	assert.equal(fs.existsSync(`${f.livePath}.last-good`), false);
});

test("failed removal restores config and reloads last-known-good", async (t) => {
	const f = fixture();
	t.after(f.cleanup);
	fs.writeFileSync(f.livePath, "old");

	let reloads = 0;
	await assert.rejects(
		removeConfigTransaction({
			livePath: f.livePath,
			validate: async () => {},
			reload: async () => {
				reloads++;
				if (reloads === 1) {
					throw new Error("reload rejected");
				}
			},
		}),
		(err) => err.phase === "remove",
	);

	assert.equal(fs.readFileSync(f.livePath, "utf8"), "old");
	assert.equal(reloads, 2);
});
