import { Page } from "src/components";
import { useControlPlaneHealth } from "src/hooks";

const badge = (status?: string) => (
	<span className={`badge ${status === "ok" ? "bg-green-lt" : "bg-red-lt"}`}>
		{status === "ok" ? "Healthy" : "Unavailable"}
	</span>
);

export function Unhealthy() {
	const { data, isLoading, error } = useControlPlaneHealth();
	const nginx = data?.checks?.nginx;
	const backend = data?.checks?.backend;
	const controlPlane = data?.checks?.controlPlane;

	return (
		<Page className="page-center">
			<div className="container-tight py-4" style={{ maxWidth: 760 }}>
				<div className="text-center mb-4">
					<div className="empty-img">
						<img src="/images/unhealthy.svg" alt="" />
					</div>
					<h1 className="h2 mt-3">Management API unavailable</h1>
					<p className="text-secondary">
						The normal API health check failed. NPM Improved is using the independent control plane to report
						what is still reachable.
					</p>
				</div>

				{isLoading ? <div className="alert alert-info">Checking the independent control plane…</div> : null}
				{error ? (
					<div className="alert alert-danger">
						The independent control-plane health endpoint is also unavailable: {error.message}
					</div>
				) : null}

				{data ? (
					<div className="row row-cards">
						<div className="col-md-4">
							<div className="card h-100">
								<div className="card-body">
									<div className="d-flex justify-content-between gap-2">
										<strong>Control Plane</strong>
										{badge(controlPlane?.status)}
									</div>
									<div className="text-secondary small mt-2">
										Port 81 management listener and static UI.
									</div>
								</div>
							</div>
						</div>
						<div className="col-md-4">
							<div className="card h-100">
								<div className="card-body">
									<div className="d-flex justify-content-between gap-2">
										<strong>Management API</strong>
										{badge(backend?.status)}
									</div>
									<div className="text-secondary small mt-2">
										{backend?.httpStatus ? `HTTP ${backend.httpStatus}` : "No backend response"}
										{typeof backend?.latencyMs === "number" ? ` · ${backend.latencyMs} ms` : ""}
									</div>
								</div>
							</div>
						</div>
						<div className="col-md-4">
							<div className="card h-100">
								<div className="card-body">
									<div className="d-flex justify-content-between gap-2">
										<strong>Nginx</strong>
										{badge(nginx?.status)}
									</div>
									<div className="text-secondary small mt-2">
										PID: {nginx?.pid || "not detected"}
										<br />
										Config: {nginx?.configValid ? "valid" : "not valid/available"}
									</div>
								</div>
							</div>
						</div>
					</div>
				) : null}

				<div className="text-center mt-4">
					<button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
						Retry management API
					</button>
				</div>
			</div>
		</Page>
	);
}
