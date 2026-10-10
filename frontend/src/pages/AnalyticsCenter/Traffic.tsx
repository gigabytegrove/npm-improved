import { Breakdown, useAnalyticsPage } from "./Shared";

export default function TrafficPage() {
  const {data} = useAnalyticsPage();
  return (
    <section aria-label="Traffic analytics" className="npmi-center-page">
      <div className="row row-cards">
          <div className="col-lg-6"><Breakdown title="Top URLs / paths" items={data.paths} limit={25}/></div>
          <div className="col-lg-6"><Breakdown title="Hostnames" items={data.domains}/></div>
          <div className="col-lg-6"><Breakdown title="HTTP methods" items={data.methods}/></div>
          <div className="col-lg-6"><Breakdown title="HTTP protocols" items={data.protocols}/></div>
          <div className="col-lg-6"><Breakdown title="Device categories (estimated)" items={data.devices}/></div>
          <div className="col-lg-6"><Breakdown title="Upstream response codes" items={data.upstreams}/></div>
          <div className="col-lg-6"><Breakdown title="Exact HTTP status codes" items={data.statusCodes}/></div>
        </div>
    </section>
  );
}
