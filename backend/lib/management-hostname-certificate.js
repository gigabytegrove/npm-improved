/**
 * Optional per-node Let's Encrypt certificate for the Control Center hostname.
 * Issuance never changes the Go :81 HTTP listener or Nginx :443 routing.
 * The binding lives on the certificate record so normal renewal/lifecycle can
 * safely keep it, without introducing a second credential/certificate store.
 */
import fs from "node:fs";
import internalCertificate from "../internal/certificate.js";
import { getServingNodeHostname } from "./node-identity.js";
import certificateModel from "../models/certificate.js";
import errs from "./error.js";
import { validateNodeCertificateName } from "./management-hostname-validation.js";

const pending = new Set();

function summarize(certificate) {
    if (!certificate) return null;
    return {
        id: certificate.id,
        hostname: certificate.meta?.management_hostname || certificate.domain_names?.[0] || null,
        expiresOn: certificate.expires_on,
        provider: certificate.provider,
        status: certificate.expires_on && new Date(certificate.expires_on).getTime() < Date.now()
            ? "expired" : "issued",
    };
}

async function boundCertificate(node) {
    // A shared NPMX database can contain certificates owned by other nodes.
    // Only the exact local node's binding is visible in this setting.
    const rows = await certificateModel.query().where("is_deleted", 0)
        .andWhere("provider", "letsencrypt");
    return rows.find((row) =>
        row.meta?.management_node === node &&
        row.meta?.management_hostname &&
        row.domain_names?.includes(row.meta.management_hostname) &&
        fs.existsSync(internalCertificate.getLiveCertPath(row.id) + "/fullchain.pem")
    ) || null;
}

export async function getManagementCertificateStatus(access) {
    await access.can("settings:get");
    const node = getServingNodeHostname();
    const certificate = node ? await boundCertificate(node.toLowerCase()) : null;
    return {
        nodeHostname: node,
        certificate: summarize(certificate),
        available: Boolean(node),
        enabled: false, // Issuance is separate from enabling any TLS listener.
        httpManagementPort: 81,
        message: "Issuing a certificate does not change the existing HTTP management listener or HTTPS proxy-host routing.",
    };
}

export async function requestManagementCertificate(access, hostname) {
    await access.can("settings:get");
    const node = getServingNodeHostname()?.toLowerCase();
    const requested = validateNodeCertificateName(node, hostname);
    await access.can("certificates:create", { provider: "letsencrypt", domain_names: [requested] });
    if (pending.has(node)) {
        throw new errs.ValidationError("A management hostname certificate request is already running for this node.");
    }
    pending.add(node);
    try {
        let certificate = await boundCertificate(node);
        if (certificate) {
            if (certificate.meta.management_hostname !== requested) {
                throw new errs.ValidationError("This node already has a management hostname certificate. Keep the existing hostname or explicitly release it before replacing it.");
            }
            return { nodeHostname: node, certificate: summarize(certificate), reused: true };
        }

        // Reuse an existing *local* Let's Encrypt certificate for this exact
        // domain rather than issue a duplicate. Verify the files exist first.
        const rows = await certificateModel.query().where("is_deleted", 0).andWhere("provider", "letsencrypt");
        certificate = rows.find((row) =>
            row.domain_names?.includes(requested) &&
            !row.meta?.management_node &&
            fs.existsSync(internalCertificate.getLiveCertPath(row.id) + "/fullchain.pem") &&
            new Date(row.expires_on).getTime() > Date.now()
        );
        if (certificate) {
            certificate = await certificateModel.query().patchAndFetchById(certificate.id, {
                meta: { ...certificate.meta, management_node: node, management_hostname: requested },
            });
            return { nodeHostname: node, certificate: summarize(certificate), reused: true };
        }

        const created = await internalCertificate.create(access, {
            provider: "letsencrypt",
            domain_names: [requested],
            meta: {
                dns_challenge: false,
                management_node: node,
                management_hostname: requested,
            },
        });
        return { nodeHostname: node, certificate: summarize(created), reused: false };
    } finally {
        pending.delete(node);
    }
}

/** Forget only this node's optional designation; retain the issued certificate. */
export async function releaseManagementCertificate(access) {
    await access.can("settings:get");
    const node = getServingNodeHostname()?.toLowerCase();
    if (!node) throw new errs.ValidationError("Physical node hostname unavailable.");
    if (pending.has(node)) {
        throw new errs.ValidationError("Wait until the certificate request finishes.");
    }
    const certificate = await boundCertificate(node);
    if (!certificate) return { released: true, certificateRetained: true };
    await access.can("certificates:update", { id: certificate.id });
    const meta = { ...certificate.meta };
    delete meta.management_node;
    delete meta.management_hostname;
    await certificateModel.query().patchAndFetchById(certificate.id, { meta });
    return { released: true, certificateRetained: true };
}
