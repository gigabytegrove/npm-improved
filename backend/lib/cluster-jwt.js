import crypto from "node:crypto";
import fs from "node:fs";

const CLUSTER_SECRET_FILE = "/data/cluster-secret";
const CLUSTER_JWT_CONTEXT = Buffer.from("npm-improved/npmx/access-token/v1", "utf8");
const MIN_CLUSTER_SECRET_LENGTH = 24;

/**
 * NPMX pairing provisions the same high-entropy secret to both nodes. Derive
 * a purpose-specific symmetric JWT key without copying RSA private keys
 * between physical hosts or using the NPMX signing secret directly.
 *
 * Unpaired/standalone deployments retain the existing RS256 key pair.
 */
export function getClusterJwtKey(secretPath = CLUSTER_SECRET_FILE) {
  try {
    const secret = fs.readFileSync(secretPath, "utf8").trim();
    if (secret.length < MIN_CLUSTER_SECRET_LENGTH) return null;
    return Buffer.from(crypto.hkdfSync(
      "sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0),
      CLUSTER_JWT_CONTEXT, 32,
    ));
  } catch {
    return null;
  }
}
