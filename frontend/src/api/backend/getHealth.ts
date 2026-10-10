import * as api from "./base";
import type { HealthResponse } from "./responseTypes";
import { observeBackendNode } from "src/modules/BackendNode";

export async function getHealth(): Promise<HealthResponse> {
	const result: HealthResponse = await api.get({
		url: "/",
	});
	// The JSON payload also identifies the host if an intermediary removes
	// our custom response header.
	if (result.node?.hostname) observeBackendNode(result.node.hostname);
	return result;
}
