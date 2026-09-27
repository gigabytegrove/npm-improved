export const DEFAULT_UNUSED_RETENTION_DAYS = 30;

export const normalizeCertificateLifecyclePolicy = (setting) => {
	const retention = Number.parseInt(setting?.meta?.unused_retention_days, 10);
	return {
		enabled: setting?.value !== "disabled",
		unusedRetentionDays:
			Number.isInteger(retention) && retention >= 1 && retention <= 3650
				? retention
				: DEFAULT_UNUSED_RETENTION_DAYS,
		purgeCustomCertificates: setting?.meta?.purge_custom_certificates !== false,
	};
};

export const calculateCertificateLifecycle = ({
	certificate,
	usageCount,
	policy,
	now = new Date(),
}) => {
	const inUse = usageCount > 0;
	const providerEligible = certificate.provider !== "other" || policy.purgeCustomCertificates;

	if (inUse) {
		return {
			isInUse: true,
			usageCount,
			unusedSince: null,
			purgeEligibleOn: null,
			autoPurgeEligible: false,
			shouldPurge: false,
		};
	}

	const storedUnusedSince = certificate.meta?.lifecycle_unused_since;
	const parsedUnusedSince = storedUnusedSince ? Date.parse(storedUnusedSince) : Number.NaN;
	const unusedSince = Number.isFinite(parsedUnusedSince) ? new Date(parsedUnusedSince) : now;
	const purgeEligibleOn = new Date(
		unusedSince.getTime() + policy.unusedRetentionDays * 24 * 60 * 60 * 1000,
	);
	const autoPurgeEligible = policy.enabled && providerEligible;

	return {
		isInUse: false,
		usageCount: 0,
		unusedSince: unusedSince.toISOString(),
		purgeEligibleOn: purgeEligibleOn.toISOString(),
		autoPurgeEligible,
		shouldPurge: autoPurgeEligible && now.getTime() >= purgeEligibleOn.getTime(),
	};
};

export default {
	DEFAULT_UNUSED_RETENTION_DAYS,
	normalizeCertificateLifecyclePolicy,
	calculateCertificateLifecycle,
};
