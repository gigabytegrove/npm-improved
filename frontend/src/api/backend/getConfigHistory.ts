import * as api from "./base";
import type { ConfigRevision, ConfigRevisionStatus, ConfigRevisionObjectType } from "./models";

export interface ConfigHistoryFilters {
	objectType?: ConfigRevisionObjectType | "";
	objectId?: number;
	status?: ConfigRevisionStatus | "";
	limit?: number;
}

export async function getConfigHistory(filters: ConfigHistoryFilters = {}): Promise<ConfigRevision[]> {
	return await api.get({
		url: "/config-history",
		params: {
			objectType: filters.objectType || undefined,
			objectId: filters.objectId || undefined,
			status: filters.status || undefined,
			limit: filters.limit || 100,
		},
	});
}
