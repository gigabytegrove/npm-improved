import fs from "node:fs";
import { dirname } from "node:path";

const removeIfExists = (filename) => {
	try {
		fs.unlinkSync(filename);
	} catch (err) {
		if (err.code !== "ENOENT") {
			throw err;
		}
	}
};

const moveIfExists = (source, destination) => {
	try {
		fs.renameSync(source, destination);
		return true;
	} catch (err) {
		if (err.code === "ENOENT") {
			return false;
		}
		throw err;
	}
};

const ensureParent = (filename) => {
	fs.mkdirSync(dirname(filename), { recursive: true });
};

export const cleanNginxError = (err) => {
	const text = err instanceof Error ? err.message : String(err);
	return text
		.split("\n")
		.filter((line) => !line.includes('/var/log/nginx/error.log'))
		.join("\n")
		.trim();
};

/**
 * Atomically applies one generated Nginx config.
 *
 * The existing live file is preserved until the replacement candidate has
 * rendered successfully. If validation or reload fails, the candidate is kept
 * as <live>.err and the last-known-good config is restored.
 */
export const applyConfigTransaction = async ({
	livePath,
	renderCandidate,
	validate,
	reload,
	log = () => {},
}) => {
	const candidatePath = `${livePath}.candidate`;
	const rollbackPath = `${livePath}.last-good`;
	const errorPath = `${livePath}.err`;

	ensureParent(livePath);
	removeIfExists(candidatePath);
	removeIfExists(rollbackPath);

	try {
		await renderCandidate(candidatePath);
	} catch (err) {
		removeIfExists(candidatePath);
		throw err;
	}

	const hadPrevious = fs.existsSync(livePath);
	if (hadPrevious) {
		fs.renameSync(livePath, rollbackPath);
	}
	fs.renameSync(candidatePath, livePath);

	try {
		await validate();
	} catch (err) {
		const message = cleanNginxError(err);
		log(`Nginx candidate validation failed for ${livePath}: ${message}`);
		removeIfExists(errorPath);
		moveIfExists(livePath, errorPath);
		if (hadPrevious) {
			fs.renameSync(rollbackPath, livePath);
		}

		const wrapped = new Error(message || "Nginx candidate validation failed");
		wrapped.cause = err;
		wrapped.phase = "validate";
		throw wrapped;
	}

	try {
		await reload();
	} catch (err) {
		const message = cleanNginxError(err);
		log(`Nginx reload failed for ${livePath}; restoring last-known-good config: ${message}`);
		removeIfExists(errorPath);
		moveIfExists(livePath, errorPath);
		if (hadPrevious) {
			fs.renameSync(rollbackPath, livePath);
		}

		let rollbackError = null;
		try {
			await validate();
			await reload();
		} catch (restoreErr) {
			rollbackError = restoreErr;
			log(`CRITICAL: rollback reload failed for ${livePath}: ${cleanNginxError(restoreErr)}`);
		}

		const wrapped = new Error(message || "Nginx reload failed");
		wrapped.cause = err;
		wrapped.phase = "reload";
		if (rollbackError) {
			wrapped.rollbackError = rollbackError;
		}
		throw wrapped;
	}

	removeIfExists(rollbackPath);
	removeIfExists(errorPath);
	return { hadPrevious };
};

/**
 * Transactionally removes one Nginx config. The file is first moved aside,
 * then the resulting Nginx configuration is validated and reloaded. Failure
 * restores the file and reloads the last-known-good state.
 */
export const removeConfigTransaction = async ({
	livePath,
	validate,
	reload,
	log = () => {},
}) => {
	if (!fs.existsSync(livePath)) {
		return { existed: false };
	}

	const rollbackPath = `${livePath}.last-good`;
	removeIfExists(rollbackPath);
	fs.renameSync(livePath, rollbackPath);

	try {
		await validate();
		await reload();
	} catch (err) {
		const message = cleanNginxError(err);
		log(`Nginx config removal failed for ${livePath}; restoring last-known-good config: ${message}`);

		if (fs.existsSync(livePath)) {
			removeIfExists(livePath);
		}
		fs.renameSync(rollbackPath, livePath);

		let rollbackError = null;
		try {
			await validate();
			await reload();
		} catch (restoreErr) {
			rollbackError = restoreErr;
			log(`CRITICAL: rollback reload failed for ${livePath}: ${cleanNginxError(restoreErr)}`);
		}

		const wrapped = new Error(message || "Nginx config removal failed");
		wrapped.cause = err;
		wrapped.phase = "remove";
		if (rollbackError) {
			wrapped.rollbackError = rollbackError;
		}
		throw wrapped;
	}

	removeIfExists(rollbackPath);
	return { existed: true };
};

export default applyConfigTransaction;
