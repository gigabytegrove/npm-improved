import { IconCheck, IconCopy, IconHome } from "@tabler/icons-react";
import CodeEditor from "@uiw/react-textarea-code-editor";
import { Field, Form, Formik } from "formik";
import { type ReactNode, useState } from "react";
import { Alert } from "react-bootstrap";
import { Button, Loading } from "src/components";
import { useSetSetting, useSetting } from "src/hooks";
import { intl, T } from "src/locale";
import { validateString } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";

const templateVariables = [
	["{{node.hostname}}", "OS hostname of the node that serves the page"],
	["{{node.name}}", "Friendly NPMX / Instance Sync node name"],
	["{{node.id}}", "Stable cluster node ID"],
	["{{node.role}}", "primary, secondary, or standalone"],
	["{{node.public_url}}", "Advertised URL for this node"],
	["{{node.version}}", "Running NPM Improved version"],
	["{{node.build_commit}}", "Running build commit"],
	["{{node.build_date}}", "Running build date"],
	["{{cluster.enabled}}", "Whether cluster synchronization is enabled"],
	["{{cluster.protocol}}", "Exchange protocol name (NPMX)"],
	["{{cluster.protocol_version}}", "NPMX protocol version"],
	["{{system.platform}}", "Operating-system platform"],
	["{{system.arch}}", "CPU architecture"],
	["{{system.generated_at}}", "UTC time this node rendered the default page"],
] as const;

export default function DefaultSite() {
	const { data, isLoading, error } = useSetting("default-site");
	const { mutate: setSetting } = useSetSetting();
	const [errorMsg, setErrorMsg] = useState<ReactNode | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [copiedVariable, setCopiedVariable] = useState("");

	const copyVariable = async (value: string) => {
		try {
			if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(value);
			} else {
				const input = document.createElement("textarea");
				input.value = value;
				input.setAttribute("readonly", "");
				input.style.position = "fixed";
				input.style.opacity = "0";
				document.body.appendChild(input);
				input.select();
				document.execCommand("copy");
				input.remove();
			}
			setCopiedVariable(value);
			window.setTimeout(() => {
				setCopiedVariable((current) => (current === value ? "" : current));
			}, 1600);
		} catch {
			setCopiedVariable("");
		}
	};

	const onSubmit = async (values: any, { setSubmitting }: any) => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		setErrorMsg(null);

		const payload = {
			id: "default-site",
			value: values.value,
			meta: {
				redirect: values.redirect,
				html: values.html,
			},
		};

		setSetting(payload, {
			onError: (err: any) => setErrorMsg(<T id={err.message} />),
			onSuccess: () => {
				showObjectSuccess("setting", "saved");
			},
			onSettled: () => {
				setIsSubmitting(false);
				setSubmitting(false);
			},
		});
	};

	if (!isLoading && error) {
		return (
			<div className="card-body">
				<div className="mb-3">
					<Alert variant="danger" show>
						{error.message}
					</Alert>
				</div>
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className="card-body">
				<div className="mb-3">
					<Loading noLogo />
				</div>
			</div>
		);
	}

	return (
		<Formik
			initialValues={
				{
					value: data?.value || "congratulations",
					redirect: data?.meta?.redirect || "",
					html: data?.meta?.html || "",
				} as any
			}
			onSubmit={onSubmit}
		>
			{({ values }) => (
				<Form>
					<div className="card-body">
						<Alert variant="danger" show={!!errorMsg} onClose={() => setErrorMsg(null)} dismissible>
							{errorMsg}
						</Alert>

						<div className="d-flex align-items-start gap-2 mb-4">
							<IconHome size={24} className="mt-1 flex-shrink-0" />
							<div>
								<h3 className="mb-1">Default Site</h3>
								<p className="text-secondary mb-0">
									Choose what NPM Improved serves when a request reaches this proxy but does not
									match a configured host.
								</p>
							</div>
						</div>
						<Field name="value">
							{({ field, form }: any) => (
								<div className="mb-3">
									<label className="form-label" htmlFor="setting-host-unknown">
										<T id="settings.default-site.description" />
									</label>
									<div className="form-selectgroup form-selectgroup-boxes d-flex flex-column">
										<label className="form-selectgroup-item flex-fill">
											<input
												type="radio"
												name={field.name}
												value="congratulations"
												className="form-selectgroup-input"
												checked={field.value === "congratulations"}
												onChange={(e) => form.setFieldValue(field.name, e.target.value)}
											/>
											<div className="form-selectgroup-label d-flex align-items-center p-3">
												<div className="me-3">
													<span className="form-selectgroup-check" />
												</div>
												<div>
													<div className="fw-bold">
														<T id="settings.default-site.congratulations" />
													</div>
													<div className="text-secondary small mt-1">
														Show the NPM Improved default page with useful node identity details.
													</div>
												</div>
											</div>
										</label>
										<label className="form-selectgroup-item flex-fill">
											<input
												type="radio"
												name={field.name}
												value="404"
												className="form-selectgroup-input"
												checked={field.value === "404"}
												onChange={(e) => form.setFieldValue(field.name, e.target.value)}
											/>
											<div className="form-selectgroup-label d-flex align-items-center p-3">
												<div className="me-3">
													<span className="form-selectgroup-check" />
												</div>
												<div>
													<div className="fw-bold">
														<T id="settings.default-site.404" />
													</div>
													<div className="text-secondary small mt-1">
														Return a normal HTTP 404 response for unmatched hostnames.
													</div>
												</div>
											</div>
										</label>
										<label className="form-selectgroup-item flex-fill">
											<input
												type="radio"
												name={field.name}
												value="444"
												className="form-selectgroup-input"
												checked={field.value === "444"}
												onChange={(e) => form.setFieldValue(field.name, e.target.value)}
											/>
											<div className="form-selectgroup-label d-flex align-items-center p-3">
												<div className="me-3">
													<span className="form-selectgroup-check" />
												</div>
												<div>
													<div className="fw-bold">
														<T id="settings.default-site.444" />
													</div>
													<div className="text-secondary small mt-1">
														Close the connection without a response using Nginx status 444.
													</div>
												</div>
											</div>
										</label>
										<label className="form-selectgroup-item flex-fill">
											<input
												type="radio"
												name={field.name}
												value="redirect"
												className="form-selectgroup-input"
												checked={field.value === "redirect"}
												onChange={(e) => form.setFieldValue(field.name, e.target.value)}
											/>
											<div className="form-selectgroup-label d-flex align-items-center p-3">
												<div className="me-3">
													<span className="form-selectgroup-check" />
												</div>
												<div>
													<div className="fw-bold">
														<T id="settings.default-site.redirect" />
													</div>
													<div className="text-secondary small mt-1">
														Send unmatched requests to another URL. Template variables are supported.
													</div>
												</div>
											</div>
										</label>
										<label className="form-selectgroup-item flex-fill">
											<input
												type="radio"
												name={field.name}
												value="html"
												className="form-selectgroup-input"
												checked={field.value === "html"}
												onChange={(e) => form.setFieldValue(field.name, e.target.value)}
											/>
											<div className="form-selectgroup-label d-flex align-items-center p-3">
												<div className="me-3">
													<span className="form-selectgroup-check" />
												</div>
												<div>
													<div className="fw-bold">
														<T id="settings.default-site.html" />
													</div>
													<div className="text-secondary small mt-1">
														Serve your own HTML template with node, cluster, build, and system variables.
													</div>
												</div>
											</div>
										</label>
									</div>
								</div>
							)}
						</Field>
						<div className="card mb-4">
							<div className="card-header">
								<div>
									<h3 className="card-title mb-0">Template variables</h3>
									<div className="text-secondary small">
										Build one Default Site template for the whole cluster. NPMX synchronizes the
										template, while every node renders its own identity and runtime values locally.
									</div>
								</div>
							</div>
							<div className="card-body">
								<div className="row g-2">
									{templateVariables.map(([name, description]) => {
										const copied = copiedVariable === name;
										return (
											<div className="col-12 col-lg-6" key={name}>
												<button
													type="button"
													className="btn btn-outline-secondary w-100 text-start justify-content-start p-3 h-100"
													onClick={() => void copyVariable(name)}
													title={`Copy ${name}`}
												>
													<span
														className="d-flex align-items-start justify-content-between gap-3 w-100"
													>
														<span className="min-w-0">
															<code className="d-block mb-1">{name}</code>
															<span className="text-secondary small d-block">
																{description}
															</span>
														</span>
														<span className="text-secondary flex-shrink-0">
															{copied ? (
																<IconCheck size={17} className="text-success" />
															) : (
																<IconCopy size={17} />
															)}
														</span>
													</span>
												</button>
											</div>
										);
									})}
								</div>
							</div>
							<div className="card-footer d-flex flex-wrap align-items-center justify-content-between gap-2 text-secondary small">
								<span>Click any variable to copy it.</span>
								<span>
									The built-in page uses node variables automatically. 404 and 444 modes have no
									page body to template.
								</span>
							</div>
						</div>

						{values.value === "redirect" && (
							<Field name="redirect" validate={validateString(1, 255)}>
								{({ field, form }: any) => (
									<div className="mt-5 mb-3">
										<label className="form-label" htmlFor="setting-host-unknown">
											<T id="settings.default-site.redirect" />
										</label>
										<div>
											<input
												id="redirect"
												type="text"
												placeholder="https://"
												required
												autoComplete="off"
												className="form-control"
												{...field}
											/>
											{form.errors.redirect ? (
												<div className="invalid-feedback">
													{form.errors.redirect && form.touched.redirect
														? form.errors.redirect
														: null}
												</div>
											) : null}
										</div>
									</div>
								)}
							</Field>
						)}
						{values.value === "html" && (
							<Field name="html" validate={validateString(1)}>
								{({ field, form }: any) => (
									<div className="mt-5 mb-3">
										<label className="form-label" htmlFor="setting-host-unknown">
											<T id="settings.default-site.html" />
										</label>
										<div>
											<CodeEditor
												// Believe it or not, 'html' sucks yet 'php' renders the html
												// content much nicer.
												language="php"
												placeholder={intl.formatMessage({
													id: "settings.default-site.html.placeholder",
												})}
												padding={15}
												data-color-mode="dark"
												minHeight={300}
												indentWidth={2}
												style={{
													fontFamily:
														"ui-monospace,SFMono-Regular,SF Mono,Consolas,Liberation Mono,Menlo,monospace",
													borderRadius: "0.3rem",
													minHeight: "300px",
													backgroundColor: "var(--tblr-bg-surface-dark)",
												}}
												{...field}
											/>
											{form.errors.html ? (
												<div className="invalid-feedback">
													{form.errors.html && form.touched.html ? form.errors.html : null}
												</div>
											) : null}
										</div>
									</div>
								)}
							</Field>
						)}
					</div>
					<div className="card-footer bg-transparent mt-auto">
						<div className="btn-list justify-content-end">
							<Button
								type="submit"
								actionType="primary"
								className="ms-auto bg-teal"
								data-bs-dismiss="modal"
								isLoading={isSubmitting}
								disabled={isSubmitting}
							>
								<T id="save" />
							</Button>
						</div>
					</div>
				</Form>
			)}
		</Formik>
	);
}
