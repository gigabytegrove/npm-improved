import fs from "node:fs";

const READY_PATH = "/data/host-updater-ready.json";
// New supported Compose deployments mount the real Linux host read-only.
// In-app upgrades retain existing Compose files, so the native host-updater
// marker provides the physical host name when the mount is not present.
// Docker's os.hostname() identifies the container, not its host.
const HOSTNAME_PATH = "/run/npm-improved/host-hostname";

export function isValidHostName(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 253 &&
    /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/.test(value) &&
    !/[.]{2}/.test(value);
}

function readHostFile(filename) {
  try {
    const value = fs.readFileSync(filename, "utf8").trim();
    return isValidHostName(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Obtain the physical Linux host name without trusting the Docker container ID.
 * A new Compose deployment can supply the read-only /etc/hostname mount.
 * Existing in-app upgrades retain their Compose file. Their native host
 * dispatch automatically refreshes the host-updater marker from the matching
 * published release after the new application becomes healthy, exposing the
 * real hostname without overwriting an operator-customized Compose file.
 * Custom deployments can instead supply an explicit override.
 */
export function getServingNodeHostname({
  env = process.env,
  markerPath = READY_PATH,
  hostnamePath = HOSTNAME_PATH,
} = {}) {
  const hostFileName = readHostFile(hostnamePath);
  if (hostFileName) return hostFileName;

  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    const matchesProject = typeof env.NPM_HOST_PROJECT_DIR === "string" &&
      env.NPM_HOST_PROJECT_DIR !== "" &&
      marker.project_dir === env.NPM_HOST_PROJECT_DIR;
    if (marker.mode === "native-host-service" && matchesProject &&
      isValidHostName(marker.host_hostname)) {
      return marker.host_hostname;
    }
  } catch {
    // A missing or older marker is normal on legacy deployments.
  }
  return isValidHostName(env.NPM_NODE_HOSTNAME) ? env.NPM_NODE_HOSTNAME : null;
}
