import { IconPlus, IconSettings, IconTrash } from "@tabler/icons-react";
import cn from "classnames";
import EasyModal, { type InnerModalProps } from "ez-modal-react";
import { Field, FieldArray, Form, Formik } from "formik";
import { type ReactNode, useState } from "react";
import { Alert } from "react-bootstrap";
import Modal from "react-bootstrap/Modal";
import {
	AccessField,
	Button,
	DomainNamesField,
	HasPermission,
	Loading,
	LocationsFields,
	NginxConfigField,
	ProtectionProfileField,
	SSLCertificateField,
	SSLOptionsFields,
} from "src/components";
import { useProxyHost, useSetProxyHost, useUser } from "src/hooks";
import { T } from "src/locale";
import { MANAGE, PROXY_HOSTS } from "src/modules/Permissions";
import { validateNumber, validateString } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";

const showProxyHostModal = (id: number | "new") => {
	EasyModal.show(ProxyHostModal, { id });
};

interface Props extends InnerModalProps {
	id: number | "new";
}
const ProxyHostModal = EasyModal.create(({ id, visible, remove }: Props) => {
	const { data: currentUser, isLoading: userIsLoading, error: userError } = useUser("me");
	const { data, isLoading, error } = useProxyHost(id);
	const { mutate: setProxyHost } = useSetProxyHost();
	const [errorMsg, setErrorMsg] = useState<ReactNode | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const onSubmit = async (values: any, { setSubmitting }: any) => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		setErrorMsg(null);

		const normalizedUpstreams = (values.upstreams || []).map((target: any) => ({
			...target,
			port: Number.parseInt(target.port, 10),
			weight: Number.parseInt(target.weight, 10) || 1,
			maxFails: Number.parseInt(target.maxFails, 10) || 3,
			failTimeout: Number.parseInt(target.failTimeout, 10) || 10,
			enabled: target.enabled !== false,
		}));
		const primary = normalizedUpstreams.find((target: any) => target.enabled) || normalizedUpstreams[0];

		const { ...payload } = {
			id: id === "new" ? undefined : id,
			...values,
			upstreams: normalizedUpstreams,
			forwardScheme: primary?.scheme || "http",
			forwardHost: primary?.host || "",
			forwardPort: primary?.port || 80,
		};

		setProxyHost(payload, {
			onError: (err: any) => setErrorMsg(<T id={err.message} />),
			onSuccess: () => {
				showObjectSuccess("proxy-host", "saved");
				remove();
			},
			onSettled: () => {
				setIsSubmitting(false);
				setSubmitting(false);
			},
		});
	};

	return (
		<Modal show={visible} onHide={remove}>
			{!isLoading && (error || userError) && (
				<Alert variant="danger" className="m-3">
					{error?.message || userError?.message || "Unknown error"}
				</Alert>
			)}
			{isLoading || (userIsLoading && <Loading noLogo />)}
			{!isLoading && !userIsLoading && data && currentUser && (
				<Formik
					initialValues={
						{
							// Details tab
							domainNames: data?.domainNames || [],
							forwardScheme: data?.forwardScheme || "http",
							forwardHost: data?.forwardHost || "",
							forwardPort: data?.forwardPort || 80,
							upstreamMode: data?.upstreamMode || "round-robin",
							upstreams:
								data?.upstreams?.length
									? data.upstreams
									: [
											{
												name: "Primary",
												scheme: data?.forwardScheme || "http",
												host: data?.forwardHost || "",
												port: data?.forwardPort || 80,
												weight: 1,
												maxFails: 3,
												failTimeout: 10,
												enabled: true,
											},
										],
							accessListId: data?.accessListId || 0,
							cachingEnabled: data?.cachingEnabled || false,
							blockExploits: data?.blockExploits || false,
							allowWebsocketUpgrade: data?.allowWebsocketUpgrade || false,
							// Locations tab
							locations: data?.locations || [],
							// SSL tab
							certificateId: data?.certificateId || 0,
							sslForced: data?.sslForced || false,
							http2Support: data?.http2Support || false,
							hstsEnabled: data?.hstsEnabled || false,
							hstsSubdomains: data?.hstsSubdomains || false,
							trustForwardedProto: data?.trustForwardedProto || false,
							// Advanced tab
							advancedConfig: data?.advancedConfig || "",
							meta: { ...(data?.meta || {}), protectionProfile: data?.meta?.protectionProfile || "inherit" },
						} as any
					}
					onSubmit={onSubmit}
				>
					{({ values }) => (
						<Form>
							<Modal.Header closeButton>
								<Modal.Title>
									<T id={data?.id ? "object.edit" : "object.add"} tData={{ object: "proxy-host" }} />
								</Modal.Title>
							</Modal.Header>
							<Modal.Body className="p-0">
								<Alert variant="danger" show={!!errorMsg} onClose={() => setErrorMsg(null)} dismissible>
									{errorMsg}
								</Alert>
								<div className="card m-0 border-0">
									<div className="card-header">
										<ul className="nav nav-tabs card-header-tabs" data-bs-toggle="tabs">
											<li className="nav-item" role="presentation">
												<a
													href="#tab-details"
													className="nav-link active"
													data-bs-toggle="tab"
													aria-selected="true"
													role="tab"
												>
													<T id="column.details" />
												</a>
											</li>
											<li className="nav-item" role="presentation">
												<a
													href="#tab-locations"
													className="nav-link"
													data-bs-toggle="tab"
													aria-selected="false"
													tabIndex={-1}
													role="tab"
												>
													<T id="column.custom-locations" />
												</a>
											</li>
											<li className="nav-item" role="presentation">
												<a
													href="#tab-ssl"
													className="nav-link"
													data-bs-toggle="tab"
													aria-selected="false"
													tabIndex={-1}
													role="tab"
												>
													<T id="column.ssl" />
												</a>
											</li>
											<li className="nav-item" role="presentation">
												<a
													href="#tab-protection"
													className="nav-link"
													data-bs-toggle="tab"
													aria-selected="false"
													tabIndex={-1}
													role="tab"
												>
													Protection
												</a>
											</li>
											<li className="nav-item ms-auto" role="presentation">
												<a
													href="#tab-advanced"
													className="nav-link"
													title="Settings"
													data-bs-toggle="tab"
													aria-selected="false"
													tabIndex={-1}
													role="tab"
												>
													<IconSettings size={20} />
												</a>
											</li>
										</ul>
									</div>
									<div className="card-body">
										<div className="tab-content">
											<div className="tab-pane active show" id="tab-details" role="tabpanel">
												<DomainNamesField isWildcardPermitted dnsProviderWildcardSupported />
												<div className="d-flex align-items-start justify-content-between gap-3 mb-3">
													<div>
														<h4 className="mb-1">
															<T id="proxy-host.upstream-pool" />
														</h4>
														<div className="text-secondary small">
															<T id="proxy-host.upstream-pool-help" />
														</div>
													</div>
													<div style={{ minWidth: 190 }}>
														<Field name="upstreamMode">
															{({ field }: any) => (
																<select className="form-select form-select-sm" {...field}>
																	<option value="round-robin">
																		<T id="proxy-host.upstream-mode-round-robin" />
																	</option>
																	<option value="least-conn">
																		<T id="proxy-host.upstream-mode-least-conn" />
																	</option>
																	<option value="ip-hash">
																		<T id="proxy-host.upstream-mode-ip-hash" />
																	</option>
																	<option value="failover">
																		<T id="proxy-host.upstream-mode-failover" />
																	</option>
																</select>
															)}
														</Field>
													</div>
												</div>
												<FieldArray name="upstreams">
													{({ push, remove }) => (
														<div className="mb-3">
															{(values.upstreams || []).map((_: any, index: number) => (
																<div className="card mb-2" key={index}>
																	<div className="card-body p-3">
																		<div className="row g-2 align-items-end">
																			<div className="col-md-2">
																				<label className="form-label" htmlFor={`upstream-${index}-scheme`}>
																					<T id="host.forward-scheme" />
																				</label>
																				<Field
																					as="select"
																					id={`upstream-${index}-scheme`}
																					name={`upstreams.${index}.scheme`}
																					className="form-select"
																				>
																					<option value="http">http</option>
																					<option value="https">https</option>
																				</Field>
																			</div>
																			<div className="col-md-4">
																				<Field
																					name={`upstreams.${index}.host`}
																					validate={validateString(1, 255)}
																				>
																					{({ field, form }: any) => (
																						<>
																							<label className="form-label" htmlFor={`upstream-${index}-host`}>
																								<T id="proxy-host.forward-host" />
																							</label>
																							<input
																								{...field}
																								id={`upstream-${index}-host`}
																								className={`form-control ${form.errors?.upstreams?.[index]?.host && form.touched?.upstreams?.[index]?.host ? "is-invalid" : ""}`}
																								placeholder="10.0.0.10 or app.internal"
																								required
																							/>
																						</>
																					)}
																				</Field>
																			</div>
																			<div className="col-md-2">
																				<Field
																					name={`upstreams.${index}.port`}
																					validate={validateNumber(1, 65535)}
																				>
																					{({ field }: any) => (
																						<>
																							<label className="form-label" htmlFor={`upstream-${index}-port`}>
																								<T id="host.forward-port" />
																							</label>
																							<input
																								{...field}
																								id={`upstream-${index}-port`}
																								type="number"
																								min={1}
																								max={65535}
																								className="form-control"
																								required
																							/>
																						</>
																					)}
																				</Field>
																			</div>
																			<div className="col-md-3">
																				<label className="form-label" htmlFor={`upstream-${index}-name`}>
																					<T id="proxy-host.upstream-name" />
																				</label>
																				<Field
																					id={`upstream-${index}-name`}
																					name={`upstreams.${index}.name`}
																					className="form-control"
																					placeholder={index === 0 ? "Primary" : `Backend ${index + 1}`}
																				/>
																			</div>
																			<div className="col-md-1 d-flex justify-content-end">
																				<button
																					type="button"
																					className="btn btn-ghost-danger btn-icon"
																					title="Remove upstream"
																					disabled={(values.upstreams || []).length <= 1}
																					onClick={() => remove(index)}
																				>
																					<IconTrash size={18} />
																				</button>
																			</div>
																		</div>
																		<div className="row g-2 mt-1 align-items-end">
																			<div className="col-md-2">
																				<label className="form-label" htmlFor={`upstream-${index}-weight`}>
																					<T id="proxy-host.upstream-weight" />
																				</label>
																				<Field
																					id={`upstream-${index}-weight`}
																					name={`upstreams.${index}.weight`}
																					type="number"
																					min={1}
																					max={256}
																					className="form-control form-control-sm"
																				/>
																			</div>
																			<div className="col-md-2">
																				<label className="form-label" htmlFor={`upstream-${index}-max-fails`}>
																					<T id="proxy-host.upstream-max-fails" />
																				</label>
																				<Field
																					id={`upstream-${index}-max-fails`}
																					name={`upstreams.${index}.maxFails`}
																					type="number"
																					min={1}
																					max={100}
																					className="form-control form-control-sm"
																				/>
																			</div>
																			<div className="col-md-2">
																				<label className="form-label" htmlFor={`upstream-${index}-fail-timeout`}>
																					<T id="proxy-host.upstream-fail-timeout" />
																				</label>
																				<Field
																					id={`upstream-${index}-fail-timeout`}
																					name={`upstreams.${index}.failTimeout`}
																					type="number"
																					min={1}
																					max={3600}
																					className="form-control form-control-sm"
																				/>
																			</div>
																			<div className="col-md-3">
																				<label className="form-label" htmlFor={`upstream-${index}-enabled`}>
																					<T id="column.status" />
																				</label>
																				<label className="form-check form-switch mb-1">
																					<Field
																						id={`upstream-${index}-enabled`}
																						name={`upstreams.${index}.enabled`}
																						type="checkbox"
																						className="form-check-input"
																					/>
																					<span className="form-check-label">
																						<T id="enabled" />
																					</span>
																				</label>
																			</div>
																		</div>
																	</div>
																</div>
															))}
															<Button
																type="button"
																size="sm"
																onClick={() =>
																	push({
																		name: "",
																		scheme: values.upstreams?.[0]?.scheme || "http",
																		host: "",
																		port: values.upstreams?.[0]?.port || 80,
																		weight: 1,
																		maxFails: 3,
																		failTimeout: 10,
																		enabled: true,
																	})
																}
															>
																<IconPlus size={16} />
																<T id="proxy-host.add-upstream" />
															</Button>
															{values.upstreamMode === "failover" ? (
																<div className="text-secondary small mt-2">
																	<T id="proxy-host.failover-help" />
																</div>
															) : null}
														</div>
													)}
												</FieldArray>
												<AccessField />
												<div className="my-3">
													<h4 className="py-2">
														<T id="options" />
													</h4>
													<div className="divide-y">
														<div>
															<label className="row" htmlFor="cachingEnabled">
																<span className="col">
																	<T id="host.flags.cache-assets" />
																</span>
																<span className="col-auto">
																	<Field name="cachingEnabled" type="checkbox">
																		{({ field }: any) => (
																			<label className="form-check form-check-single form-switch">
																				<input
																					{...field}
																					id="cachingEnabled"
																					className={cn("form-check-input", {
																						"bg-lime": field.checked,
																					})}
																					type="checkbox"
																				/>
																			</label>
																		)}
																	</Field>
																</span>
															</label>
														</div>
														<div>
															<label className="row" htmlFor="blockExploits">
																<span className="col">
																	<T id="host.flags.block-exploits" />
																</span>
																<span className="col-auto">
																	<Field name="blockExploits" type="checkbox">
																		{({ field }: any) => (
																			<label className="form-check form-check-single form-switch">
																				<input
																					{...field}
																					id="blockExploits"
																					className={cn("form-check-input", {
																						"bg-lime": field.checked,
																					})}
																					type="checkbox"
																				/>
																			</label>
																		)}
																	</Field>
																</span>
															</label>
														</div>
														<div>
															<label className="row" htmlFor="allowWebsocketUpgrade">
																<span className="col">
																	<T id="host.flags.websockets-upgrade" />
																</span>
																<span className="col-auto">
																	<Field name="allowWebsocketUpgrade" type="checkbox">
																		{({ field }: any) => (
																			<label className="form-check form-check-single form-switch">
																				<input
																					{...field}
																					id="allowWebsocketUpgrade"
																					className={cn("form-check-input", {
																						"bg-lime": field.checked,
																					})}
																					type="checkbox"
																				/>
																			</label>
																		)}
																	</Field>
																</span>
															</label>
														</div>
													</div>
												</div>
											</div>
											<div className="tab-pane" id="tab-locations" role="tabpanel">
												<LocationsFields initialValues={data?.locations || []} />
											</div>
											<div className="tab-pane" id="tab-ssl" role="tabpanel">
												<SSLCertificateField
													name="certificateId"
													label="ssl-certificate"
													allowNew
												/>
												<SSLOptionsFields color="bg-lime" forProxyHost={true} />
											</div>
											<div className="tab-pane" id="tab-protection" role="tabpanel">
												<ProtectionProfileField />
											</div>
											<div className="tab-pane" id="tab-advanced" role="tabpanel">
												<NginxConfigField />
											</div>
										</div>
									</div>
								</div>
							</Modal.Body>
							<Modal.Footer>
								<Button data-bs-dismiss="modal" onClick={remove} disabled={isSubmitting}>
									<T id="cancel" />
								</Button>
								<HasPermission section={PROXY_HOSTS} permission={MANAGE} hideError>
									<Button
										type="submit"
										actionType="primary"
										className="ms-auto bg-lime"
										data-bs-dismiss="modal"
										isLoading={isSubmitting}
										disabled={isSubmitting}
									>
										<T id="save" />
									</Button>
								</HasPermission>
							</Modal.Footer>
						</Form>
					)}
				</Formik>
			)}
		</Modal>
	);
});

export { showProxyHostModal };
