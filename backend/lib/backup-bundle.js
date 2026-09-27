import crypto from "node:crypto";
import zlib from "node:zlib";

const MAGIC = Buffer.from("NPMI-BACKUP-1\n", "utf8");
const FORMAT = "npm-improved-backup";
const FORMAT_VERSION = 1;
const ALGORITHM = "aes-256-gcm";

const requirePassphrase = (passphrase) => {
	if (typeof passphrase !== "string" || passphrase.length < 12) {
		throw new Error("Backup passphrase must be at least 12 characters");
	}
};

export const createBackupEnvelope = (payload, passphrase) => {
	requirePassphrase(passphrase);

	const normalized = {
		format: FORMAT,
		format_version: FORMAT_VERSION,
		...payload,
	};

	const plaintext = zlib.gzipSync(Buffer.from(JSON.stringify(normalized), "utf8"), { level: 9 });
	const salt = crypto.randomBytes(16);
	const iv = crypto.randomBytes(12);
	const key = crypto.scryptSync(passphrase, salt, 32);
	const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
	const tag = cipher.getAuthTag();

	const envelope = {
		format: FORMAT,
		envelope_version: 1,
		algorithm: ALGORITHM,
		kdf: "scrypt",
		salt: salt.toString("base64"),
		iv: iv.toString("base64"),
		tag: tag.toString("base64"),
		ciphertext: ciphertext.toString("base64"),
	};

	return Buffer.concat([MAGIC, Buffer.from(JSON.stringify(envelope), "utf8")]);
};

export const openBackupEnvelope = (input, passphrase) => {
	requirePassphrase(passphrase);

	const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
	if (buffer.length <= MAGIC.length || !buffer.subarray(0, MAGIC.length).equals(MAGIC)) {
		throw new Error("Not an NPM Improved backup bundle");
	}

	let envelope;
	try {
		envelope = JSON.parse(buffer.subarray(MAGIC.length).toString("utf8"));
	} catch {
		throw new Error("Backup envelope is not valid JSON");
	}

	if (
		envelope?.format !== FORMAT ||
		envelope?.envelope_version !== 1 ||
		envelope?.algorithm !== ALGORITHM ||
		envelope?.kdf !== "scrypt"
	) {
		throw new Error("Unsupported NPM Improved backup envelope");
	}

	try {
		const salt = Buffer.from(envelope.salt, "base64");
		const iv = Buffer.from(envelope.iv, "base64");
		const tag = Buffer.from(envelope.tag, "base64");
		const ciphertext = Buffer.from(envelope.ciphertext, "base64");
		const key = crypto.scryptSync(passphrase, salt, 32);
		const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
		decipher.setAuthTag(tag);
		const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
		const payload = JSON.parse(zlib.gunzipSync(compressed).toString("utf8"));

		if (payload?.format !== FORMAT || payload?.format_version !== FORMAT_VERSION) {
			throw new Error("Unsupported NPM Improved backup format");
		}
		return payload;
	} catch (err) {
		if (err?.message?.startsWith("Unsupported NPM Improved backup format")) {
			throw err;
		}
		throw new Error("Backup could not be decrypted. Check the passphrase and file integrity.");
	}
};

export const backupMagic = () => MAGIC.toString("utf8");
export const backupFormatVersion = () => FORMAT_VERSION;
