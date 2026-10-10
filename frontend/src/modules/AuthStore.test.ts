import { beforeEach, describe, expect, it } from "vitest";
import AuthStore, { AUTH_CHANGED_EVENT, TOKEN_KEY, tokenExpirySeconds } from "./AuthStore";

describe("NPMi authentication store", () => {
	beforeEach(() => localStorage.removeItem(TOKEN_KEY));

	it("accepts the API's ISO expiration and legacy numeric expiration", () => {
		const expiry = new Date(Date.now() + 3600000);
		expect(tokenExpirySeconds(expiry.toISOString())).toBe(Math.floor(expiry.getTime() / 1000));
		expect(tokenExpirySeconds(Math.floor(expiry.getTime() / 1000))).toBe(Math.floor(expiry.getTime() / 1000));
		expect(tokenExpirySeconds(expiry.getTime())).toBe(Math.floor(expiry.getTime() / 1000));
		expect(tokenExpirySeconds("invalid")).toBeNull();
	});

	it("rejects expired credentials and preserves unexpired credentials", () => {
		AuthStore.set({ token: "valid", expires: new Date(Date.now() + 300000).toISOString() });
		expect(AuthStore.hasActiveToken()).toBe(true);
		AuthStore.set({ token: "expired", expires: new Date(Date.now() - 300000).toISOString() });
		expect(AuthStore.hasActiveToken()).toBe(false);
		expect(AuthStore.token).toBeNull();
	});

	it("notifies application state immediately when a session is revoked", () => {
		let changes = 0;
		const changed = () => changes++;
		window.addEventListener(AUTH_CHANGED_EVENT, changed);
		try {
			AuthStore.set({ token: "valid", expires: new Date(Date.now() + 300000).toISOString() });
			AuthStore.clear();
			expect(changes).toBe(2);
			expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
		} finally {
			window.removeEventListener(AUTH_CHANGED_EVENT, changed);
		}
	});
});
