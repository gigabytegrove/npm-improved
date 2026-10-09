/**
 * Instance Synchronization nodes have independent configuration databases and
 * proxy runtimes. They may be upgraded sequentially. NPMX already enforces
 * exact application-version matching before applying a configuration snapshot.
 *
 * This does not coordinate overlapping updates across nodes. Operators must
 * finish verifying one node before starting the next.
 */
export function evaluateNpmxRollingUpdate(sync) {
	if (!sync?.enabled) {
		return { enabled: false, role: null, requiresSequentialUpdates: false };
	}
	if (!["primary", "secondary"].includes(sync.role)) {
		throw new RangeError("Instance Synchronization must have a primary or secondary role before updating.");
	}
	return { enabled: true, role: sync.role, requiresSequentialUpdates: true };
}
