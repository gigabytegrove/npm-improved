import { useEffect, useState } from "react";
import { IconActivityHeartbeat, IconRefresh, IconShieldCheck, IconShieldOff } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import * as api from "src/api/backend/base";
import type { FirewallMode, FirewallState, InstanceFirewallStatus } from "src/api/backend/instanceFirewall";
import { HasPermission } from "src/components";
import { useFirewallActions, useInstanceFirewall, FIREWALL_QUERY_KEY } from "src/hooks/useInstanceFirewall";
import { ADMIN, MANAGE } from "src/modules/Permissions";
import styles from "./Firewall.module.css";

const modes: Array<{ id: FirewallMode; title: string; detail: string }> = [
  { id: "static", title: "Static IP — managed", detail: "Fixed upstream or local destination; filtering applies to the NPMi network namespace." },
  { id: "forwarded", title: "Dynamic IP — port forwarding", detail: "Your router forwards only selected services. Docker publication remains a separate requirement." },
  { id: "dmz", title: "Dynamic IP — router DMZ", detail: "Router forwards unsolicited traffic. Higher risk; NPMi cannot protect the Docker host or router." },
  { id: "unmanaged", title: "External firewall", detail: "Filtering is delegated to your network firewall; NPMi retains application-layer protections." },
];

function showTime(value?: string | null) {
  if (!value) return "Not reported";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Not reported" : parsed.toLocaleString();
}

function enforcementLabel(data: InstanceFirewallStatus) {
  if (!data.enabled) return data.releasePending ? "Disabling — awaiting companion" : "Disabled";
  if (data.pendingUntil) return "Awaiting activation confirmation";
  if (data.enforced) return "Active — companion reporting";
  if (data.state === "unmanaged") return "Externally managed";
  if (data.state === "not_configured") return "Setup required";
  if (data.state === "deferred") return "Configured, not enforcing";
  return "Needs attention";
}

export default function FirewallSettings() {
  const queryClient = useQueryClient();
  const { data, isLoading, isFetching, error, refetch } = useInstanceFirewall();
  const { toggle, reconcile, confirm } = useFirewallActions();
  const [mode, setMode] = useState<FirewallMode>("static");
  const [networks, setNetworks] = useState("");
  const [acknowledgedDmz, setAcknowledgedDmz] = useState(false);
  const [confirmActivation, setConfirmActivation] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  useEffect(() => {
    if (data?.config && !dirty) {
      setMode(data.config.mode);
      setNetworks(data.config.trustedNetworks.join("\n"));
      setAcknowledgedDmz(data.config.acknowledgedDmz);
    }
  }, [data?.config, dirty]);

  const busy = toggle.isPending || reconcile.isPending || confirm.isPending || savingPolicy;
  const enabled = data?.enabled === true;
  const compatible = typeof data?.enabled === "boolean";

  async function execute(action: () => Promise<unknown>, success: string) {
    if (busy) return;
    setActionError("");
    setActionMessage("");
    try {
      await action();
      setActionMessage(success);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "The firewall request failed.");
    }
  }

  async function changeEnabled(next: boolean) {
    if (!data || busy || enabled === next) return;
    if (!next && !window.confirm(
      "Disable instance firewall functionality? NPMi will release managed filtering rules. Existing proxy hosts and streams will remain unchanged.",
    )) return;
    await execute(
      () => toggle.mutateAsync(next),
      next ? "Firewall controls enabled. Packet filtering still requires explicit activation." :
        "Firewall disable requested. The companion must confirm that its rules were removed.",
    );
  }

  async function savePolicy(state: FirewallState) {
    if (!data || busy || !enabled) return;
    if (mode === "dmz" && !acknowledgedDmz) {
      setActionError("Acknowledge the DMZ exposure warning before saving.");
      return;
    }
    if (state === "active" && !confirmActivation) {
      setActionError("Review management access and confirm before activating packet filtering.");
      return;
    }
    setSavingPolicy(true);
    setActionError("");
    setActionMessage("");
    try {
      await api.put({
        url: "/instance-security",
        data: {
          enabled: true,
          mode,
          state: mode === "unmanaged" ? "deferred" : state,
          trustedNetworks: networks.split(/\r?\n/).map((network) => network.trim()).filter(Boolean),
          // Preserve existing legacy host guidance, but never substitute a
          // container bridge IP or require manual entry.
          hostLanIp: data.config.hostLanIp || "",
          acknowledgedDmz: mode === "dmz" && acknowledgedDmz,
        },
      });
      setDirty(false);
      setConfirmActivation(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: FIREWALL_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ["system-health"] }),
      ]);
      setActionMessage(state === "active" && mode !== "unmanaged"
        ? "Temporary policy submitted. Confirm activation within two minutes after verifying management connectivity."
        : "Instance firewall policy saved. Packet filtering has not been activated by this action.");
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Unable to save firewall policy.");
    } finally {
      setSavingPolicy(false);
    }
  }

  return (
    <div className={styles.page} aria-busy={isLoading || busy}>
      <div className={styles.heading}>
        <div>
          <h2 className="h2 mb-1">Instance firewall</h2>
          <p className="text-secondary mb-0">
            One policy for the NPMi instance. Configuration, actual filtering, and network exposure in one place.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={() => void refetch()}
          disabled={busy || isFetching}
        >
          <IconRefresh size={17} aria-hidden="true" /> Refresh status
        </button>
      </div>

      {isLoading && !data ? <p role="status">Loading firewall configuration and live status…</p> : null}
      {error ? <div className="alert alert-danger" role="alert">Firewall status unavailable: {error.message}</div> : null}
      {actionError ? <div className="alert alert-danger" role="alert">{actionError}</div> : null}
      {actionMessage ? <div className="alert alert-success" role="status">{actionMessage}</div> : null}
      {data && !compatible ? (
        <div className="alert alert-warning" role="status">The backend does not support this firewall API. No changes were made.</div>
      ) : null}

      {data && compatible ? (
        <>
          <section className={styles.topLine} aria-label="Firewall master switch">
            <div className={styles.switchCopy}>
              {enabled
                ? <IconShieldCheck size={28} className="text-success" aria-hidden="true" />
                : <IconShieldOff size={28} className="text-secondary" aria-hidden="true" />}
              <div>
                <h3 className="h4 mb-1">Enable instance firewall</h3>
                <p className="text-secondary mb-0">
                  {enabled ? "Controls are available. Enforcement is separately activated." :
                    "Feature disabled. The companion is responsible for releasing filtering rules."}
                </p>
              </div>
            </div>
            <HasPermission section={ADMIN} permission={MANAGE} hideError>
              <label className={styles.switchLabel} htmlFor="firewall-feature-enabled">
                <input
                  id="firewall-feature-enabled"
                  className="form-check-input"
                  role="switch"
                  type="checkbox"
                  checked={enabled}
                  disabled={busy || isLoading}
                  onChange={(event) => void changeEnabled(event.target.checked)}
                />
                <span>{enabled ? "On" : "Off"}</span>
              </label>
            </HasPermission>
          </section>

          <section className={styles.statusLine} aria-label="Actual firewall enforcement">
            <div>
              <div className={styles.metaLabel}>Packet filtering</div>
              <strong className={styles.statusText}>
                <IconActivityHeartbeat size={20} aria-hidden="true" /> {enforcementLabel(data)}
              </strong>
              <p className="text-secondary small mb-0">Feature enabled does not mean a firewall is enforcing rules.</p>
            </div>
            <div>
              <div className={styles.metaLabel}>Firewall companion</div>
              <strong>{data.helperReady ? "Reporting" : "Unavailable"}</strong>
              <p className="text-secondary small mb-0">{data.state.replace(/_/g, " ")}</p>
            </div>
            <div>
              <div className={styles.metaLabel}>Dropped traffic</div>
              <strong>{data.enforced && data.droppedPackets != null ?
                data.droppedPackets.toLocaleString() + " packets" : "Not measured"}</strong>
              <p className="text-secondary small mb-0">{data.enforced && data.droppedBytes != null
                ? data.droppedBytes.toLocaleString() + " bytes" : "Requires active, reporting companion"}</p>
            </div>
          </section>

          {data.helperError && enabled ? <p className="text-danger" role="alert">{data.helperError}</p> : null}
          {data.releasePending ? (
            <div className="alert alert-warning" role="status">
              The firewall companion has not yet confirmed removal of its filtering rules.
            </div>
          ) : null}
          {enabled && !data.enforced && !data.pendingUntil ? (
            <div className="alert alert-warning" role="status">
              NPMi has not verified active packet filtering. Saving a policy alone does not make it active.
            </div>
          ) : null}
          {data.pendingUntil ? (
            <div className="alert alert-warning" role="alert">
              <strong>Activation requires confirmation by {showTime(data.pendingUntil)}.</strong>
              The temporary policy automatically reverts if it is not confirmed.
              <HasPermission section={ADMIN} permission={MANAGE} hideError>
                <div className="mt-2">
                  <button type="button" className="btn btn-primary" disabled={busy || !data.enforced}
                    onClick={() => void execute(
                      () => confirm.mutateAsync(), "Firewall activation confirmed.",
                    )}>
                    Confirm activation
                  </button>
                </div>
              </HasPermission>
            </div>
          ) : null}

          <section className={styles.section} aria-labelledby="network-identity-title">
            <h3 className="h3" id="network-identity-title">Detected network addresses</h3>
            <p className="text-secondary">
              Observed automatically. Host-network containers see host interfaces; bridged containers see their
              own Docker IPs. Public IP is the internet egress address, not proof of inbound accessibility.
            </p>
            <div className={styles.identityGrid}>
              <div>
                <div className={styles.metaLabel}>NPMi network-namespace IPv4</div>
                <strong className={styles.ipValue}>{data.instanceIp || "Unavailable"}</strong>
                <p className="small text-secondary mb-0">
                  {data.networkMode === "host" ? "Host networking (deployment metadata)" :
                    data.networkMode === "bridge" ? "Docker bridge networking (deployment metadata)" :
                      "Network mode unverified; address read from the running namespace"}
                </p>
              </div>
              <div>
                <div className={styles.metaLabel}>Public IPv4</div>
                <strong className={styles.ipValue}>{data.publicIpv4 || "Detection unavailable"}</strong>
                <p className="small text-secondary mb-0">Verified by two external services · {showTime(data.publicIpObservedAt)}</p>
              </div>
              <div>
                <div className={styles.metaLabel}>Docker host LAN (router destination)</div>
                <strong className={styles.ipValue}>{data.hostLanIp ||
                  (data.networkMode === "host" ? data.instanceIp : null) || "Not independently known"}</strong>
                <p className="small text-secondary mb-0">
                  {data.hostLanIp ? "Deployment-provided or previously configured address; not independently verified" :
                    data.networkMode === "host" ? "Host namespace interface address" :
                      "Cannot be safely inferred from a bridged container's IP"}
                </p>
              </div>
            </div>
            {data.networkInterfaces?.length ? (
              <div className={styles.interfaces}>
                Interfaces: {data.networkInterfaces.map((row) => row.interface + " · " + row.address).join("   |   ")}
              </div>
            ) : null}
          </section>

          <section className={styles.section} aria-labelledby="rules-title">
            <div className={styles.sectionHeading}>
              <div>
                <h3 className="h3 mb-1" id="rules-title">Actual firewall configuration</h3>
                <p className="text-secondary mb-0">
                  Kernel nftables rules reported by the namespace-scoped firewall companion, separate from the saved policy.
                </p>
              </div>
              <span className={styles.observation}>{data.liveRulesObservedAt ?
                "Observed " + showTime(data.liveRulesObservedAt) : "No live observation"}</span>
            </div>
            {data.liveRules && data.helperReady ? (
              <pre className={styles.rules} tabIndex={0} aria-label="Live nftables ruleset">{data.liveRules}</pre>
            ) : (
              <p className={styles.emptyRules} role="status">
                No active kernel firewall rules have been confirmed by the companion.
                The saved policy below is not proof of enforcement.
              </p>
            )}
            <details className={styles.desiredPolicy}>
              <summary>View saved / desired firewall policy</summary>
              <pre className={styles.rules} tabIndex={0} aria-label="Desired firewall policy">
                {data.desiredPolicy ? JSON.stringify(data.desiredPolicy, null, 2) : "No generated policy available."}
              </pre>
            </details>
          </section>

          <HasPermission section={ADMIN} permission={MANAGE} hideError>
            <section className={styles.section} aria-labelledby="deployment-title">
              <h3 className="h3" id="deployment-title">Deployment model</h3>
              <p className="text-secondary">This selects which policy NPMi manages. It does not modify your router or host firewall.</p>
              <fieldset disabled={busy || !enabled} className={styles.modeGrid}>
                <legend className="visually-hidden">Instance deployment model</legend>
                {modes.map((item) => (
                  <label key={item.id} className={styles.modeOption}>
                    <input type="radio" className="form-check-input" name="firewall-mode"
                      value={item.id} checked={mode === item.id}
                      onChange={() => { setMode(item.id); setDirty(true); setConfirmActivation(false); }} />
                    <span>
                      <strong>{item.title}</strong>
                      <span className="text-secondary">{item.detail}</span>
                    </span>
                  </label>
                ))}
              </fieldset>

              {mode === "dmz" ? (
                <div className="alert alert-warning mt-3">
                  Router DMZ may expose more services than intended. NPMi cannot secure your router, other
                  containers, or the host. IPv6 exposure must be reviewed separately.
                  <label className="d-flex align-items-start gap-2 mt-2">
                    <input type="checkbox" checked={acknowledgedDmz}
                      disabled={busy || !enabled}
                      onChange={(event) => { setAcknowledgedDmz(event.target.checked); setDirty(true); }} />
                    <span>I understand these risks and have independently secured the host and router.</span>
                  </label>
                </div>
              ) : null}
            </section>

            <section className={styles.section} aria-labelledby="management-title">
              <h3 className="h3" id="management-title">Trusted management networks</h3>
              <p className="text-secondary">
                These CIDRs are allowed to reach TCP {data.managementPort} when filtering is active.
                Docker proxying may change source IPs; verify access before activation.
              </p>
              <label className="form-label" htmlFor="trusted-management-networks">Allowed IPv4 / IPv6 CIDRs (one per line)</label>
              <textarea id="trusted-management-networks" rows={5} className={styles.networkInput + " form-control font-monospace"}
                spellCheck={false} value={networks} disabled={busy || !enabled || mode === "unmanaged"}
                onChange={(event) => { setNetworks(event.target.value); setDirty(true); setConfirmActivation(false); }} />
            </section>
          </HasPermission>

          <section className={styles.section} aria-labelledby="ports-title">
            <h3 className="h3" id="ports-title">Permitted instance ports</h3>
            <p className="text-secondary">
              Generated from HTTP, HTTPS, management, and enabled streams. Firewall permission does not publish Docker ports
              or configure router forwarding.
            </p>
            <div className="table-responsive">
              <table className="table table-vcenter">
                <thead>
                  <tr><th scope="col">Protocol</th><th scope="col">Port</th><th scope="col">Service</th>
                    <th scope="col">Docker publishing</th><th scope="col">Router / upstream</th></tr>
                </thead>
                <tbody>
                  {(data.ports || []).map((port) => {
                    const plan = data.exposurePlan?.required?.find((rule) =>
                      rule.port === port.port && rule.protocol === port.protocol);
                    return (
                      <tr key={port.protocol + "-" + port.port}>
                        <td>{port.protocol.toUpperCase()}</td>
                        <td className="font-monospace">{port.port}</td>
                        <td>{port.sources.join(", ")}</td>
                        <td>{plan?.dockerInstruction || "Unverified"}</td>
                        <td>{plan?.routerInstruction || "Unverified"}</td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td>TCP</td><td className="font-monospace">{data.managementPort}</td>
                    <td>Management</td><td>Verify the running host port mapping</td>
                    <td>Restrict access to trusted networks</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <HasPermission section={ADMIN} permission={MANAGE} hideError>
            <section className={styles.actions} aria-label="Save and activate firewall policy">
              {enabled && mode !== "unmanaged" ? (
                <label className="d-flex align-items-start gap-2">
                  <input type="checkbox" checked={confirmActivation} disabled={busy}
                    onChange={(event) => setConfirmActivation(event.target.checked)} />
                  <span>I have verified trusted management networks and connectivity, and understand the two-minute
                    confirmation/rollback window.</span>
                </label>
              ) : null}
              <div className="d-flex flex-wrap gap-2">
                <button type="button" className="btn btn-outline-primary" disabled={busy || !enabled}
                  onClick={() => void savePolicy("deferred")}>
                  {savingPolicy ? "Saving…" : "Save policy without enforcement"}
                </button>
                {mode !== "unmanaged" ? (
                  <button type="button" className="btn btn-primary"
                    disabled={busy || !enabled || !confirmActivation || (mode === "dmz" && !acknowledgedDmz)}
                    onClick={() => void savePolicy("active")}>
                    Activate firewall (confirm within 2 minutes)
                  </button>
                ) : null}
                <button type="button" className="btn btn-outline-secondary" disabled={busy || !enabled}
                  onClick={() => void execute(
                    () => reconcile.mutateAsync(), "Firewall reconciliation requested; check the reported rules above.",
                  )}>
                  Refresh applied policy
                </button>
              </div>
              {dirty ? <p className="text-warning-emphasis small mb-0">You have unsaved policy changes.</p> : null}
              <p className="text-secondary small mb-0">Existing proxy hosts, streams, Docker publishing, router rules,
                and firewall configuration outside NPMi's network namespace are not modified here.</p>
            </section>
          </HasPermission>
        </>
      ) : null}
    </div>
  );
}
