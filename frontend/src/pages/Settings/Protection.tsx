import { Field, Form, Formik } from "formik";
import { type ReactNode, useState } from "react";
import { Alert } from "react-bootstrap";
import { Button, Loading } from "src/components";
import { useSetSetting, useSetting } from "src/hooks";
import { showObjectSuccess } from "src/notifications";

const profiles = [
	{
		value: "off",
		label: "Off",
		details: "No global managed request or connection limits. Individual hosts can still opt into protection.",
	},
	{
		value: "standard",
		label: "Standard",
		details: "Recommended default: 30 requests/sec per source, burst 60, up to 40 concurrent connections.",
	},
	{
		value: "aggressive",
		label: "Aggressive",
		details: "Stricter policy: 10 requests/sec per source, burst 20, up to 15 concurrent connections.",
	},
];

export default function Protection() {
	const { data, isLoading, error } = useSetting("http-protection");
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

	const initialTrusted = Array.isArray(data?.meta?.trustedNetworks) ? data.meta.trustedNetworks.join("\n") : "";

	return (
		<Formik
			enableReinitialize
			initialValues={{
				profile: data?.value || "standard",
				trustedNetworks: initialTrusted,
			}}
			validate={(values) => {
				const errors: Record<string, string> = {};
				const lines = values.trustedNetworks
					.split(/\r?\n/)
					.map((line) => line.trim())
					.filter(Boolean);
				if (lines.length > 128) {
					errors.trustedNetworks = "No more than 128 trusted networks may be configured.";
				}
				return errors;
			}}
			onSubmit={(values, { setSubmitting }) => {
				if (isSubmitting) return;
				setIsSubmitting(true);
				setErrorMsg(null);

				const trustedNetworks = values.trustedNetworks
					.split(/\r?\n/)
					.map((line) => line.trim())
					.filter(Boolean);

				setSetting(
					{
						id: "http-protection",
						value: values.profile,
						meta: {
							trustedNetworks,
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
			{({ values, errors, touched }) => (
				<Form>
					<div className="card-body">
						<Alert variant="danger" show={!!errorMsg} onClose={() => setErrorMsg(null)} dismissible>
							{errorMsg}
						</Alert>

						<h3 className="mb-1">HTTP Protection</h3>
						<p className="text-secondary">
							Managed application-layer protection for HTTP proxy, redirection, and 404 hosts.
						</p>

						<div className="mb-4">
							<label className="form-label" htmlFor="http-protection-profile">
								Global profile
							</label>
							<Field id="http-protection-profile" name="profile" as="select" className="form-select">
								{profiles.map((profile) => (
									<option value={profile.value} key={profile.value}>
										{profile.label}
									</option>
								))}
							</Field>
							<div className="text-secondary mt-2">
								{profiles.find((profile) => profile.value === values.profile)?.details}
							</div>
						</div>

						<div className="mb-4">
							<label className="form-label" htmlFor="http-protection-trusted-networks">
								Trusted IPs and networks
							</label>
							<Field
								id="http-protection-trusted-networks"
								name="trustedNetworks"
								as="textarea"
								rows={7}
								className={"form-control " + (errors.trustedNetworks && touched.trustedNetworks ? "is-invalid" : "")}
								placeholder={"10.0.0.0/8\n192.168.1.50\n2001:db8::/32"}
							/>
							{errors.trustedNetworks && touched.trustedNetworks ? (
								<div className="invalid-feedback">{String(errors.trustedNetworks)}</div>
							) : null}
							<div className="text-secondary mt-2">
								One IPv4/IPv6 address or CIDR network per line. Trusted sources bypass managed rate and
								connection accounting. Loopback is always trusted.
							</div>
						</div>

						<Alert variant="warning" className="mb-0">
							This protects Nginx and upstream applications from request floods, excessive concurrent
							connections, and slow-client resource exhaustion. It does not replace upstream DDoS protection
							for attacks large enough to saturate your Internet connection.
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
								Save
							</Button>
						</div>
					</div>
				</Form>
			)}
		</Formik>
	);
}
