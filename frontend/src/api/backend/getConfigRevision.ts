import * as api from "./base";
import type { ConfigRevision } from "./models";

export async function getConfigRevision(id: number): Promise<ConfigRevision> {
	return await api.get({
		url: `/config-history/${id}`,
	});
}
