import * as api from "./base";
import type { SecurityLogSummary } from "./models";

export interface GetSecurityLogSummaryParams {
	hours?: number;
	limit?: number;
}

export async function getSecurityLogSummary(
	params: GetSecurityLogSummaryParams = {},
): Promise<SecurityLogSummary> {
	return await api.get({
		url: "/logs/security",
		params: { ...params },
	});
}
