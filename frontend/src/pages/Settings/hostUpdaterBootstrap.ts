/** Existing native host service cannot replace its own root-owned programs
 * from inside the unprivileged application container. Generate a verified,
 * copy-and-run one-time bootstrap for that precise host project instead.
 */
const quoteShell = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
export const hostUpdaterBootstrap = (projectDir: string, version: string) => {
	if (!/^v?\d+\.\d+\.\d+$/.test(version)) return null;
	const release = version.startsWith("v") ? version : `v${version}`;
	return [
		"set -euo pipefail",
		`NPMI_PROJECT=${quoteShell(projectDir)}`,
		`NPMI_RELEASE=${quoteShell(release)}`,
		'NPMI_ASSET="npm-improved-${NPMI_RELEASE}-host-updater.tar.gz"',
		'NPMI_SUMS="npm-improved-${NPMI_RELEASE}-SHA256SUMS.txt"',
		'NPMI_TMP="$(mktemp -d)"',
		'trap \'rm -rf "$NPMI_TMP"\' EXIT',
		'cd "$NPMI_TMP"',
		'NPMI_BASE="https://github.com/gigabytegrove/npm-improved/releases/download/${NPMI_RELEASE}"',
		'curl -fsSL "$NPMI_BASE/$NPMI_SUMS" -o "$NPMI_SUMS"',
		'curl -fsSL "$NPMI_BASE/$NPMI_ASSET" -o "$NPMI_ASSET"',
		'grep -F "  $NPMI_ASSET" "$NPMI_SUMS" > selected-checksum.txt',
		'sha256sum -c selected-checksum.txt',
		'tar -xzf "$NPMI_ASSET"',
		'sudo bash scripts/install-host-updater "$NPMI_PROJECT"',
	].join("\n");
};
