import * as api from "./base";
import type { ConfigRevision } from "./models";

export async function restoreConfigRevision(id: number): Promise<ConfigRevision> {
	return await api.post({
		url: `/config-history/${id}/restore`,
	});
}
