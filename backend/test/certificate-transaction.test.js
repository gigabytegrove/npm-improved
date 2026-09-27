import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	applyAtomicCertificateFiles,
	restoreCertificateFiles,
	runCertificateMutationWithRollback,
	snapshotCertificateFiles,
} from "../lib/certificate-transaction.js";

const fixture = () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "npm-improved-cert-"));
	return {
		root,
		fullchain: path.join(root, "fullchain.pem"),
		privkey: path.join(root, "privkey.pem"),
		cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
	};
};

test("atomic certificate file replacement commits only after activation and commit", async (t) => {
	const f = fixture();
	t.after(f.cleanup);
	fs.writeFileSync(f.fullchain, "old-cert");
	fs.writeFileSync(f.privkey, "old-key", { mode: 0o600 });

	const order = [];
	await applyAtomicCertificateFiles({
		files: [
			{ key: "fullchain", path: f.fullchain, content: "new-cert" },
			{ key: "privkey", path: f.privkey, content: "new-key", mode: 0o600 },
		],
		validate: async (paths) => {
			order.push("validate");
			assert.equal(fs.readFileSync(paths.fullchain, "utf8"), "new-cert");
			assert.equal(fs.readFileSync(paths.privkey, "utf8"), "new-key");
		},
		activate: async () => order.push("activate"),
		commit: async () => order.push("commit"),
	});

	assert.deepEqual(order, ["validate", "activate", "commit"]);
	assert.equal(fs.readFileSync(f.fullchain, "utf8"), "new-cert");
	assert.equal(fs.readFileSync(f.privkey, "utf8"), "new-key");
	assert.equal(fs.readdirSync(f.root).some((name) => name.includes("last-good")), false);
});

test("candidate validation failure never touches live certificate files", async (t) => {
	const f = fixture();
	t.after(f.cleanup);
	fs.writeFileSync(f.fullchain, "old-cert");
	fs.writeFileSync(f.privkey, "old-key");

	await assert.rejects(
		applyAtomicCertificateFiles({
			files: [
				{ key: "fullchain", path: f.fullchain, content: "bad-cert" },
				{ key: "privkey", path: f.privkey, content: "bad-key" },
			],
			validate: async () => {
				throw new Error("pair mismatch");
			},
			activate: async () => {
				throw new Error("must not run");
			},
		}),
		/pair mismatch/,
	);

	assert.equal(fs.readFileSync(f.fullchain, "utf8"), "old-cert");
	assert.equal(fs.readFileSync(f.privkey, "utf8"), "old-key");
});

test("activation failure restores the last-known-good file set and reactivates it", async (t) => {
	const f = fixture();
	t.after(f.cleanup);
	fs.writeFileSync(f.fullchain, "old-cert");
	fs.writeFileSync(f.privkey, "old-key");

	let activations = 0;
	await assert.rejects(
		applyAtomicCertificateFiles({
			files: [
				{ key: "fullchain", path: f.fullchain, content: "new-cert" },
				{ key: "privkey", path: f.privkey, content: "new-key" },
			],
			validate: async () => {},
			activate: async () => {
				activations++;
				if (activations === 1) throw new Error("nginx reload failed");
			},
		}),
		/nginx reload failed/,
	);

	assert.equal(activations, 2);
	assert.equal(fs.readFileSync(f.fullchain, "utf8"), "old-cert");
	assert.equal(fs.readFileSync(f.privkey, "utf8"), "old-key");
});

test("commit failure also restores files and reactivates the previous certificate", async (t) => {
	const f = fixture();
	t.after(f.cleanup);
	fs.writeFileSync(f.fullchain, "old-cert");
	fs.writeFileSync(f.privkey, "old-key");

	let activations = 0;
	await assert.rejects(
		applyAtomicCertificateFiles({
			files: [
				{ key: "fullchain", path: f.fullchain, content: "new-cert" },
				{ key: "privkey", path: f.privkey, content: "new-key" },
			],
			validate: async () => {},
			activate: async () => {
				activations++;
			},
			commit: async () => {
				throw new Error("database commit failed");
			},
		}),
		/database commit failed/,
	);

	assert.equal(activations, 2);
	assert.equal(fs.readFileSync(f.fullchain, "utf8"), "old-cert");
	assert.equal(fs.readFileSync(f.privkey, "utf8"), "old-key");
});

test("snapshot and restore preserve existing certificate bytes", (t) => {
	const f = fixture();
	t.after(f.cleanup);
	fs.writeFileSync(f.fullchain, "old-cert");
	fs.writeFileSync(f.privkey, "old-key", { mode: 0o600 });

	const snapshot = snapshotCertificateFiles([f.fullchain, f.privkey]);
	fs.writeFileSync(f.fullchain, "new-cert");
	fs.writeFileSync(f.privkey, "new-key");
	restoreCertificateFiles(snapshot);

	assert.equal(fs.readFileSync(f.fullchain, "utf8"), "old-cert");
	assert.equal(fs.readFileSync(f.privkey, "utf8"), "old-key");
});

test("snapshot restore puts Certbot-style symlinks back on their original archive target", (t) => {
	const f = fixture();
	t.after(f.cleanup);

	const archiveOne = path.join(f.root, "fullchain1.pem");
	const archiveTwo = path.join(f.root, "fullchain2.pem");
	fs.writeFileSync(archiveOne, "old-cert");
	fs.writeFileSync(archiveTwo, "new-cert");
	fs.symlinkSync(path.basename(archiveOne), f.fullchain);

	const snapshot = snapshotCertificateFiles([f.fullchain]);
	fs.unlinkSync(f.fullchain);
	fs.symlinkSync(path.basename(archiveTwo), f.fullchain);

	restoreCertificateFiles(snapshot);

	assert.equal(fs.readlinkSync(f.fullchain), path.basename(archiveOne));
	assert.equal(fs.readFileSync(f.fullchain, "utf8"), "old-cert");
});

test("renewal-style mutation restores certificate and commit state after failure", async (t) => {
	const f = fixture();
	t.after(f.cleanup);
	fs.writeFileSync(f.fullchain, "old-cert");
	fs.writeFileSync(f.privkey, "old-key");

	let dbState = "old";
	let activations = 0;
	await assert.rejects(
		runCertificateMutationWithRollback({
			paths: [f.fullchain, f.privkey],
			mutate: async () => {
				fs.writeFileSync(f.fullchain, "new-cert");
				fs.writeFileSync(f.privkey, "new-key");
			},
			validate: async () => {},
			activate: async () => {
				activations++;
			},
			commit: async () => {
				dbState = "new";
				throw new Error("post-renew commit failed");
			},
			rollbackCommit: async () => {
				dbState = "old";
			},
		}),
		/post-renew commit failed/,
	);

	assert.equal(activations, 2);
	assert.equal(dbState, "old");
	assert.equal(fs.readFileSync(f.fullchain, "utf8"), "old-cert");
	assert.equal(fs.readFileSync(f.privkey, "utf8"), "old-key");
});
