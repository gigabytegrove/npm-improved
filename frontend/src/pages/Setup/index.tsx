import { useQueryClient } from "@tanstack/react-query";
import { Field, Form, Formik } from "formik";
import { useState } from "react";
import { Alert } from "react-bootstrap";
import { createUser } from "src/api/backend";
import { Button, LocalePicker, Page, ThemeSwitcher } from "src/components";
import { useAuthState } from "src/context";
import { intl, T } from "src/locale";
import { validateEmail, validateString } from "src/modules/Validations";
import styles from "./index.module.css";

interface Payload {
	name: string;
	email: string;
	password: string;
}

export default function Setup() {
	const queryClient = useQueryClient();
	const { login } = useAuthState();
	const [errorMsg, setErrorMsg] = useState<string | null>(null);
	const [securityMode, setSecurityMode] = useState("deferred");
	const [securityNetworks, setSecurityNetworks] = useState("10.0.0.0/8\n172.16.0.0/12\n192.168.0.0/16\nfc00::/7");
	const [securityLanIp, setSecurityLanIp] = useState("");
	const [acknowledgedDmz, setAcknowledgedDmz] = useState(false);

	const onSubmit = async (values: Payload, { setSubmitting }: any) => {
		setErrorMsg(null);
		const nickname = values.name.split(" ")[0];

		const { password, ...payload } = {
			...values,
			nickname,
			auth: {
				type: "password",
				secret: values.password,
			},
		};

		try {
			const user = await createUser({
				...payload,
				networkSecurity: securityMode === "deferred" ? undefined : {
					mode: securityMode as "static" | "forwarded" | "dmz" | "unmanaged",
					state: "deferred",
					trustedNetworks: securityNetworks.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
					hostLanIp: securityLanIp.trim(),
					acknowledgedDmz,
				},
			}, true);
			if (user?.id) {
				try {
					await login(user.email, password);
					await queryClient.refetchQueries({ queryKey: ["health"] });
				} catch (err: any) {
					setErrorMsg(err.message);
				}
			} else {
				setErrorMsg("cannot_create_user");
			}
		} catch (err: any) {
			setErrorMsg(err.message);
		}
		setSubmitting(false);
	};

	return (
		<Page className={`page page-center ${styles.setupPage}`}>
			<div className={styles.toolbar}>
				<LocalePicker />
				<ThemeSwitcher />
			</div>
			<div className={styles.shell}>
				<section className={styles.brandPanel}>
					<div className={styles.brandLockup}>
						<div className={styles.fullLogoPlate}>
							<img
								src="/images/npm-improved-logo.webp"
								className={styles.fullLogo}
								alt="Nginx Proxy Manager Improved"
							/>
						</div>
					</div>
					<div className={styles.heroCopy}>
						<span className={styles.eyebrow}>
							<T id="setup.hero.eyebrow" />
						</span>
						<h2>
							<T id="setup.hero.title" />
						</h2>
						<p>
							<T id="setup.hero.description" />
						</p>
					</div>
					<div className={styles.brandFooter}>Gigabyte Grove · NPM Improved</div>
				</section>

				<section className={styles.formPanel}>
					<div className={styles.formWrap}>
						<div className={styles.mobileBrand}>
							<img src="/images/npm-improved-mark.webp" width={62} height={41} alt="" />
							<div>
								<strong>Nginx Proxy Manager</strong>
								<span>
									<T id="app.tagline" />
								</span>
							</div>
						</div>
						<div className={styles.heading}>
							<span className={styles.eyebrow}>
								<T id="setup.hero.eyebrow" />
							</span>
							<h1>
								<T id="setup.title" />
							</h1>
							<p>
								<T id="setup.preamble" />
							</p>
						</div>

						<Alert variant="danger" show={!!errorMsg} onClose={() => setErrorMsg(null)} dismissible>
							{errorMsg}
						</Alert>

						<Formik
							initialValues={
								{
									name: "",
									email: "",
									password: "",
								} as any
							}
							onSubmit={onSubmit}
						>
							{({ isSubmitting }) => (
								<Form>
									<Field name="name" validate={validateString(1, 50)}>
										{({ field, form }: any) => (
											<div className="form-floating mb-3">
												<input
													id="name"
													autoComplete="name"
													className={`form-control ${form.errors.name && form.touched.name ? "is-invalid" : ""}`}
													placeholder={intl.formatMessage({ id: "user.full-name" })}
													{...field}
												/>
												<label htmlFor="name">
													<T id="user.full-name" />
												</label>
												{form.errors.name ? (
													<div className="invalid-feedback">
														{form.errors.name && form.touched.name ? form.errors.name : null}
													</div>
												) : null}
											</div>
										)}
									</Field>

									<Field name="email" validate={validateEmail()}>
										{({ field, form }: any) => (
											<div className="form-floating mb-3">
												<input
													id="email"
													type="email"
													autoComplete="username"
													className={`form-control ${form.errors.email && form.touched.email ? "is-invalid" : ""}`}
													placeholder={intl.formatMessage({ id: "email-address" })}
													{...field}
												/>
												<label htmlFor="email">
													<T id="email-address" />
												</label>
												{form.errors.email ? (
													<div className="invalid-feedback">
														{form.errors.email && form.touched.email ? form.errors.email : null}
													</div>
												) : null}
											</div>
										)}
									</Field>

									<Field name="password" validate={validateString(8, 100)}>
										{({ field, form }: any) => (
											<div className="form-floating mb-3">
												<input
													id="password"
													type="password"
													autoComplete="new-password"
													className={`form-control ${form.errors.password && form.touched.password ? "is-invalid" : ""}`}
													placeholder={intl.formatMessage({ id: "user.new-password" })}
													{...field}
												/>
												<label htmlFor="password">
													<T id="user.new-password" />
												</label>
												{form.errors.password ? (
													<div className="invalid-feedback">
														{form.errors.password && form.touched.password ? form.errors.password : null}
													</div>
												) : null}
											</div>
										)}
									</Field>

									<section className="mb-4" aria-labelledby="initial-security-title">
                  <h2 className="h5 mb-2" id="initial-security-title">Network security and deployment</h2>
                  <p className="text-secondary small">NPMi is a Docker application. Configure how internet traffic reaches it. No instance firewall is activated automatically during account creation.</p>
                  <label htmlFor="initial-security-mode" className="form-label">Deployment model</label>
                  <select id="initial-security-mode" className="form-select mb-3" value={securityMode}
                    onChange={(e) => setSecurityMode(e.target.value)}>
                    <option value="deferred">Decide later — defer setup</option>
                    <option value="static">Static IP — NPMi-managed filtering</option>
                    <option value="forwarded">Dynamic IP — Manual router port forwarding</option>
                    <option value="dmz">Dynamic IP — Full router DMZ</option>
                    <option value="unmanaged">External hardware firewall — Threat monitoring only</option>
                  </select>
                  {securityMode === "dmz" ? (
                    <Alert variant="warning">
                      <strong>DMZ exposes your Docker destination to unsolicited traffic.</strong>
                      <p className="mb-2">Port-forwarding only required services is safer. NPMi cannot secure your router, Docker host, or other containers. Its firewall is not active until you explicitly activate it after signing in.</p>
                      <label className="d-flex gap-2"><input type="checkbox" checked={acknowledgedDmz}
                        onChange={(e) => setAcknowledgedDmz(e.target.checked)} />
                        <span>I understand the risks of exposing a Docker destination through DMZ.</span></label>
                    </Alert>
                  ) : null}
                  {securityMode !== "deferred" && securityMode !== "unmanaged" ? (
                    <>
                      <label className="form-label" htmlFor="initial-security-networks">Trusted management CIDRs (one per line)</label>
                      <textarea id="initial-security-networks" className="form-control font-monospace mb-2"
                        value={securityNetworks} rows={4} onChange={(e) => setSecurityNetworks(e.target.value)} />
                    </>
                  ) : null}
                  {securityMode !== "deferred" ? (
                    <>
                      <label className="form-label" htmlFor="initial-security-lan">Docker host LAN IP (optional)</label>
                      <input id="initial-security-lan" className="form-control mb-2" value={securityLanIp}
                        onChange={(e) => setSecurityLanIp(e.target.value)}
                        placeholder="Router-facing LAN IP, not the container's bridge address" />
                    </>
                  ) : null}
                  <p className="text-secondary small mb-0">After signing in, use Instance Security to verify the helper, review open ports, and activate managed filtering. Docker publishing and router forwarding remain separate requirements.</p>
                </section>

                                <Button
										type="submit"
										actionType="primary"
										isLoading={isSubmitting}
										disabled={isSubmitting}
										className="w-100"
									>
										<T id="save" />
									</Button>
								</Form>
							)}
						</Formik>
					</div>
				</section>
			</div>
		</Page>
	);
}
