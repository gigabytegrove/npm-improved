import { Field, Form, Formik } from "formik";
import { type ReactNode, useState } from "react";
import { Alert } from "react-bootstrap";
import { Button, Loading } from "src/components";
import { useSetSetting, useSetting } from "src/hooks";
import { T } from "src/locale";
import { showObjectSuccess } from "src/notifications";

export default function CertificateLifecycle() {
	const { data, isLoading, error } = useSetting("certificate-lifecycle");
	const { mutate: setSetting } = useSetSetting();
	const [errorMsg, setErrorMsg] = useState<ReactNode | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	if (isLoading) {
		return (
			<div className="card-body">
				<Loading noLogo />
			</div>
		);
	}

	if (error) {
		return (
			<div className="card-body">
				<Alert variant="danger">{error.message}</Alert>
			</div>
		);
	}

	return (
		<Formik
			initialValues={{
				enabled: data?.value !== "disabled",
				unusedRetentionDays: data?.meta?.unusedRetentionDays ?? 30,
				purgeCustomCertificates: data?.meta?.purgeCustomCertificates !== false,
			}}
			validate={(values) => {
				const errors: Record<string, string> = {};
				const days = Number(values.unusedRetentionDays);
				if (!Number.isInteger(days) || days < 1 || days > 3650) {
					errors.unusedRetentionDays = "Enter a whole number between 1 and 3650.";
				}
				return errors;
			}}
			onSubmit={(values, { setSubmitting }) => {
				if (isSubmitting) return;
				setIsSubmitting(true);
				setErrorMsg(null);

				setSetting(
					{
						id: "certificate-lifecycle",
						value: values.enabled ? "enabled" : "disabled",
						meta: {
							unusedRetentionDays: Number(values.unusedRetentionDays),
							purgeCustomCertificates: values.purgeCustomCertificates,
						},
					},
					{
						onError: (err: any) => setErrorMsg(err.message),
						onSuccess: () => showObjectSuccess("setting", "saved"),
						onSettled: () => {
							setIsSubmitting(false);
							setSubmitting(false);
						},
					},
				);
			}}
		>
			{({ errors, touched }) => (
				<Form>
					<div className="card-body">
						<Alert variant="danger" show={!!errorMsg} onClose={() => setErrorMsg(null)} dismissible>
							{errorMsg}
						</Alert>

						<div className="mb-4">
							<label className="form-check form-switch">
								<Field name="enabled" type="checkbox" className="form-check-input" />
								<span className="form-check-label">
									<strong>Automatically purge unused certificates</strong>
								</span>
							</label>
							<div className="text-secondary mt-1">
								Unused certificates enter quarantine first. If a host references a certificate again, its
								quarantine is cancelled automatically.
							</div>
						</div>

						<div className="mb-4">
							<label className="form-label" htmlFor="certificate-unused-retention-days">
								Unused certificate quarantine
							</label>
							<div className="input-group" style={{ maxWidth: 260 }}>
								<Field
									id="certificate-unused-retention-days"
									name="unusedRetentionDays"
									type="number"
									min="1"
									max="3650"
									step="1"
									className={`form-control ${errors.unusedRetentionDays && touched.unusedRetentionDays ? "is-invalid" : ""}`}
								/>
								<span className="input-group-text">days</span>
								{errors.unusedRetentionDays && touched.unusedRetentionDays ? (
									<div className="invalid-feedback">{errors.unusedRetentionDays}</div>
								) : null}
							</div>
							<div className="text-secondary mt-1">
								Newly unused certificates are never purged immediately. Existing unused certificates start a
								fresh quarantine when this feature first sees them.
							</div>
						</div>

						<div className="mb-3">
							<label className="form-check">
								<Field name="purgeCustomCertificates" type="checkbox" className="form-check-input" />
								<span className="form-check-label">
									Include imported/custom certificates in automatic cleanup
								</span>
							</label>
							<div className="text-secondary">
								Turn this off if you want custom certificates kept indefinitely even when no host references
								them. They will still appear in the Unused list.
							</div>
						</div>

						<Alert variant="info" className="mb-0">
							A certificate is considered active when any non-deleted Proxy Host, Redirection Host, 404 Host,
							or Stream references it. Disabled hosts still count as references so their certificates cannot be
							purged underneath them.
						</Alert>
					</div>

					<div className="card-footer bg-transparent mt-auto">
						<div className="btn-list justify-content-end">
							<Button
								type="submit"
								actionType="primary"
								className="ms-auto bg-teal"
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
