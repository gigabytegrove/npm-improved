/**
 * Optional per-node Let's Encrypt certificate for the Control Center hostname.
 * Issuance never changes the Go :81 HTTP listener or Nginx :443 routing.
 * The binding lives on the certificate record so normal renewal/lifecycle can
 * safely keep it, without introducing a second credential/certificate store.
 */
import fs from "node:fs";
import { X509Certificate } from "node:crypto";
import internalCertificate from "../internal/certificate.js";
import internalNginx from "../internal/nginx.js";
import { renderManagementHttps } from "./management-https-render.js";
import { applyConfigTransaction, removeConfigTransaction } from "./nginx-transaction.js";
import { getServingNodeHostname } from "./node-identity.js";
import certificateModel from "../models/certificate.js";
import proxyHostModel from "../models/proxy_host.js";
import redirectionHostModel from "../models/redirection_host.js";
import deadHostModel from "../models/dead_host.js";
import errs from "./error.js";
import { validateNodeCertificateName } from "./management-hostname-validation.js";

const pending = new Set();
const httpsPending = new Set();
const managementConfigPath = "/data/nginx/management_host/management-https.conf";
const localAdminPort = () => Number(process.env.NPM_ADMIN_PORT || 81);
const hasLocalHttpsConfig = () => fs.existsSync(managementConfigPath);

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
        enabled: hasLocalHttpsConfig(),
        httpsUrl: hasLocalHttpsConfig() && certificate ? "https://" + certificate.meta.management_hostname : null,
        httpManagementPort: localAdminPort(),
        message: "Certificate issuance is separate from explicitly enabling a host-specific HTTPS management route on port 443.",
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
    if (hasLocalHttpsConfig()) throw new errs.ValidationError("Disable management HTTPS before releasing its certificate assignment.");
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


/**
 * Opt-in HTTPS on standard Nginx 443 for ONLY this node's exact SNI name.
 * The independent HTTP control plane remains on port 81 for recovery.
 */
export async function setManagementHttps(access, enabled) {
    await access.can("settings:update", "management-certificate");
    if (typeof enabled !== "boolean") {
        throw new errs.ValidationError("enabled must be true or false.");
    }
    const node = getServingNodeHostname()?.toLowerCase();
    if (!node) throw new errs.ValidationError("Physical node hostname unavailable.");
    if (httpsPending.has(node) || pending.has(node)) {
        throw new errs.ValidationError("Another management certificate operation is already running.");
    }
    httpsPending.add(node);
    try {
        if (!enabled) {
            await removeConfigTransaction({
                livePath: managementConfigPath,
                validate: () => internalNginx.test(),
                reload: () => internalNginx.reload(),
            });
            return getManagementCertificateStatus(access);
        }
        const certificate = await boundCertificate(node);
        if (!certificate) {
            throw new errs.ValidationError("Request a valid certificate for this physical node before enabling HTTPS.");
        }
        const hostname = validateNodeCertificateName(node, certificate.meta.management_hostname);
        const liveDir = internalCertificate.getLiveCertPath(certificate.id);
        const certFile = liveDir + "/fullchain.pem";
        const keyFile = liveDir + "/privkey.pem";
        if (!fs.existsSync(certFile) || !fs.existsSync(keyFile)) {
            throw new errs.ValidationError("Certificate or private key missing from this node. Reissue the local certificate.");
        }
        let certificateInfo;
        try { certificateInfo = new X509Certificate(fs.readFileSync(certFile)); }
        catch { throw new errs.ValidationError("The certificate PEM is invalid."); }
        if (!certificateInfo.checkHost(hostname)) {
            throw new errs.ValidationError("The certificate does not cover this management hostname.");
        }
        if (Date.parse(certificateInfo.validTo) <= Date.now()) {
            throw new errs.ValidationError("The management certificate has expired.");
        }
        const models = [proxyHostModel, redirectionHostModel, deadHostModel];
        for (const model of models) {
            const rows = await model.query().where("is_deleted", 0);
            if (rows.some(row => row.domain_names?.some(name =>
                String(name).toLowerCase() === hostname))) {
                throw new errs.ValidationError(
                    "A proxy/redirection/dead host already claims " + hostname +
                    ". Resolve that hostname conflict before activating Management HTTPS."
                );
            }
        }
        const rendered = renderManagementHttps({
            hostname, certificateId: certificate.id, adminPort: localAdminPort()
        });
        if (hasLocalHttpsConfig()) {
            const existing = fs.readFileSync(managementConfigPath, "utf8");
            if (existing === rendered) return getManagementCertificateStatus(access);
        }
        // A pre-existing error is fixed before a new vhost is introduced.
        await internalNginx.test();
        try {
            await applyConfigTransaction({
                livePath: managementConfigPath,
                renderCandidate: async candidate => {
                    fs.writeFileSync(candidate, rendered, { encoding: "utf8", mode: 0o640 });
                },
                validate: () => internalNginx.test(),
                reload: () => internalNginx.reload(),
            });
        } catch (cause) {
            throw new errs.ConfigurationError(
                "Management HTTPS activation failed Nginx validation/reload; previous config preserved. " +
                (cause instanceof Error ? cause.message : String(cause))
            );
        }
        return getManagementCertificateStatus(access);
    } finally { httpsPending.delete(node); }
}
