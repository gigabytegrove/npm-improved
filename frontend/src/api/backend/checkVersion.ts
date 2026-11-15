import * as api from "./base";
import type { VersionCheckResponse } from "./responseTypes";

export async function checkVersion(channel: "stable" | "beta" | "alpha" = "stable"): Promise<VersionCheckResponse> {
	return await api.get({
		url: "/version/check",
		params: { channel },
	});
}
