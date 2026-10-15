import errs from "./error.js";

/** Only allow requesting a certificate for this physical node's DNS name. */
export function validateNodeCertificateName(node, hostname) {
    const normalizedNode = String(node || "").trim().toLowerCase();
    const requested = String(hostname || "").trim().toLowerCase().replace(/\.$/, "");
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(normalizedNode)) {
        throw new errs.ValidationError("The physical node hostname is unavailable or invalid. Configure NPM_NODE_HOSTNAME before requesting a management certificate.");
    }
    if (requested.length > 253 || !/^[a-z0-9.-]+$/.test(requested) ||
        !requested.startsWith(normalizedNode + ".") || requested.includes("..")) {
        throw new errs.ValidationError("Enter the full public DNS hostname for this node (for example, " + normalizedNode + ".example.com).");
    }
    const labels = requested.split(".");
    if (labels.length < 3 || labels.some((label) => label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) ||
        /^[0-9]+$/.test(labels.at(-1))) {
        throw new errs.ValidationError("The management hostname must be a valid, public DNS name.");
    }
    return requested;
}
