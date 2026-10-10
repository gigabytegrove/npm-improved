import { camelizeKeys, decamelize, decamelizeKeys } from "humps";
import queryString, { type StringifiableRecord } from "query-string";
import AuthStore from "src/modules/AuthStore";
import { observeBackendNode } from "src/modules/BackendNode";

const contentTypeHeader = "Content-Type";

interface BuildUrlArgs {
	url: string;
	params?: StringifiableRecord;
}

function decamelizeParams(params?: StringifiableRecord): StringifiableRecord | undefined {
	if (!params) {
		return undefined;
	}
	const result: StringifiableRecord = {};
	for (const [key, value] of Object.entries(params)) {
		result[decamelize(key)] = value;
	}

	return result;
}

function buildUrl({ url, params }: BuildUrlArgs) {
	const endpoint = url.replace(/^\/|\/$/g, "");
	const baseUrl = `/api/${endpoint}`;
	const apiUrl = queryString.stringifyUrl({
		url: baseUrl,
		query: decamelizeParams(params),
	});
	return apiUrl;
}

function buildAuthHeader(): Record<string, string> | undefined {
	if (AuthStore.token) {
		return { Authorization: `Bearer ${AuthStore.token.token}` };
	}
	return {};
}

function buildBody(data?: Record<string, any>): string | undefined {
	if (data) {
		return JSON.stringify(decamelizeKeys(data));
	}
}

// Handle authentication loss *before* attempting to decode an error body.
// nginx, proxies and some API errors may return non-JSON 401 responses.
export function expireUnauthorizedResponse(
	response: Pick<Response, "status">,
	authenticatedRequest = true,
	requestToken?: string,
) {
	const activeToken = AuthStore.token?.token;
	// A request may finish after the five-minute refresh has installed a
	// newer token. Never let its stale 401 revoke the refreshed session.
	if (response.status === 401 && authenticatedRequest && activeToken &&
		(!requestToken || requestToken === activeToken)) {
		AuthStore.clear();
	}
}

async function processResponse(response: Response, authenticatedRequest = true, requestToken?: string) {
	observeBackendNode(response.headers?.get("X-NPMi-Node-Hostname") ?? null);
	expireUnauthorizedResponse(response, authenticatedRequest, requestToken);
	let payload: any;
	try {
		payload = await response.json();
	} catch {
		payload = null;
	}
	if (!response.ok) {
		throw new Error(payload?.error?.messageI18n || payload?.error?.message ||
			(response.status === 401 ? "Your session has expired. Please sign in again." :
				`Request failed (HTTP ${response.status})`));
	}
	if (payload === null) throw new Error("The server returned an invalid response.");
	return camelizeKeys(payload) as any;
}

interface GetArgs {
	url: string;
	params?: queryString.StringifiableRecord;
}

async function baseGet({ url, params }: GetArgs, abortController?: AbortController) {
	const apiUrl = buildUrl({ url, params });
	const method = "GET";
	const headers = buildAuthHeader();
	const signal = abortController?.signal;
	const response = await fetch(apiUrl, { method, headers, signal });
	return { response, requestToken: headers?.Authorization?.slice(7) };
}

export async function get(args: GetArgs, abortController?: AbortController) {
	const { response, requestToken } = await baseGet(args, abortController);
	return processResponse(response, true, requestToken);
}

export async function download({ url, params }: GetArgs, filename = "download.file") {
	const headers = buildAuthHeader();
	const res = await fetch(buildUrl({ url, params }), { headers });
	observeBackendNode(res.headers?.get("X-NPMi-Node-Hostname") ?? null);
	if (!res.ok) return processResponse(res, true, headers?.Authorization?.slice(7));
	const bl = await res.blob();
	const u = window.URL.createObjectURL(bl);
	const a = document.createElement("a");
	a.href = u;
	a.download = filename;
	a.click();
	window.URL.revokeObjectURL(u);
}

interface PostArgs {
	url: string;
	params?: queryString.StringifiableRecord;
	data?: any;
	noAuth?: boolean;
}

export async function post({ url, params, data, noAuth }: PostArgs, abortController?: AbortController) {
	const apiUrl = buildUrl({ url, params });
	const method = "POST";

	let headers: Record<string, string> = {};
	if (!noAuth) {
		headers = {
			...buildAuthHeader(),
		};
	}

	let body: string | FormData | undefined;
	// Check if the data is an instance of FormData
	// If data is FormData, let the browser set the Content-Type header
	if (data instanceof FormData) {
		body = data;
	} else {
		// If data is JSON, set the Content-Type header to 'application/json'
		headers = {
			...headers,
			[contentTypeHeader]: "application/json",
		};
		body = buildBody(data);
	}

	const signal = abortController?.signal;
	const response = await fetch(apiUrl, { method, headers, body, signal });
	return processResponse(response, !noAuth, headers.Authorization?.slice(7));
}

export async function downloadPost(
	{ url, params, data }: PostArgs,
	filename = "download.file",
) {
	const headers: Record<string, string> = {
		...buildAuthHeader(),
		[contentTypeHeader]: "application/json",
	};
	const response = await fetch(buildUrl({ url, params }), {
		method: "POST",
		headers,
		body: buildBody(data),
	});

	observeBackendNode(response.headers?.get("X-NPMi-Node-Hostname") ?? null);
	if (!response.ok) {
		expireUnauthorizedResponse(response, true, headers.Authorization?.slice(7));
		let message = "Download failed";
		try {
			const payload = await response.json();
			message = payload?.error?.messageI18n || payload?.error?.message || message;
		} catch {
			// Keep the generic download error when the server did not return JSON.
		}
		throw new Error(message);
	}

	const blob = await response.blob();
	const disposition = response.headers.get("Content-Disposition") || "";
	const match = disposition.match(/filename="?([^";]+)"?/i);
	const resolvedFilename = match?.[1] || filename;
	const objectUrl = window.URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = objectUrl;
	anchor.download = resolvedFilename;
	anchor.click();
	window.URL.revokeObjectURL(objectUrl);
}

interface PutArgs {
	url: string;
	params?: queryString.StringifiableRecord;
	data?: Record<string, any>;
}
export async function put({ url, params, data }: PutArgs, abortController?: AbortController) {
	const apiUrl = buildUrl({ url, params });
	const method = "PUT";
	const headers: Record<string, string> = {
		...buildAuthHeader(),
		[contentTypeHeader]: "application/json",
	};
	const signal = abortController?.signal;
	const body = buildBody(data);
	const response = await fetch(apiUrl, { method, headers, body, signal });
	return processResponse(response, true, headers.Authorization?.slice(7));
}

interface DeleteArgs {
	url: string;
	params?: queryString.StringifiableRecord;
}
export async function del({ url, params }: DeleteArgs, abortController?: AbortController) {
	const apiUrl = buildUrl({ url, params });
	const method = "DELETE";
	const headers = {
		...buildAuthHeader(),
	};
	const signal = abortController?.signal;
	const response = await fetch(apiUrl, { method, headers, signal });
	return processResponse(response, true, headers.Authorization?.slice(7));
}
