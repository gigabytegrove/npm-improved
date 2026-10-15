import { IconCertificate, IconExternalLink, IconRefresh } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Alert } from "react-bootstrap";
import { Link } from "react-router-dom";
import * as api from "src/api/backend/base";
import { Loading } from "src/components";

interface ManagementCertificate {
    id: number;
    hostname: string;
    expiresOn: string;
    provider: string;
    status: string;
}
interface CertificateStatus {
    nodeHostname: string | null;
    certificate: ManagementCertificate | null;
    available: boolean;
    enabled: boolean;
    httpManagementPort: number;
    message: string;
}
interface RequestResult {
    nodeHostname: string;
    certificate: ManagementCertificate;
    reused: boolean;
}

export default function ManagementCertificateSettings() {
    const [status, setStatus] = useState<CertificateStatus | null>(null);
    const [hostname, setHostname] = useState("");
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    const load = async (updateInput = false) => {
        const response = (await api.get({ url: "/settings/management-certificate" })) as CertificateStatus;
        setStatus(response);
        if (updateInput) {
            const current = window.location.hostname.toLowerCase();
            const node = response.nodeHostname?.toLowerCase() || "";
            const browserMatch = Boolean(node) && current.startsWith(node + ".") && current.split(".").length >= 3;
            setHostname(response.certificate?.hostname || (browserMatch ? current : ""));
        }
    };
    useEffect(() => {
        let disposed = false;
        api.get({ url: "/settings/management-certificate" })
            .then((response: CertificateStatus) => {
                if (disposed) return;
                setStatus(response);
                const current = window.location.hostname.toLowerCase();
                const node = response.nodeHostname?.toLowerCase() || "";
                setHostname(response.certificate?.hostname ||
                    (node && current.startsWith(node + ".") && current.split(".").length >= 3 ? current : ""));
            })
            .catch((err: Error) => { if (!disposed) setError(err.message); })
            .finally(() => { if (!disposed) setLoading(false); });
        return () => { disposed = true; };
    }, []);

    async function requestCertificate() {
        if (busy || !hostname.trim()) return;
        setError("");
        setSuccess("");
        setBusy(true);
        try {
            const result = (await api.post({
                url: "/settings/management-certificate",
                data: { hostname: hostname.trim() },
            })) as RequestResult;
            setSuccess(result.reused
                ? "An existing certificate has been reserved for this management hostname."
                : "Certificate issued successfully. Existing HTTP and proxy host listeners were not changed.");
            await load(true);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Certificate request failed.");
        } finally { setBusy(false); }
    }

    if (loading) return <div className="card-body"><Loading noLogo /></div>;

    const assigned = status?.certificate;
    const node = status?.nodeHostname;
    const ready = Boolean(node && hostname.trim());
    return (
        <>
            <div className="card-body">
                <div className="d-flex align-items-start gap-3 mb-4">
                    <IconCertificate size={27} className="mt-1 flex-shrink-0" />
                    <div>
                        <h3 className="mb-1">Management Hostname Certificate</h3>
                        <p className="text-secondary mb-0">
                            Optionally request a Let's Encrypt certificate for this server's public DNS hostname.
                            Nothing changes unless you request it.
                        </p>
                    </div>
                </div>
                {error && <Alert variant="danger" dismissible onClose={() => setError("")}>{error}</Alert>}
                {success && <Alert variant="success" dismissible onClose={() => setSuccess("")}>{success}</Alert>}
                <div className="row g-3 mb-4">
                    <div className="col-sm-6">
                        <div className="border rounded p-3 h-100">
                            <div className="text-secondary small mb-1">Physical server</div>
                            <div className="fw-semibold">{node || "Unknown"}</div>
                            <div className="text-secondary small mt-2">This certificate is scoped to this node.</div>
                        </div>
                    </div>
                    <div className="col-sm-6">
                        <div className="border rounded p-3 h-100">
                            <div className="text-secondary small mb-1">Current certificate</div>
                            <div className="fw-semibold">{assigned ? assigned.hostname : "Not requested"}</div>
                            <div className="text-secondary small mt-2">
                                {assigned ? assigned.status + " · Expires " +
                                    new Date(assigned.expiresOn).toLocaleDateString() :
                                    "Optional · Existing HTTP management unchanged"}
                            </div>
                        </div>
                    </div>
                </div>
                <label className="form-label" htmlFor="management-node-domain">Public DNS hostname for this server</label>
                <input
                    id="management-node-domain"
                    type="text"
                    className="form-control"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={node ? node + ".example.com" : "server.example.com"}
                    value={hostname}
                    disabled={busy || !status?.available || Boolean(assigned)}
                    onChange={(event) => setHostname(event.target.value)}
                />
                <p className="text-secondary small mt-2">
                    The hostname must begin with <code>{node || "server"}.</code>, identify this node,
                    and resolve publicly to a system that can answer Let's Encrypt HTTP-01 validation
                    on port 80.
                    {node === "proxy1" ? " Example: proxy1.gigabytegrove.net." : ""}
                    {node === "proxy2" ? " Example: proxy2.gigabytegrove.net." : ""}
                </p>
                <Alert variant="info" className="mb-3">
                    <strong>Certificate only.</strong> Requesting this certificate does not enable HTTPS
                    on port 81 or 443, switch the Go management listener, or modify proxy-host routes.
                    The certificate is retained for standard renewal. HTTPS termination must be configured separately.
                </Alert>
                {!status?.available && (
                    <Alert variant="warning">
                        The physical server hostname is unavailable. Configure NPM_NODE_HOSTNAME
                        before requesting the certificate.
                    </Alert>
                )}
            </div>
            <div className="card-footer bg-transparent d-flex flex-wrap justify-content-between align-items-center gap-2">
                <Link className="btn btn-outline-secondary" to="/certificates">
                    <IconExternalLink size={16} className="me-2" /> View certificates
                </Link>
                <div className="d-flex gap-2">
                    <button type="button" className="btn btn-outline-secondary" disabled={busy}
                        onClick={() => { setError(""); load().catch((err: Error) => setError(err.message)); }}
                        aria-label="Refresh management certificate status">
                        <IconRefresh size={17} />
                    </button>
                    <button type="button" className="btn btn-primary"
                        disabled={!ready || busy || Boolean(assigned)}
                        onClick={requestCertificate}>
                        {busy ? "Requesting certificate…" : assigned ? "Certificate reserved" : "Request SSL certificate"}
                    </button>
                </div>
            </div>
        </>
    );
}
