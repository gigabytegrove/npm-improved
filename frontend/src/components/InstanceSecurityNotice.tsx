import { Alert } from "react-bootstrap";
import { Link, useLocation } from "react-router-dom";
import { useInstanceFirewall } from "src/hooks/useInstanceFirewall";
import { useUser } from "src/hooks";

/**
 * Notify administrators only when a feature-enabled instance still needs
 * actual network filtering activation or has a failed companion. The master
 * switch and the policy's verified enforcement status are not interchangeable.
 */
export default function InstanceSecurityNotice() {
	const location = useLocation();
	const { data: me } = useUser("me");
	const { data } = useInstanceFirewall(me?.roles.includes("admin") === true);

	if (!data?.enabled || data.enforced || data.state === "unmanaged" ||
		location.pathname === "/security" ||
		(location.pathname === "/settings" && new URLSearchParams(location.search).get("section") === "firewall")) {
		return null;
	}

	const helperMissing = !data.helperReady;
	return (
		<Alert variant="warning" role="status" className="mt-3">
			<strong>{helperMissing ? "Firewall companion unavailable." :
				data.state === "not_configured" ? "Firewall setup required." : "Firewall filtering is not active."}</strong>
			{" "}The firewall feature is enabled, but NPMi has not verified an enforced instance network policy.
			{" "}<Link to="/security" className="alert-link">Manage firewall policy</Link>
		</Alert>
	);
}
