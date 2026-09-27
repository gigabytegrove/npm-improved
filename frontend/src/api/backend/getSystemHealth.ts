import * as api from "./base";
import type { SystemHealth } from "./models";

export async function getSystemHealth(): Promise<SystemHealth> {
	return await api.get({
		url: "/reports/system-health",
	});
}