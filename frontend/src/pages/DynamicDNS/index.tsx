import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Alert } from "react-bootstrap";
import * as api from "src/api/backend/base";

type Provider = { id: string; name: string; supports: string[]; credentials: string };
type RecordEntry = {
  id: string; provider: string; hostname: string; recordType: string;
  hasCredential: boolean; enabled: boolean;
  lastIp: string; lastUpdatedAt: string | null; lastCheckedAt: string | null;
  lastError: string | null;
};
type Snapshot = { providers: Provider[]; records: RecordEntry[] };
const initial = { provider: "cloudflare", hostname: "", recordType: "A", username: "", secret: "", zoneId: "", dnsRecordId: "" };

export default function DynamicDNS() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const load = useCallback(async () => {
    const result = await api.get({ url: "/dynamic-dns" }) as Snapshot;
    setSnapshot(result);
    return result;
  }, []);
  useEffect(() => {
    let active = true;
    void load().catch((e: Error) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load]);

  const perform = async (task: () => Promise<unknown>, message: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await task();
      await load();
      setSuccess(message);
    } catch (e: any) {
      setError(e?.message || "Dynamic DNS operation failed.");
    } finally {
      setBusy(false);
    }
  };
  const provider = snapshot?.providers.find((entry) => entry.id === form.provider);
  const setField = (key: keyof typeof initial, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await perform(async () => {
      await api.post({ url: "/dynamic-dns", data: form });
      setForm((current) => ({ ...initial, provider: current.provider, recordType: current.recordType }));
    }, "Dynamic DNS record saved. It will be checked automatically.");
  };

  if (loading) return <main aria-busy="true" className="p-4">Loading Dynamic DNS...</main>;
  return (
    <main className="container-fluid py-4" style={{ maxWidth: 1120 }}>
      <header className="mb-4">
        <h1 className="h2 mb-2">Dynamic DNS</h1>
        <p className="text-secondary mb-0">Keep public DNS records updated when your ISP changes your address. Checks run automatically every five minutes and updates are sent only when needed.</p>
      </header>
      <Alert variant="info">
        Dynamic DNS does not open router ports, publish Docker ports, or bypass carrier-grade NAT (CGNAT).
        Configure your NPMi instance firewall under <a href="/security">Instance Security</a>.
        The provider credentials are encrypted on disk and never returned by this screen.
      </Alert>
      {error ? <Alert variant="danger" role="alert">{error}</Alert> : null}
      {success ? <Alert variant="success" role="status">{success}</Alert> : null}

      <section className="mb-5" aria-labelledby="ddns-records-heading">
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
          <h2 className="h4 mb-0" id="ddns-records-heading">Configured records</h2>
          <button className="btn btn-outline-primary" type="button" disabled={busy}
            onClick={() => void perform(async () => {
              await api.post({ url: "/dynamic-dns/refresh", data: {} });
            }, "Public address checks and provider updates completed.")}>Check and update now</button>
        </div>
        {snapshot?.records.length ? (
          <div className="table-responsive">
            <table className="table align-middle">
              <thead><tr>
                <th scope="col">Hostname</th><th scope="col">Provider</th><th scope="col">Record</th>
                <th scope="col">Last IP</th><th scope="col">Last update</th><th scope="col">Status</th><th scope="col">Action</th>
              </tr></thead>
              <tbody>{snapshot.records.map((record) => (
                <tr key={record.id}>
                  <td className="fw-semibold">{record.hostname}</td>
                  <td>{snapshot.providers.find((item) => item.id === record.provider)?.name || record.provider}</td>
                  <td>{record.recordType}</td>
                  <td className="font-monospace">{record.lastIp || "Awaiting check"}</td>
                  <td>{record.lastUpdatedAt ? new Date(record.lastUpdatedAt).toLocaleString() : "Never"}</td>
                  <td>{record.lastError ? <span className="text-danger" title={record.lastError}>Needs attention</span> :
                    record.lastUpdatedAt ? <span className="text-success">Updated</span> : "Pending"}</td>
                  <td><button className="btn btn-sm btn-outline-danger" type="button" disabled={busy}
                    onClick={() => {
                      if (!window.confirm("Remove Dynamic DNS updates for " + record.hostname + "?")) return;
                      void perform(() => api.del({ url: "/dynamic-dns/" + record.id }), "Dynamic DNS record removed.");
                    }}>Remove</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="text-secondary">No Dynamic DNS records configured.</p>}
      </section>

      <section aria-labelledby="ddns-add-heading">
        <h2 className="h4 mb-2" id="ddns-add-heading">Add a Dynamic DNS record</h2>
        <p className="text-secondary">Use a provider-specific update credential where possible instead of your main account password.</p>
        <form onSubmit={(event) => void add(event)} className="row g-3">
          <div className="col-md-7">
            <label className="form-label" htmlFor="ddns-provider">Provider</label>
            <select id="ddns-provider" className="form-select" value={form.provider} disabled={busy}
              onChange={(e) => setField("provider", e.target.value)}>
              {snapshot?.providers.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}
            </select>
            <p className="text-secondary small mt-1">{provider?.credentials}</p>
          </div>
          <div className="col-md-5">
            <label className="form-label" htmlFor="ddns-type">Record type</label>
            <select id="ddns-type" className="form-select" value={form.recordType} disabled={busy}
              onChange={(e) => setField("recordType", e.target.value)}>
              {provider?.supports.map((type) => <option value={type} key={type}>{type}</option>)}
            </select>
          </div>
          <div className="col-12">
            <label className="form-label" htmlFor="ddns-hostname">Hostname to update</label>
            <input id="ddns-hostname" className="form-control" required maxLength={253}
              placeholder="home.example.com" value={form.hostname} disabled={busy}
              onChange={(e) => setField("hostname", e.target.value)} />
          </div>
          {["noip", "dynu"].includes(form.provider) ? (
            <div className="col-md-6">
              <label className="form-label" htmlFor="ddns-user">Update username / DDNS Key name</label>
              <input id="ddns-user" className="form-control" value={form.username} disabled={busy}
                onChange={(e) => setField("username", e.target.value)} required />
            </div>
          ) : null}
          <div className={["noip", "dynu"].includes(form.provider) ? "col-md-6" : "col-12"}>
            <label className="form-label" htmlFor="ddns-secret">
              {form.provider === "cloudflare" ? "API token" : "Provider update key / password"}
            </label>
            <input id="ddns-secret" className="form-control" type="password" autoComplete="new-password"
              minLength={6} required value={form.secret} disabled={busy} onChange={(e) => setField("secret", e.target.value)} />
          </div>
          {form.provider === "cloudflare" ? (
            <>
              <div className="col-md-6">
                <label className="form-label" htmlFor="ddns-zone">Cloudflare Zone ID</label>
                <input id="ddns-zone" className="form-control font-monospace" required
                  value={form.zoneId} disabled={busy} onChange={(e) => setField("zoneId", e.target.value)} />
              </div>
              <div className="col-md-6">
                <label className="form-label" htmlFor="ddns-record-id">Cloudflare DNS Record ID</label>
                <input id="ddns-record-id" className="form-control font-monospace" required
                  value={form.dnsRecordId} disabled={busy} onChange={(e) => setField("dnsRecordId", e.target.value)} />
              </div>
            </>
          ) : null}
          <div className="col-12">
            <button className="btn btn-primary" type="submit" disabled={busy || !snapshot?.providers.length}>
              Add record
            </button>
          </div>
        </form>
        <p className="text-secondary small mt-3">Provider updates and public-IP detection use HTTPS with timeouts. This feature cannot determine whether your ISP uses CGNAT without observing your router's WAN address.</p>
      </section>
    </main>
  );
}
