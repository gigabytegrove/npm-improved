import { useNavigate, useSearchParams } from "react-router-dom";
import NodeInvestigation from "./Investigation";
import { useAnalyticsPage } from "./Shared";

export default function ClientsPage() {
  const { data } = useAnalyticsPage();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  return <section aria-label="IP Addresses" className="npmi-center-page">
    <NodeInvestigation
      tab="clients"
      report={data}
      initialTarget={searchParams.get("target") || ""}
      initialBlockType={searchParams.get("type") === "user_agent" ? "user_agent" : "ip"}
      onFilterIp={(ip) => navigate("/analytics/requests?ip=" + encodeURIComponent(ip))}
      onFilterAgent={(agent) => navigate("/analytics/requests?userAgent=" + encodeURIComponent(agent))}
      onFilterBot={(bot) => navigate("/analytics/requests?bot=" + encodeURIComponent(bot))}
      onGoToBlocks={(type, target) => navigate(
        "/analytics/blocking?type=" + encodeURIComponent(type) + "&target=" + encodeURIComponent(target)
      )}
    />
  </section>;
}
