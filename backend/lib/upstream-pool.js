const MODES = Object.freeze(["round-robin", "least-conn", "ip-hash", "failover"]);
const SCHEMES = Object.freeze(["http", "https"]);

const asInteger = (value, fallback, min, max, label) => {
	const parsed = Number.parseInt(value ?? fallback, 10);
	if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
		throw new Error(`${label} must be between ${min} and ${max}`);
	}
	return parsed;
};

const normalizeHost = (value) => {
	const host = String(value || "").trim();
	if (!host || host.length > 255) {
		throw new Error("Each upstream hostname or IP must be between 1 and 255 characters");
	}
	if (/\s/.test(host) || /[\/\\]/.test(host)) {
		throw new Error("Upstream hostnames and IPs cannot contain whitespace or paths");
	}
	if (host.startsWith("[") && host.endsWith("]")) {
		return host.slice(1, -1);
	}
	return host;
};

const normalizeTarget = (input, index) => {
	const target = input && typeof input === "object" ? input : {};
	const scheme = String(target.scheme || target.forward_scheme || "").toLowerCase();
	if (!SCHEMES.includes(scheme)) {
		throw new Error(`Upstream ${index + 1} scheme must be http or https`);
	}

	const normalized = {
		scheme,
		host: normalizeHost(target.host || target.forward_host),
		port: asInteger(target.port ?? target.forward_port, null, 1, 65535, `Upstream ${index + 1} port`),
		weight: asInteger(target.weight, 1, 1, 256, `Upstream ${index + 1} weight`),
		max_fails: asInteger(target.max_fails ?? target.maxFails, 3, 1, 100, `Upstream ${index + 1} max failures`),
		fail_timeout: asInteger(
			target.fail_timeout ?? target.failTimeout,
			10,
			1,
			3600,
			`Upstream ${index + 1} fail timeout`,
		),
		enabled: target.enabled !== false,
	};

	const name = String(target.name || "").trim();
	if (name) {
		if (name.length > 100) {
			throw new Error(`Upstream ${index + 1} name cannot exceed 100 characters`);
		}
		normalized.name = name;
	}

	return normalized;
};

const fromLegacy = (data) => [{
	scheme: String(data.forward_scheme || "http").toLowerCase(),
	host: String(data.forward_host || "").trim(),
	port: Number.parseInt(data.forward_port, 10),
	weight: 1,
	max_fails: 3,
	fail_timeout: 10,
	enabled: true,
}];

const normalizeProxyHostPool = (data, current = null) => {
	const legacyFieldsProvided = ["forward_scheme", "forward_host", "forward_port"].some(
		(key) => typeof data[key] !== "undefined",
	);
	let source;

	if (Array.isArray(data.upstreams)) {
		source = data.upstreams;
	} else if (legacyFieldsProvided && Array.isArray(current?.upstreams) && current.upstreams.length > 1) {
		source = current.upstreams.map((target, index) =>
			index === 0
				? {
						...target,
						scheme: data.forward_scheme ?? target.scheme,
						host: data.forward_host ?? target.host,
						port: data.forward_port ?? target.port,
					}
				: target,
		);
	} else if (legacyFieldsProvided) {
		source = fromLegacy({ ...current, ...data });
	} else if (Array.isArray(current?.upstreams) && current.upstreams.length) {
		source = current.upstreams;
	} else {
		source = fromLegacy({ ...current, ...data });
	}

	if (!source.length) {
		throw new Error("At least one upstream target is required");
	}

	const upstreams = source.map(normalizeTarget);
	const enabled = upstreams.filter((target) => target.enabled);
	if (!enabled.length) {
		throw new Error("At least one upstream target must be enabled");
	}

	const schemes = new Set(enabled.map((target) => target.scheme));
	if (schemes.size !== 1) {
		throw new Error("All enabled upstream targets in a pool must use the same scheme");
	}

	const keys = new Set();
	for (const target of enabled) {
		const key = `${target.scheme}://${target.host.toLowerCase()}:${target.port}`;
		if (keys.has(key)) {
			throw new Error(`Duplicate upstream target: ${key}`);
		}
		keys.add(key);
	}

	const mode = String(data.upstream_mode || current?.upstream_mode || "round-robin");
	if (!MODES.includes(mode)) {
		throw new Error(`Upstream mode must be one of: ${MODES.join(", ")}`);
	}

	const primary = enabled[0];
	return {
		upstreams,
		upstream_mode: mode,
		forward_scheme: primary.scheme,
		forward_host: primary.host,
		forward_port: primary.port,
	};
};

export { MODES, SCHEMES, normalizeProxyHostPool };
