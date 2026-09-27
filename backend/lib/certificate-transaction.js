import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const removeIfExists = (filename) => {
	try {
		fs.unlinkSync(filename);
	} catch (err) {
		if (err.code !== "ENOENT") throw err;
	}
};

const safeMode = (mode, fallback) => typeof mode === "number" ? mode : fallback;

const restoreAtomicFiles = async (records, activate, log) => {
	for (const record of [...records].reverse()) {
		if (!record.touched) continue;
		removeIfExists(record.target);
		if (record.hadPrevious && fs.existsSync(record.backup)) {
			fs.renameSync(record.backup, record.target);
		}
	}

	if (activate) {
		try {
			await activate();
		} catch (err) {
			log(`CRITICAL: certificate rollback activation failed: ${err.message}`);
			throw err;
		}
	}
};

/**
 * Atomically replaces a set of certificate files, validates the staged files
 * before activation, and keeps the old set available until both activation and
 * the caller's commit callback have completed.
 *
 * files: [{ key, path, content, mode }]
 */
export const applyAtomicCertificateFiles = async ({
	files,
	validate,
	activate,
	commit,
	log = () => {},
}) => {
	if (!Array.isArray(files) || files.length === 0) {
		throw new Error("At least one certificate file is required");
	}

	const txid = `${process.pid}-${Date.now()}-${randomUUID()}`;
	const records = files.map((file) => {
		if (!file?.path) throw new Error("Certificate transaction file path is required");
		return {
			key: file.key || path.basename(file.path),
			target: file.path,
			candidate: `${file.path}.candidate-${txid}`,
			backup: `${file.path}.last-good-${txid}`,
			content: file.content,
			mode: safeMode(file.mode, 0o644),
			hadPrevious: false,
			touched: false,
		};
	});

	const candidatePaths = {};
	try {
		for (const record of records) {
			fs.mkdirSync(path.dirname(record.target), { recursive: true });
			fs.writeFileSync(record.candidate, record.content, {
				mode: record.mode,
				flag: "wx",
			});
			candidatePaths[record.key] = record.candidate;
		}

		if (validate) {
			await validate(candidatePaths);
		}
	} catch (err) {
		for (const record of records) removeIfExists(record.candidate);
		throw err;
	}

	try {
		for (const record of records) {
			record.hadPrevious = fs.existsSync(record.target);
			record.touched = true;
			if (record.hadPrevious) {
				fs.renameSync(record.target, record.backup);
			}
			fs.renameSync(record.candidate, record.target);
		}

		if (activate) {
			await activate();
		}
		if (commit) {
			await commit();
		}

		for (const record of records) removeIfExists(record.backup);
		return true;
	} catch (err) {
		if (records.some((record) => record.touched)) {
			try {
				await restoreAtomicFiles(records, activate, log);
			} catch (rollbackErr) {
				err.rollbackError = rollbackErr;
			}
		}
		for (const record of records) removeIfExists(record.candidate);
		throw err;
	}
};

/**
 * Captures the contents and modes of live certificate files. Symlinks are
 * deliberately followed: a Certbot renewal may advance the live symlink, and
 * rollback writes the previous bytes into whichever file the live path now
 * references.
 */
export const snapshotCertificateFiles = (paths) =>
	paths.map((filename) => {
		try {
			const linkStat = fs.lstatSync(filename);
			const stat = fs.statSync(filename);
			return {
				path: filename,
				exists: true,
				content: fs.readFileSync(filename),
				mode: stat.mode & 0o777,
				isSymlink: linkStat.isSymbolicLink(),
				linkTarget: linkStat.isSymbolicLink() ? fs.readlinkSync(filename) : null,
			};
		} catch (err) {
			if (err.code === "ENOENT") {
				return {
					path: filename,
					exists: false,
					content: null,
					mode: null,
					isSymlink: false,
					linkTarget: null,
				};
			}
			throw err;
		}
	});

/**
 * Restores a previously captured certificate snapshot, including Certbot's
 * original live/ symlink destinations when applicable.
 */
export const restoreCertificateFiles = (snapshot) => {
	for (const item of snapshot) {
		if (!item.exists) {
			removeIfExists(item.path);
			continue;
		}

		fs.mkdirSync(path.dirname(item.path), { recursive: true });

		if (item.isSymlink && item.linkTarget) {
			let currentTarget = null;
			try {
				if (fs.lstatSync(item.path).isSymbolicLink()) {
					currentTarget = fs.readlinkSync(item.path);
				}
			} catch (err) {
				if (err.code !== "ENOENT") throw err;
			}

			if (currentTarget !== item.linkTarget) {
				removeIfExists(item.path);
				fs.symlinkSync(item.linkTarget, item.path);
			}
		}

		fs.writeFileSync(item.path, item.content, { mode: safeMode(item.mode, 0o644) });
		try {
			fs.chmodSync(item.path, safeMode(item.mode, 0o644));
		} catch {
			// Best effort on filesystems that do not support chmod.
		}
	}
};

export const runCertificateMutationWithRollback = async ({
	paths,
	mutate,
	validate,
	activate,
	commit,
	rollbackCommit,
	log = () => {},
}) => {
	const snapshot = snapshotCertificateFiles(paths);

	try {
		await mutate();
		if (validate) await validate();
		if (activate) await activate();
		if (commit) await commit();
		return true;
	} catch (err) {
		if (rollbackCommit) {
			try {
				await rollbackCommit();
			} catch (dbRollbackErr) {
				err.databaseRollbackError = dbRollbackErr;
				log(`CRITICAL: certificate database rollback failed: ${dbRollbackErr.message}`);
			}
		}

		try {
			restoreCertificateFiles(snapshot);
			if (activate) await activate();
		} catch (rollbackErr) {
			err.rollbackError = rollbackErr;
			log(`CRITICAL: certificate file rollback failed: ${rollbackErr.message}`);
		}
		throw err;
	}
};

export default {
	applyAtomicCertificateFiles,
	snapshotCertificateFiles,
	restoreCertificateFiles,
	runCertificateMutationWithRollback,
};
