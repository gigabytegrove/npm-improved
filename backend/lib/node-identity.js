import fs from "node:fs";

const READY_PATH = "/data/host-updater-ready.json";

export function isValidHostName(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 253 &&
    /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/.test(value) &&
    !/[.]{2}/.test(value);
}

/**
 * The NPMX display name may be synchronized or renamed, and os.hostname()
 * inside Docker usually identifies a container, not its Linux host.
 * Read the node-local, host-generated updater readiness marker instead.
 * Explicit NPM_NODE_HOSTNAME is the fallback for custom deployments.
 */
export function getServingNodeHostname({
  env = process.env,
  markerPath = READY_PATH,
} = {}) {
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
    // Legacy deployments can supply the physical hostname explicitly.
  }
  return isValidHostName(env.NPM_NODE_HOSTNAME) ? env.NPM_NODE_HOSTNAME : null;
}
