import { IconHelp, IconSearch } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import Alert from "react-bootstrap/Alert";
import { deleteCertificate, downloadCertificate } from "src/api/backend";
import { Button, HasPermission, LoadingPage } from "src/components";
import { useCertificates } from "src/hooks";
import { T } from "src/locale";
import {
	showCustomCertificateModal,
	showDeleteConfirmModal,
	showDNSCertificateModal,
	showHelpModal,
	showHTTPCertificateModal,
	showRenewCertificateModal,
} from "src/modals";
import { CERTIFICATES, MANAGE } from "src/modules/Permissions";
import { showError, showObjectSuccess } from "src/notifications";
import Table from "./Table";

type CertificateView = "active" | "unused";

export default function TableWrapper() {
	const [search, setSearch] = useState("");
	const [view, setView] = useState<CertificateView>("active");
	const { isFetching, isLoading, isError, error, data } = useCertificates([
		"owner",
		"dead_hosts",
		"proxy_hosts",
		"redirection_hosts",
		"streams",
	]);

	const activeCertificates = useMemo(() => (data ?? []).filter((item) => item.isInUse !== false), [data]);
	const unusedCertificates = useMemo(() => (data ?? []).filter((item) => item.isInUse === false), [data]);

	if (isLoading) {
		return <LoadingPage />;
	}

	if (isError) {
		return <Alert variant="danger">{error?.message || "Unknown error"}</Alert>;
	}

	const handleDelete = async (id: number) => {
		await deleteCertificate(id);
		showObjectSuccess("certificate", "deleted");
	};

	const handleDownload = async (id: number) => {
		try {
			await downloadCertificate(id);
		} catch (err: any) {
			showError(err.message);
		}
	};

	const visibleCertificates = view === "active" ? activeCertificates : unusedCertificates;
	const filtered = search
		? visibleCertificates.filter(
				(item) =>
					item.domainNames.some((domain: string) => domain.toLowerCase().includes(search)) ||
					item.niceName.toLowerCase().includes(search),
			)
		: visibleCertificates;

	return (
		<div className="card mt-4">
			<div className="card-status-top bg-pink" />
			<div className="card-table">
				<div className="card-header">
					<div className="row w-full">
						<div className="col">
							<h2 className="mt-1 mb-0">
								<T id="certificates" />
							</h2>
						</div>
						<div className="col-md-auto col-sm-12">
							<div className="ms-auto d-flex flex-wrap btn-list">
								{data?.length ? (
									<div className="input-group input-group-flat w-auto">
										<span className="input-group-text input-group-text-sm">
											<IconSearch size={16} />
										</span>
										<input
											id="advanced-table-search"
											type="text"
											className="form-control form-control-sm"
											autoComplete="off"
											value={search}
											onChange={(e: any) => setSearch(e.target.value.toLowerCase().trim())}
										/>
									</div>
								) : null}
								<Button size="sm" onClick={() => showHelpModal("Certificates", "pink")}>
									<IconHelp size={20} />
								</Button>
								<HasPermission section={CERTIFICATES} permission={MANAGE} hideError>
									{data?.length ? (
										<div className="dropdown">
											<button
												type="button"
												className="btn btn-sm dropdown-toggle btn-pink mt-1"
												data-bs-toggle="dropdown"
											>
												<T id="object.add" tData={{ object: "certificate" }} />
											</button>
											<div className="dropdown-menu">
												<a
													className="dropdown-item"
													href="#"
													onClick={(e) => {
														e.preventDefault();
														showHTTPCertificateModal();
													}}
												>
													<T id="lets-encrypt-via-http" />
												</a>
												<a
													className="dropdown-item"
													href="#"
													onClick={(e) => {
														e.preventDefault();
														showDNSCertificateModal();
													}}
												>
													<T id="lets-encrypt-via-dns" />
												</a>
												<div className="dropdown-divider" />
												<a
													className="dropdown-item"
													href="#"
													onClick={(e) => {
														e.preventDefault();
														showCustomCertificateModal();
													}}
												>
													<T id="certificates.custom" />
												</a>
											</div>
										</div>
									) : null}
								</HasPermission>
							</div>
						</div>
					</div>
				</div>

				{data?.length ? (
					<>
						<div className="card-header py-2">
							<div className="btn-group" role="group" aria-label="Certificate status">
								<button
									type="button"
									className={`btn btn-sm ${view === "active" ? "btn-pink" : "btn-outline-secondary"}`}
									onClick={() => {
										setView("active");
										setSearch("");
									}}
								>
									Active <span className="badge bg-white text-dark ms-1">{activeCertificates.length}</span>
								</button>
								<button
									type="button"
									className={`btn btn-sm ${view === "unused" ? "btn-pink" : "btn-outline-secondary"}`}
									onClick={() => {
										setView("unused");
										setSearch("");
									}}
								>
									Unused <span className="badge bg-white text-dark ms-1">{unusedCertificates.length}</span>
								</button>
							</div>
						</div>
						{view === "unused" ? (
							<div className="px-3 pt-3">
								<Alert variant="warning" className="mb-0">
									Unused certificates are quarantined before cleanup. Referencing one from any host cancels
									its quarantine automatically.
								</Alert>
							</div>
						) : null}
					</>
				) : null}

				<Table
					data={filtered}
					isFiltered={!!search}
					isFetching={isFetching}
					onRenew={showRenewCertificateModal}
					onDownload={handleDownload}
					onDelete={(id: number) =>
						showDeleteConfirmModal({
							title: <T id="object.delete" tData={{ object: "certificate" }} />,
							onConfirm: () => handleDelete(id),
							invalidations: [["certificates"], ["certificate", id]],
							children: <T id="object.delete.content" tData={{ object: "certificate" }} />,
						})
					}
				/>
			</div>
		</div>
	);
}
