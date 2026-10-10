import { HostTable, useAnalyticsPage } from "./Shared";

export default function HostsPage() {
  const {data} = useAnalyticsPage();
  return (
    <section aria-label="Hosts analytics" className="npmi-center-page">
      <HostTable hosts={data.hosts}/>
    </section>
  );
}
