import type { ControlPlaneHealth } from "./models";

export async function getControlPlaneHealth(): Promise<ControlPlaneHealth> {
	const response = await fetch("/__npm_improved/health", {
		method: "GET",
		headers: { Accept: "application/json" },
		cache: "no-store",
	});
	if (!response.ok) {
		throw new Error(`Control plane health request failed with HTTP ${response.status}`);
	}
	return (await response.json()) as ControlPlaneHealth;
}