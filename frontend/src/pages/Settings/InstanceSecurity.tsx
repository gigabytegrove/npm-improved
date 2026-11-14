import { useCallback, useEffect, useState } from "react";
import { Alert } from "react-bootstrap";
import * as api from "src/api/backend/base";

type Mode = "static" | "forwarded" | "dmz" | "unmanaged";
type FirewallState = "active" | "deferred";
type Port = { port: number; protocol: "tcp" | "udp"; sources: string[] };
type Configuration = {
  configured: boolean; mode: Mode; state: FirewallState;
  trustedNetworks: string[]; hostLanIp: string; acknowledgedDmz: boolean;
};
type SecurityStatus = {
  config: Configuration;
  state: string;
  enforced: boolean;
  helperReady: boolean;
  helperError: string | null;
  managementPort: number;
  hostLanIp: string | null;
  containerAddresses: string[];
  dockerPublishing: string;
  ports: Port[];
  warning: string;
  pendingUntil: string | null;
  droppedPackets: number | null;
  droppedBytes: number | null;
};
const models: Array<{ value: Mode; title: string; description: string }> = [
  { value: "static", title: "Static IP — Managed",
    description: "A fixed upstream/public IP or fixed local destination. NPMi filters its entire instance network namespace." },
  { value: "forwarded", title: "Dynamic IP — Port forwarding",
    description: "Forward TCP 80/443 on your router. New stream ports require an additional router forward and Docker publishing." },
  { value: "dmz", title: "Dynamic IP — Router DMZ",
    description: "Your router forwards unsolicited traffic to NPMi. Default-deny filtering is critical. This carries more risk than selective forwarding." },
  { value: "unmanaged", title: "Unmanaged — External firewall",
    description: "Your hardware firewall manages network access. NPMi continues threat detection and application-layer protections only." },
];
const defaultNetworks = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"].join("\n");

export default function InstanceSecurity() {
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [mode, setMode] = useState<Mode>("unmanaged");
  const [networks, setNetworks] = useState(defaultNetworks);
  const [hostLanIp, setHostLanIp] = useState("");
  const [acknowledgedDmz, setAcknowledgedDmz] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmActivation, setConfirmActivation] = useState(false);

  const load = useCallback(async () => {
    const result = await api.get({ url: "/instance-security" }) as SecurityStatus;
    setStatus(result);
    setMode(result.config.mode);
    setNetworks(result.config.trustedNetworks.join("\n"));
    setHostLanIp(result.config.hostLanIp || "");
    setAcknowledgedDmz(result.config.acknowledgedDmz);
    return result;
  }, []);

  useEffect(() => {
    let present = true;
    void load().catch((e: Error) => { if (present) setError(e.message); })
      .finally(() => { if (present) setLoading(false); });
    return () => { present = false; };
  }, [load]);

  const save = async (nextState: FirewallState) => {
    if (busy) return;
    setError("");
    setMessage("");
    if (mode === "dmz" && !acknowledgedDmz) {
      setError("Read and acknowledge the DMZ warning before saving.");
      return;
    }
    if (nextState === "active" && !confirmActivation) {
      setError("Confirm that your management networks are correct before activating filtering.");
      return;
    }
    setBusy(true);
    try {
      await api.put({
        url: "/instance-security",
        data: {
          mode, state: mode === "unmanaged" ? "deferred" : nextState,
          trustedNetworks: networks.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
          hostLanIp: hostLanIp.trim(),
          acknowledgedDmz: mode === "dmz" ? acknowledgedDmz : false,
        },
      });
      await load();
      setConfirmActivation(false);
      setMessage(nextState === "active" && mode !== "unmanaged"
        ? "Temporary policy applied. Verify connectivity and confirm activation within two minutes or it will automatically revert."
        : "Instance security configuration saved.");
    } catch (e: any) {
      setError(e?.message || "Unable to save instance security.");
    } finally {
      setBusy(false);
    }
  };

  const confirmPending = async () => {
    setBusy(true);
    setError("");
    try {
      await api.post({ url: "/instance-security/confirm", data: {} });
      await load();
      setMessage("Firewall activation confirmed.");
    } catch (e: any) {
      setError(e?.message || "Unable to confirm firewall activation.");
    } finally { setBusy(false); }
  };

  if (loading) return <main aria-busy="true" className="p-4">Loading instance security...</main>;

  return (
    <main className="container-fluid py-4" style={{ maxWidth: 1120 }}>
      <header className="mb-4">
        <h1 className="h2 mb-2">Instance Security</h1>
        <p className="text-secondary mb-0">One firewall policy for the entire NPMi Docker instance. No separate firewall settings on proxy hosts, streams, or DNS records.</p>
      </header>

      {error ? <Alert variant="danger" role="alert">{error}</Alert> : null}
      {message ? <Alert variant="success" role="status">{message}</Alert> : null}

      {status?.pendingUntil ? (
        <Alert variant="warning" role="alert">
          <strong>Activation must be confirmed.</strong> This temporary firewall policy will automatically revert after {new Date(status.pendingUntil).toLocaleTimeString()} if not confirmed.
          <div className="mt-2">
            <button className="btn btn-primary" type="button" disabled={busy || !status.enforced}
              onClick={() => void confirmPending()}>Confirm firewall activation</button>
          </div>
          {!status.enforced ? <p className="mt-2 mb-0">Awaiting a verified response from the firewall companion. Refresh status to retry.</p> : null}
        </Alert>
      ) : null}
      {status ? (
        <section className="mb-4" aria-label="Enforcement status">
          <h2 className="h4">Current protection</h2>
          <p className="mb-2"><strong>Firewall: {status.state.replace(/_/g, " ")}</strong>
            {" — "}{status.enforced ? "The companion reported the policy applied inside NPMi; router restrictions and source-address fidelity are not verified." :
              status.state === "unmanaged" ? "Network filtering is delegated to your external firewall." :
              status.state === "deferred" ? "NPMi is not filtering inbound network traffic." :
              "Enforcement has not been verified."}</p>
          {status.helperError && status.state !== "unmanaged" && status.state !== "deferred"
            ? <Alert variant="warning">{status.helperError}</Alert> : null}
          <p className="text-secondary small">{status.warning}</p>
          {status.enforced && status.droppedPackets !== null ? (
            <p className="mb-2"><strong>{status.droppedPackets.toLocaleString()}</strong> dropped packets · {status.droppedBytes?.toLocaleString() || "0"} bytes, since the current policy was applied.</p>
          ) : null}
          <p className="text-secondary small mb-0">Firewall helper: {status.helperReady ? "Reporting" : "Unavailable"} · Docker port publication: not verified · Router forwarding: not verified</p>
        </section>
      ) : null}

      <section className="mb-4" aria-labelledby="deployment-heading">
        <h2 className="h4" id="deployment-heading">Deployment model</h2>
        <p className="text-secondary">This determines who controls network filtering for the instance. It does not reconfigure your router.</p>
        <fieldset disabled={busy}>
          <legend className="visually-hidden">Deployment model</legend>
          {models.map((item) => (
            <label key={item.value} className="d-flex gap-3 py-3 border-bottom" style={{ cursor: "pointer" }}>
              <input type="radio" className="form-check-input mt-1" name="deployment" checked={mode === item.value}
                onChange={() => { setMode(item.value); setConfirmActivation(false); }} />
              <span><strong className="d-block">{item.title}</strong>
                <span className="text-secondary">{item.description}</span></span>
            </label>
          ))}
        </fieldset>
      </section>

      {mode === "dmz" ? (
        <Alert variant="warning" className="mb-4">
          <h2 className="h5">Router DMZ is an advanced, higher-exposure option</h2>
          <p>Your router may forward unsolicited internet traffic to NPMi. The instance firewall cannot secure the router, the Docker host, other containers, or applications behind it. Port forwarding only what you need is safer. IPv6 needs independent review.</p>
          <label className="d-flex gap-2 align-items-start">
            <input type="checkbox" checked={acknowledgedDmz} onChange={(e) => setAcknowledgedDmz(e.target.checked)} />
            <span>I understand the DMZ risks and will independently secure the Docker host and router.</span>
          </label>
        </Alert>
      ) : null}

      <section className="mb-4" aria-labelledby="management-heading">
        <h2 className="h4" id="management-heading">Management access</h2>
        <p className="text-secondary">The instance policy permits management traffic from these addresses on container TCP {status?.managementPort || 81}. Docker or a userland proxy may rewrite source IPs. Also restrict public management access at the router or host; do not rely on this source restriction alone.</p>
        <label className="form-label" htmlFor="trusted-cidrs">Trusted IP addresses and CIDRs (one per line)</label>
        <textarea id="trusted-cidrs" className="form-control font-monospace mb-3" rows={5} value={networks}
          onChange={(e) => setNetworks(e.target.value)} disabled={busy || mode === "unmanaged"} />
        <label className="form-label" htmlFor="host-lan-ip">Docker host LAN IP</label>
        <input id="host-lan-ip" className="form-control mb-2" type="text" inputMode="decimal"
          placeholder="Enter the Docker host LAN IP used by your router" value={hostLanIp}
          disabled={busy} onChange={(e) => setHostLanIp(e.target.value)} />
        <p className="text-secondary small">NPMi cannot reliably infer the Docker host's LAN address from a bridged container. This value is used for routing instructions, not to configure your router.</p>
      </section>

      <section aria-labelledby="ports-heading" className="mb-4">
        <h2 className="h4" id="ports-heading">Instance permitted ports</h2>
        <p className="text-secondary">This policy is generated from active NPMi services. Adding, disabling, or deleting a stream automatically updates the instance rule set.</p>
        <div className="table-responsive">
          <table className="table">
            <thead><tr><th scope="col">Protocol</th><th scope="col">Incoming port</th><th scope="col">Required by</th><th scope="col">Docker publication</th></tr></thead>
            <tbody>{status?.ports.map((port) => (
              <tr key={port.protocol + port.port}>
                <td>{port.protocol.toUpperCase()}</td><td>{port.port}</td>
                <td>{port.sources.join(", ")}</td><td>Not verified</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {mode === "forwarded" ? (
          <Alert variant="info">For every additional stream port, publish that TCP/UDP port in Docker and forward it on your router to <strong>{hostLanIp || status?.hostLanIp || "the Docker host's LAN IP"}</strong>. Firewall permission alone does not expose the service.</Alert>
        ) : mode === "dmz" ? (
          <Alert variant="warning">The DMZ destination must be the Docker host's reachable LAN address. Docker must still publish custom stream ports. Unpublished ports cannot be reached through ordinary bridge networking.</Alert>
        ) : null}
      </section>

      <section aria-label="Apply instance policy" className="border-top pt-4">
        {mode !== "unmanaged" ? (
          <label className="d-flex gap-2 mb-3">
            <input type="checkbox" checked={confirmActivation} onChange={(e) => setConfirmActivation(e.target.checked)} />
            <span>I have verified management access, router exposure, and the network addresses before activating filtering.</span>
          </label>
        ) : null}
        <div className="d-flex gap-2 flex-wrap">
          <button className="btn btn-outline-primary" type="button" disabled={busy}
            onClick={() => void save("deferred")}>Save / defer enforcement</button>
          {mode !== "unmanaged" ? <button className="btn btn-primary" type="button"
            disabled={busy || !confirmActivation || (mode === "dmz" && !acknowledgedDmz)}
            onClick={() => void save("active")}>Activate managed firewall</button> : null}
          <button className="btn btn-outline-secondary" type="button" disabled={busy}
            onClick={() => { setLoading(true); void load().catch((e: Error) => setError(e.message)).finally(() => setLoading(false)); }}>Refresh status</button>
        </div>
        <p className="small text-secondary mt-3">This controls only the NPMi instance network namespace. Existing host and router security policies are not changed. Always retain an independent recovery path.</p>
      </section>
    </main>
  );
}
