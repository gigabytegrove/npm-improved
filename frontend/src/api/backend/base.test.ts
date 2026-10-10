import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AuthStore from "src/modules/AuthStore";
import { get, post, downloadPost } from "./base";

const valid = () => AuthStore.set({
	token: "test-jwt",
	expires: new Date(Date.now() + 3600000).toISOString(),
});
const unauthorized = (json: () => Promise<any>) => ({
	status: 401,
	ok: false,
	json,
}) as Response;

describe("API session expiration", () => {
	beforeEach(() => {
		localStorage.clear();
		valid();
	});
	afterEach(() => vi.unstubAllGlobals());

	it("immediately expires credentials for non-JSON HTTP 401 responses", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(unauthorized(async () => {
			throw new SyntaxError("Unexpected HTML");
		})));
		await expect(get({ url: "/users/me" })).rejects.toThrow("session has expired");
		expect(AuthStore.token).toBeNull();
	});

	it("immediately expires credentials for a JSON HTTP 401 response", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(unauthorized(async () =>
			({ error: { message: "Invalid token" } }))));
		await expect(get({ url: "/reports/hosts" })).rejects.toThrow("Invalid token");
		expect(AuthStore.hasActiveToken()).toBe(false);
	});

	it("does not invalidate another session after a failed sign-in attempt", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(unauthorized(async () =>
			({ error: { message: "Invalid password" } }))));
		await expect(post({ url: "/tokens", data: { identity: "x", secret: "bad" }, noAuth: true }))
			.rejects.toThrow("Invalid password");
		expect(AuthStore.token?.token).toBe("test-jwt");
	});

	it("also handles expired credentials for protected CSV downloads", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(unauthorized(async () =>
			({ error: { message: "Expired token" } }))));
		await expect(downloadPost({ url: "/analytics/node/export", data: {} })).rejects.toThrow("Expired token");
		expect(AuthStore.token).toBeNull();
	});
});
