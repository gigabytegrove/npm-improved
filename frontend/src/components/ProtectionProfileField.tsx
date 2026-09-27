import { Field } from "formik";

interface Props {
	name?: string;
}

const options = [
	{
		value: "inherit",
		label: "Inherit global policy",
		description: "Uses the protection profile configured in Settings > Protection.",
	},
	{
		value: "off",
		label: "Off",
		description: "Disables managed request and connection limiting for this host.",
	},
	{
		value: "standard",
		label: "Standard",
		description: "Balanced protection for normal public web applications and APIs.",
	},
	{
		value: "aggressive",
		label: "Aggressive",
		description: "Stricter limits for high-risk endpoints or services that should receive modest public traffic.",
	},
];

export default function ProtectionProfileField({ name = "meta.protectionProfile" }: Props) {
	return (
		<div className="mb-3">
			<label className="form-label" htmlFor="protection-profile">
				Protection profile
			</label>
			<Field id="protection-profile" name={name} as="select" className="form-select">
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</Field>
			<Field name={name}>
				{({ field }: any) => {
					const selected = options.find((option) => option.value === field.value) || options[0];
					return <div className="text-secondary mt-2">{selected.description}</div>;
				}}
			</Field>
			<div className="alert alert-info mt-3 mb-0">
				Protection uses Nginx request-rate, concurrent-connection, and slow-client controls. It mitigates
				application-layer abuse and resource exhaustion; it cannot stop a volumetric attack that saturates the
				Internet connection before traffic reaches this server.
			</div>
		</div>
	);
}
