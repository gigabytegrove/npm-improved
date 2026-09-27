import { useState } from "react";
import { T } from "src/locale";
import CertificateLifecycle from "./CertificateLifecycle";
import Database from "./Database";
import DefaultSite from "./DefaultSite";
import DisasterRecovery from "./DisasterRecovery";
import InstanceSync from "./InstanceSync";
import Protection from "./Protection";

type SettingsPage =
	| "default-site"
	| "certificate-lifecycle"
	| "protection"
	| "database"
	| "instance-sync"
	| "disaster-recovery";

export default function Layout() {
	const [page, setPage] = useState<SettingsPage>("default-site");

	return (
		<div className="card mt-4">
			<div className="card-status-top bg-teal" />
			<div className="card-table">
				<div className="card-header">
					<div className="row w-full">
						<h2 className="mt-1 mb-0">
							<T id="settings" />
						</h2>
					</div>
				</div>
				<div className="row g-0">
					<div className="col-12 col-md-3 border-end">
						<div className="card-body mt-0 pt-0">
							<div className="list-group list-group-transparent">
								<a
									href="#"
									className={`list-group-item list-group-item-action d-flex align-items-center ${page === "default-site" ? "active" : ""}`}
									onClick={(e) => {
										e.preventDefault();
										setPage("default-site");
									}}
								>
									<T id="settings.default-site" />
								</a>
								<a
									href="#"
									className={`list-group-item list-group-item-action d-flex align-items-center ${page === "certificate-lifecycle" ? "active" : ""}`}
									onClick={(e) => {
										e.preventDefault();
										setPage("certificate-lifecycle");
									}}
								>
									Certificate Lifecycle
								</a>
								<a
									href="#"
									className={`list-group-item list-group-item-action d-flex align-items-center ${page === "protection" ? "active" : ""}`}
									onClick={(e) => {
										e.preventDefault();
										setPage("protection");
									}}
								>
									Protection
								</a>
								<a
									href="#"
									className={`list-group-item list-group-item-action d-flex align-items-center ${page === "database" ? "active" : ""}`}
									onClick={(e) => {
										e.preventDefault();
										setPage("database");
									}}
								>
									Database &amp; Storage
								</a>
								<a
									href="#"
									className={`list-group-item list-group-item-action d-flex align-items-center ${page === "instance-sync" ? "active" : ""}`}
									onClick={(e) => {
										e.preventDefault();
										setPage("instance-sync");
									}}
								>
									<T id="sync.title" />
								</a>
								<a
									href="#"
									className={`list-group-item list-group-item-action d-flex align-items-center ${page === "disaster-recovery" ? "active" : ""}`}
									onClick={(e) => {
										e.preventDefault();
										setPage("disaster-recovery");
									}}
								>
									Backup &amp; Recovery
								</a>
							</div>
						</div>
					</div>
					<div className="col-12 col-md-9 d-flex flex-column">
						{page === "default-site" ? (
							<DefaultSite />
						) : page === "certificate-lifecycle" ? (
							<CertificateLifecycle />
						) : page === "protection" ? (
							<Protection />
						) : page === "instance-sync" ? (
							<InstanceSync />
						) : (
							<DisasterRecovery />
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
