import { useEffect, useState } from "react";
import { Alert } from "react-bootstrap";
import { Link, useLocation } from "react-router-dom";
import * as api from "src/api/backend/base";

/**
 * Visible after first-login flows (including admin accounts provisioned through
 * environment variables, which bypass the interactive setup wizard).
 * This cannot enable or modify the firewall; administrators must opt in.
 */
export default function InstanceSecurityNotice() {
  const location = useLocation();
  const [unconfigured, setUnconfigured] = useState(false);

  useEffect(() => {
    let active = true;
    void api.get({ url: "/instance-security" })
      .then((status: { config?: { configured?: boolean } }) => {
        if (active) setUnconfigured(status?.config?.configured === false);
      })
      .catch(() => {
        if (active) setUnconfigured(false);
      });
    return () => { active = false; };
  }, [location.pathname]);

  if (!unconfigured || location.pathname === "/security") return null;
  return (
    <Alert variant="warning" role="status" className="mt-3">
      <strong>Network security setup has been deferred.</strong>{" "}
      NPMi is not applying an instance firewall. Review your router, Docker port exposure, and external firewall policy.{" "}
      <Link to="/security" className="alert-link">Review deployment security</Link>
    </Alert>
  );
}
