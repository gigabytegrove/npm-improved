import { Field, Form, Formik } from "formik";
import { useEffect, useRef, useState } from "react";
import Alert from "react-bootstrap/Alert";
import { Button, LocalePicker, Page, ThemeSwitcher } from "src/components";
import { useAuthState } from "src/context";
import { useHealth } from "src/hooks";
import { intl, T } from "src/locale";
import { validateEmail, validateString } from "src/modules/Validations";
import styles from "./index.module.css";

function TwoFactorForm() {
	const codeRef = useRef<HTMLInputElement>(null);
	const [formErr, setFormErr] = useState("");
	const { verifyTwoFactor, cancelTwoFactor } = useAuthState();

	const onSubmit = async (values: any, { setSubmitting }: any) => {
		setFormErr("");
		try {
			await verifyTwoFactor(values.code);
		} catch (err) {
			if (err instanceof Error) {
				setFormErr(err.message);
			}
		}
		setSubmitting(false);
	};

	useEffect(() => {
		codeRef.current?.focus();
	}, []);

	return (
		<>
			<div className={styles.formHeading}>
				<span className={styles.eyebrow}>Secure verification</span>
				<h1>
					<T id="login.2fa-title" />
				</h1>
				<p>
					<T id="login.2fa-subtitle" />
				</p>
			</div>
			{formErr !== "" && <Alert variant="danger">{formErr}</Alert>}
			<Formik initialValues={{ code: "" }} onSubmit={onSubmit}>
				{({ isSubmitting }) => (
					<Form>
						<div className="mb-3">
							<Field name="code" validate={validateString(6, 20)}>
								{({ field, form }: any) => (
									<label className="form-label">
										<T id="login.2fa-code" />
										<input
											{...field}
											ref={codeRef}
											type="text"
											inputMode="numeric"
											autoComplete="one-time-code"
											required
											maxLength={20}
											className={`form-control ${form.errors.code && form.touched.code ? "is-invalid" : ""}`}
											placeholder={intl.formatMessage({ id: "login.2fa-code-placeholder" })}
										/>
										<div className="invalid-feedback">{form.errors.code}</div>
									</label>
								)}
							</Field>
						</div>
						<div className="form-footer d-flex gap-2">
							<Button type="button" fullWidth onClick={cancelTwoFactor} disabled={isSubmitting}>
								<T id="cancel" />
							</Button>
							<Button type="submit" fullWidth color="azure" isLoading={isSubmitting}>
								<T id="login.2fa-verify" />
							</Button>
						</div>
					</Form>
				)}
			</Formik>
		</>
	);
}

function LoginForm() {
	const emailRef = useRef<HTMLInputElement>(null);
	const [formErr, setFormErr] = useState("");
	const { login } = useAuthState();

	const onSubmit = async (values: any, { setSubmitting }: any) => {
		setFormErr("");
		try {
			await login(values.email, values.password);
		} catch (err) {
			if (err instanceof Error) {
				setFormErr(err.message);
			}
		}
		setSubmitting(false);
	};

	useEffect(() => {
		emailRef.current?.focus();
	}, []);

	return (
		<>
			<div className={styles.formHeading}>
				<span className={styles.eyebrow}>NPM Improved</span>
				<h1>
					<T id="login.title" />
				</h1>
				<p>
					<T id="login.subtitle" />
				</p>
			</div>
			{formErr !== "" && <Alert variant="danger">{formErr}</Alert>}
			<Formik
				initialValues={
					{
						email: "",
						password: "",
					} as any
				}
				onSubmit={onSubmit}
			>
				{({ isSubmitting }) => (
					<Form>
						<div className="mb-3">
							<Field name="email" validate={validateEmail()}>
								{({ field, form }: any) => (
									<label className="form-label">
										<T id="email-address" />
										<input
											{...field}
											ref={emailRef}
											type="email"
											autoComplete="username"
											required
											className={`form-control ${form.errors.email && form.touched.email ? "is-invalid" : ""}`}
											placeholder={intl.formatMessage({ id: "email-address" })}
										/>
										<div className="invalid-feedback">{form.errors.email}</div>
									</label>
								)}
							</Field>
						</div>
						<div className="mb-3">
							<Field name="password" validate={validateString(8, 255)}>
								{({ field, form }: any) => (
									<label className="form-label">
										<T id="password" />
										<input
											{...field}
											type="password"
											autoComplete="current-password"
											required
											maxLength={255}
											className={`form-control ${form.errors.password && form.touched.password ? "is-invalid" : ""}`}
											placeholder={intl.formatMessage({ id: "password" })}
										/>
										<div className="invalid-feedback">{form.errors.password}</div>
									</label>
								)}
							</Field>
						</div>
						<div className="form-footer">
							<Button type="submit" fullWidth color="azure" isLoading={isSubmitting}>
								<T id="sign-in" />
							</Button>
						</div>
					</Form>
				)}
			</Formik>
		</>
	);
}

export default function Login() {
	const { twoFactorChallenge } = useAuthState();
	const health = useHealth();

	const getVersion = () => {
		if (!health.data) {
			return "";
		}
		const v = health.data.version;
		return `v${v.major}.${v.minor}.${v.revision}`;
	};

	return (
		<Page className={`page page-center ${styles.loginPage}`}>
			<div className={styles.authShell}>
				<section className={styles.brandPanel}>
					<div className={styles.brandLockup}>
						<span className={styles.brandMark}>
							<img src="/images/npm-improved-mark.svg" width={48} height={48} alt="" />
						</span>
						<div>
							<div className={styles.brandName}>NPM Improved</div>
							<div className={styles.brandTagline}>
								<T id="app.tagline" />
							</div>
						</div>
					</div>
					<div className={styles.heroCopy}>
						<span className={styles.heroEyebrow}>
							<T id="login.hero.eyebrow" />
						</span>
						<h2>
							<T id="login.hero.title" />
						</h2>
						<p>
							<T id="login.hero.description" />
						</p>
						<div className={styles.featureGrid}>
							<span>
								<T id="login.hero.feature-config" />
							</span>
							<span>
								<T id="login.hero.feature-recovery" />
							</span>
							<span>
								<T id="login.hero.feature-health" />
							</span>
						</div>
					</div>
					<div className={styles.brandFooter}>Built for reliable self-hosted infrastructure.</div>
				</section>

				<section className={styles.formPanel}>
					<div className={styles.toolbar}>
						<LocalePicker />
						<ThemeSwitcher />
					</div>
					<div className={styles.formWrap}>
						<div className={styles.mobileBrand}>
							<img src="/images/npm-improved-mark.svg" width={40} height={40} alt="" />
							<div>
								<strong>NPM Improved</strong>
								<span>
									<T id="app.tagline" />
								</span>
							</div>
						</div>
						{twoFactorChallenge ? <TwoFactorForm /> : <LoginForm />}
						<div className={styles.version}>NPM Improved {getVersion()}</div>
					</div>
				</section>
			</div>
		</Page>
	);
}
