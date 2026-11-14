import { useState } from "react";
import { Link } from "react-router-dom";
import { IconActivityHeartbeat, IconShieldCheck, IconShieldOff } from "@tabler/icons-react";
import { useFirewallActions, useInstanceFirewall } from "src/hooks/useInstanceFirewall";

export default function FirewallSettings() {
	const { data, isLoading, error, refetch } = useInstanceFirewall();
	const { toggle } = useFirewallActions();
	const [actionError, setActionError] = useState("");
	const supported = typeof data?.enabled === "boolean";
	const enabled = data?.enabled === true;
	const saving = toggle.isPending;

	async function setEnabled(next: boolean) {
		if (saving || !data || !supported || next === enabled) return;
		if (!next && !window.confirm(
			"Disable NPMi instance firewall functionality? This releases the instance's managed packet-filtering rules. Existing routing and proxy hosts remain unchanged.",
		)) return;
		setActionError("");
		try {
			await toggle.mutateAsync(next);
		} catch (cause) {
			setActionError(cause instanceof Error ? cause.message : "Could not change firewall state.");
		}
	}

	return (
		<div className="py-2" aria-busy={isLoading || saving}>
			<h2 className="h3 mb-2">Firewall</h2>
			<p className="text-secondary">
				Control the NPM Improved instance firewall. The feature is enabled by default on
				supported beta installations; packet filtering has separate activation safeguards.
			</p>
			{isLoading && !data ? <p role="status">Loading firewall configuration...</p> : null}
			{error ? (
				<div className="alert alert-danger" role="alert">
					Could not load firewall status: {error.message}{" "}
					<button className="btn btn-sm btn-outline-danger" type="button" onClick={() => void refetch()}>
						Retry
					</button>
				</div>
			) : null}
			{actionError ? <div className="alert alert-danger" role="alert">{actionError}</div> : null}
			{data && !supported ? (
				<div className="alert alert-info" role="status">
					This node is still running an older NPMi backend. Update it to v1.8.0-beta.3
					before using firewall controls. Existing proxy configuration has not changed.
				</div>
			) : null}
			{data && supported ? (
				<>
					<div className="d-flex flex-wrap align-items-center justify-content-between gap-3 py-3 border-bottom">
						<div className="d-flex align-items-start gap-3">
							{enabled
								? <IconShieldCheck size={30} stroke={1.7} className="text-success flex-shrink-0" aria-hidden="true" />
								: <IconShieldOff size={30} stroke={1.7} className="text-secondary flex-shrink-0" aria-hidden="true" />}
							<div>
								<h3 className="h4 mb-1">Enable instance firewall</h3>
								<p className="text-secondary mb-0">
									{enabled
										? "Firewall controls are available. The packet-filtering state is shown below."
										: "Firewall functionality is disabled. Its main navigation item is hidden."}
								</p>
							</div>
						</div>
						<div className="form-check form-switch">
							<input
								id="npmi-firewall-enabled"
								className="form-check-input"
								type="checkbox"
								role="switch"
								aria-label="Enable instance firewall"
								checked={enabled}
								disabled={saving || isLoading}
								onChange={(event) => void setEnabled(event.target.checked)}
							/>
							<label className="form-check-label" htmlFor="npmi-firewall-enabled">
								{saving ? "Saving..." : enabled ? "On" : "Off"}
							</label>
						</div>
					</div>
					<div className="py-4">
						<h3 className="h4 mb-3">Actual enforcement</h3>
						<div className="d-flex align-items-center gap-2 mb-2">
							<IconActivityHeartbeat size={22} aria-hidden="true" />
							<strong>{data.enforced ? "Filtering active and verified" :
								!enabled ? (data.releasePending ? "Disabling — awaiting companion" : "Disabled") : data.state === "not_configured" ?
									"Setup required" : data.state === "unmanaged" ?
										"Externally managed" : "Not enforcing"}</strong>
						</div>
						<p className="text-secondary">
							Companion: {data.helperReady ? "reporting" : "not reporting"}.
							{" "}Deployment: {data.config.mode.replace(/-/g, " ")}.
							{" "}Control port: {data.managementPort}.
						</p>
						{!enabled && data.releasePending ? (
							<div className="alert alert-info" role="status">
								The firewall switch is off. The companion is releasing its filtering rules;
								this page will update when removal is confirmed.
							</div>
						) : null}
						{enabled && !data.enforced ? (
							<div className="alert alert-warning" role="status">
								The firewall feature is enabled, but NPMi has not verified active packet
								filtering. Activating a default-deny policy requires verifying management
								networks and confirming the change within two minutes.
							</div>
						) : null}
						{data.helperError && enabled ? <p className="text-danger">{data.helperError}</p> : null}
						<div className="d-flex flex-wrap gap-2">
							{enabled ? (
								<Link className="btn btn-primary" to="/security">Manage firewall policy</Link>
							) : null}
							<Link className="btn btn-outline-secondary" to="/system-health">View system health</Link>
						</div>
					</div>
				</>
			) : null}
		</div>
	);
}
