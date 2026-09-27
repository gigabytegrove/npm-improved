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
			const user = await createUser(payload, true);
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
						<img src="/images/npm-improved-mark.svg" width={48} height={48} alt="" />
						<div>
							<strong>NPM Improved</strong>
							<span>
								<T id="app.tagline" />
							</span>
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
							<img src="/images/npm-improved-mark.svg" width={40} height={40} alt="" />
							<div>
								<strong>NPM Improved</strong>
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
