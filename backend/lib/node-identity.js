import fs from "node:fs";

const READY_PATH = "/data/host-updater-ready.json";
// Mounted read-only from the real Linux Docker host by every supported Compose
// deployment. Docker's os.hostname() identifies the container, not its host.
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
 * The Compose-mounted host /etc/hostname is available on existing installs as
 * soon as their container is recreated. Managed installations also have the
 * trusted node-local updater marker; custom deployments may use an override.
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
