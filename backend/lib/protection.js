import net from "node:net";

export const PROTECTION_PROFILES = Object.freeze(["off", "standard", "aggressive"]);
export const HOST_PROTECTION_PROFILES = Object.freeze(["inherit", ...PROTECTION_PROFILES]);

const PROFILE_CONFIG = Object.freeze({
	standard: {
		rate: "30r/s",
		burst: 60,
		connections: 40,
		clientHeaderTimeout: "15s",
		clientBodyTimeout: "30s",
		sendTimeout: "30s",
	},
	aggressive: {
		rate: "10r/s",
		burst: 20,
		connections: 15,
		clientHeaderTimeout: "10s",
		clientBodyTimeout: "15s",
		sendTimeout: "20s",
	},
});

const parseNetwork = (value) => {
	if (typeof value !== "string") {
		throw new Error("Trusted networks must be strings");
	}

	const trimmed = value.trim();
	if (!trimmed) {
		throw new Error("Trusted networks cannot contain empty entries");
	}

	const parts = trimmed.split("/");
	if (parts.length > 2) {
		throw new Error("Invalid trusted network: " + trimmed);
	}

	const address = parts[0];
	const version = net.isIP(address);
	if (!version) {
		throw new Error("Invalid trusted IP or network: " + trimmed);
	}

	const maxPrefix = version === 4 ? 32 : 128;
	let prefix = maxPrefix;
	if (parts.length === 2) {
		if (!/^\d+$/.test(parts[1])) {
			throw new Error("Invalid CIDR prefix: " + trimmed);
		}
		prefix = Number.parseInt(parts[1], 10);
		if (prefix < 0 || prefix > maxPrefix) {
			throw new Error("Invalid CIDR prefix: " + trimmed);
		}
	}

	return address + "/" + prefix;
};

export const normalizeProtectionSetting = (data) => {
	if (!PROTECTION_PROFILES.includes(data?.value)) {
		throw new Error("Protection profile must be off, standard, or aggressive");
	}

	const trustedNetworks = data?.meta?.trusted_networks ?? [];
	if (!Array.isArray(trustedNetworks)) {
		throw new Error("Trusted networks must be an array");
	}
	if (trustedNetworks.length > 128) {
		throw new Error("No more than 128 trusted networks may be configured");
	}

	const normalized = [...new Set(trustedNetworks.map(parseNetwork))];

	return {
		value: data.value,
		meta: {
			trusted_networks: normalized,
		},
	};
};

export const validateHostProtectionProfile = (value) => {
	const profile = value ?? "inherit";
	if (!HOST_PROTECTION_PROFILES.includes(profile)) {
		throw new Error("Protection profile must be inherit, off, standard, or aggressive");
	}
	return profile;
};

export const normalizeHostProtectionProfile = (value) => {
	try {
		return validateHostProtectionProfile(value);
	} catch {
		return "inherit";
	}
};

const renderGlobalDirectives = (profile) => {
	if (profile === "off") {
		return "# Global HTTP protection is disabled. Hosts may still opt into a protection profile.";
	}

	const cfg = PROFILE_CONFIG[profile];
	return [
		"# Global " + profile + " protection policy",
		"limit_req zone=npm_protection_" + profile + " burst=" + cfg.burst + " nodelay;",
		"limit_conn npm_protection_conn " + cfg.connections + ";",
		"limit_req_status 429;",
		"limit_conn_status 429;",
		"limit_req_log_level warn;",
		"limit_conn_log_level warn;",
		"client_header_timeout " + cfg.clientHeaderTimeout + ";",
		"client_body_timeout " + cfg.clientBodyTimeout + ";",
		"send_timeout " + cfg.sendTimeout + ";",
		"reset_timedout_connection on;",
	].join("\n");
};

export const renderProtectionPolicy = (setting) => {
	const normalized = normalizeProtectionSetting(setting);
	const trusted = [
		"127.0.0.1/32",
		"::1/128",
		...normalized.meta.trusted_networks,
	].filter((value, index, values) => values.indexOf(value) === index);

	const trustedLines = trusted.map((network) => "    " + network + " 1;").join("\n");

	return [
		"# NPM Improved managed protection policy.",
		"# This file is generated. Configure it from Settings > Protection.",
		"",
		"geo $npm_protection_trusted {",
		"    default 0;",
		trustedLines,
		"}",
		"",
		"map $npm_protection_trusted $npm_protection_key {",
		"    0 \"$binary_remote_addr:$host\";",
		"    1 \"\";",
		"}",
		"",
		"# Requests using an empty key are not accounted by Nginx limit zones.",
		"# These zones let a host explicitly override an inherited global policy with Off.",
		"map $host $npm_protection_off_key {",
		"    default \"\";",
		"}",
		"",
		"limit_req_zone $npm_protection_key zone=npm_protection_standard:20m rate=" + PROFILE_CONFIG.standard.rate + ";",
		"limit_req_zone $npm_protection_key zone=npm_protection_aggressive:20m rate=" + PROFILE_CONFIG.aggressive.rate + ";",
		"limit_conn_zone $npm_protection_key zone=npm_protection_conn:20m;",
		"",
		"limit_req_zone $npm_protection_off_key zone=npm_protection_off:1m rate=1r/s;",
		"limit_conn_zone $npm_protection_off_key zone=npm_protection_off_conn:1m;",
		"",
		renderGlobalDirectives(normalized.value),
		"",
	].join("\n");
};

export const getProtectionProfileConfig = (profile) => PROFILE_CONFIG[profile] || null;
