import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  addNodeBlock, deleteNodeBlock, enableNodeScannerPreset, getNodeBlocks,
  type NodeBlockRule, type NodeReport,
} from "src/api/backend";

const count = (n: number) => Number(n || 0).toLocaleString();
const when = (date: string) => new Date(date).toLocaleString();

export type InvestigationTab = "clients" | "agents" | "blocks";

export default function NodeInvestigation({
  tab, report, onFilterIp, onFilterAgent, onFilterBot, onGoToRequests, onGoToBlocks,
}: {
  tab: InvestigationTab;
  report: NodeReport;
  onFilterIp: (ip: string) => void;
  onFilterAgent: (agent: string) => void;
  onFilterBot: (bot: string) => void;
  onGoToRequests: () => void;
  onGoToBlocks: () => void;
}) {
  const [blockType, setBlockType] = useState<NodeBlockRule["type"]>("ip");
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const blockRules = useQuery({
    queryKey: ["node-analytics-block-rules"],
    queryFn: getNodeBlocks,
    enabled: tab === "blocks",
    refetchInterval: tab === "blocks" ? 30000 : false,
  });
  const prepare = (type: NodeBlockRule["type"], input: string) => {
    setBlockType(type);
    setTarget(input);
    onGoToBlocks();
    setMessage("");
    setError("");
  };
  const apply = async () => {
    setBusy(true); setMessage(""); setError("");
    try {
      await addNodeBlock(blockType, target, note);
      setMessage("Blocking rule activated on this node.");
      setTarget(""); setNote("");
      await blockRules.refetch();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const remove = async (rule: NodeBlockRule) => {
    if (!window.confirm("Remove this " + rule.type + " block from this node?")) return;
    setBusy(true); setMessage(""); setError("");
    try {
      await deleteNodeBlock(rule.id);
      setMessage("Blocking rule removed from this node.");
      await blockRules.refetch();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const enableScanners = async () => {
    if (!window.confirm("Enable blocks for common scanner user-agent signatures on this node? These are claimed user agents and may be spoofed; legitimate scanning may also be blocked.")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await enableNodeScannerPreset();
      setMessage(count(result.added) + " known scanner signatures activated.");
      await blockRules.refetch();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  if (tab === "clients") return <>
    <div className="row row-cards mb-3">
      <div className="col-sm-6 col-lg-4"><div className="card card-body">
        <div className="text-secondary">Distinct source IPs</div>
        <div className="h2 mt-1">{report.uniqueIps === null ? "Not retained" : count(report.uniqueIps)}</div>
        <div className="text-secondary small">Distinct addresses, not distinct people</div>
      </div></div>
      <div className="col-sm-6 col-lg-4"><div className="card card-body">
        <div className="text-secondary">Blocked HTTP requests</div>
        <div className="h2 mt-1">{report.blockedRequests === null ? "Not retained" : count(report.blockedRequests)}</div>
        <div className="text-secondary small">Deny decisions recorded in request logs</div>
      </div></div>
      <div className="col-lg-4"><div className="card card-body">
        <div className="text-secondary">Client investigation</div>
        <div className="small mt-2">Click an address to review its detailed request and connection history.</div>
      </div></div>
    </div>
    <div className="card">
      <div className="card-header"><h3 className="card-title">Top source IP addresses on this node</h3></div>
      <div className="table-responsive"><table className="table card-table table-vcenter">
        <thead><tr><th>Client IP</th><th className="text-end">Requests</th><th className="text-end">Errors</th>
          <th>First observed</th><th>Last observed</th><th>Actions</th></tr></thead>
        <tbody>
          {report.ips.map((row) => <tr key={row.ip}>
            <td className="text-break"><button type="button" className="btn btn-link p-0" onClick={() => {
              onFilterIp(row.ip); onGoToRequests();
            }}>{row.ip}</button></td>
            <td className="text-end">{count(row.requests)}</td><td className="text-end">{count(row.errors)}</td>
            <td>{when(row.firstSeen)}</td><td>{when(row.lastSeen)}</td>
            <td><button type="button" className="btn btn-sm btn-outline-danger"
              onClick={() => prepare("ip", row.ip)}>Block IP</button></td>
          </tr>)}
          {!report.ips.length ? <tr><td colSpan={6} className="text-secondary">
            No IP-enriched events for the selected range. Collection begins after the new version is installed.
          </td></tr> : null}
        </tbody>
      </table></div>
    </div>
  </>;

  if (tab === "agents") return <>
    <div className="card mb-3">
      <div className="card-header"><h3 className="card-title">Bot and automation signals</h3></div>
      <div className="card-body text-secondary small">
        User agents are self-reported and can be impersonated. Search-crawler labels are not verification of a bot's identity.
        There is no automatic ban of ordinary crawlers.
      </div>
      <div className="table-responsive"><table className="table card-table">
        <thead><tr><th>Classification</th><th className="text-end">Requests</th><th>Inspect</th></tr></thead>
        <tbody>{report.bots.map((row) => <tr key={row.label}>
          <td>{row.label}</td><td className="text-end">{count(row.requests)}</td>
          <td><button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => {
            onFilterBot(row.label); onGoToRequests();
          }}>View requests</button></td>
        </tr>)}
          {!report.bots.length ? <tr><td colSpan={3} className="text-secondary">No retained bot classification yet.</td></tr> : null}
        </tbody>
      </table></div>
    </div>
    <div className="card"><div className="card-header"><h3 className="card-title">Full user-agent strings</h3></div>
      <div className="table-responsive"><table className="table card-table">
        <thead><tr><th>User agent</th><th className="text-end">Requests</th><th>Actions</th></tr></thead>
        <tbody>{report.userAgents.map((row, i) => <tr key={i}>
          <td className="text-break">{row.label}</td><td className="text-end">{count(row.requests)}</td>
          <td><div className="d-flex flex-wrap gap-1">
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => {
              onFilterAgent(row.label); onGoToRequests();
            }}>History</button>
            <button type="button" className="btn btn-sm btn-outline-danger" onClick={() =>
              prepare("user_agent", row.label.slice(0, 160))}>Prepare block</button>
          </div></td>
        </tr>)}
          {!report.userAgents.length ? <tr><td colSpan={3} className="text-secondary">No full user agents collected yet.</td></tr> : null}
        </tbody>
      </table></div>
    </div>
  </>;

  return <>
    <div className="alert alert-info">
      Blocking rules affect HTTP requests reaching <strong>this node only</strong>.
      Nginx validates and reloads changes, and the previous policy is restored if activation fails.
      CIDR blocks affect all addresses in a range; review the target carefully.
    </div>
    {message ? <div className="alert alert-success">{message}</div> : null}
    {error ? <div className="alert alert-danger">{error}</div> : null}
    {blockRules.error ? <div className="alert alert-danger">{blockRules.error.message}</div> : null}
    <div className="card mb-3">
      <div className="card-header"><h3 className="card-title">Block IP address or user agent</h3></div>
      <div className="card-body">
        <div className="row g-2">
          <div className="col-md-3"><label htmlFor="npmi-block-type" className="form-label">Type</label>
            <select id="npmi-block-type" className="form-select" value={blockType}
              onChange={(e) => setBlockType(e.target.value as NodeBlockRule["type"])}>
              <option value="ip">IP / CIDR</option>
              <option value="user_agent">User-agent contains</option>
            </select></div>
          <div className="col-md-6"><label htmlFor="npmi-block-target" className="form-label">Target</label>
            <input id="npmi-block-target" className="form-control" value={target} maxLength={160}
              placeholder={blockType === "ip" ? "203.0.113.10 or 2001:db8::/64" : "User-agent text (literal substring)"}
              onChange={(e) => setTarget(e.target.value)}/></div>
          <div className="col-md-3"><label htmlFor="npmi-block-note" className="form-label">Reason</label>
            <input id="npmi-block-note" className="form-control" value={note} maxLength={256}
              onChange={(e) => setNote(e.target.value)}/></div>
        </div>
        <div className="d-flex flex-wrap gap-2 mt-3">
          <button type="button" className="btn btn-danger" disabled={busy || !target.trim()}
            onClick={() => void apply()}>Block on this node</button>
          <button type="button" className="btn btn-outline-secondary" disabled={busy}
            onClick={() => void enableScanners()}>Enable known scanner signature blocking</button>
        </div>
        <div className="text-secondary small mt-2">Known-scanner blocking is opt-in. It matches scanner user-agent signatures; it does not prove a request was malicious.</div>
      </div>
    </div>
    <div className="card mb-3">
      <div className="card-header"><h3 className="card-title">Active local deny rules ({blockRules.data?.rules.length || 0})</h3></div>
      <div className="table-responsive"><table className="table card-table">
        <thead><tr><th>Type</th><th>Target</th><th>Reason</th><th>Added</th><th>Action</th></tr></thead>
        <tbody>{blockRules.data?.rules.map((rule) => <tr key={rule.id}>
          <td>{rule.type === "ip" ? "IP / CIDR" : "User agent"}</td>
          <td className="text-break">{rule.target}</td><td className="text-break">{rule.note}</td>
          <td>{new Date(rule.createdAt * 1000).toLocaleString()}</td>
          <td><button type="button" className="btn btn-sm btn-outline-danger" disabled={busy}
            onClick={() => void remove(rule)}>Unblock</button></td>
        </tr>)}
          {!blockRules.data?.rules.length ? <tr><td colSpan={5} className="text-secondary">No manual or scanner-signature blocks are active.</td></tr> : null}
        </tbody></table></div>
    </div>
    <div className="card"><div className="card-header"><h3 className="card-title">Blocking audit trail</h3></div>
      <div className="table-responsive"><table className="table card-table">
        <thead><tr><th>Time</th><th>Operator ID</th><th>Action</th><th>Type</th><th>Target</th></tr></thead>
        <tbody>{blockRules.data?.audit.map((row) => <tr key={row.id}>
          <td>{new Date(row.occurredAt * 1000).toLocaleString()}</td><td>{row.operator}</td>
          <td>{row.action}</td><td>{row.type}</td><td className="text-break">{row.target}</td>
        </tr>)}
          {!blockRules.data?.audit.length ? <tr><td colSpan={5} className="text-secondary">No recorded block changes.</td></tr> : null}
        </tbody>
      </table></div>
    </div>
  </>;
}
