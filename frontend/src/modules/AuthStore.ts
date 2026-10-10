import type { TokenResponse } from "src/api/backend";

export const TOKEN_KEY = "authentications";
export const AUTH_CHANGED_EVENT = "npmi:authentication-changed";

// API token expiry is an ISO date. Older installs may have stored a Unix timestamp.
export const tokenExpirySeconds = (value: unknown): number | null => {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
	}
	if (typeof value !== "string" || !value.trim()) return null;
	if (/^\d+$/.test(value)) return tokenExpirySeconds(Number(value));
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
};

export class AuthStore {
	// Get all tokens from stack
	get tokens() {
		const t = localStorage.getItem(TOKEN_KEY);
		let tokens = [];
		if (t !== null) {
			try {
				tokens = JSON.parse(t);
			} catch (e) {
				console.error("Failed to parse tokens from localStorage", e);
			}
		}
		return Array.isArray(tokens) ? tokens : [];
	}

	// Get last token from stack
	get token() {
		const t = this.tokens;
		if (t.length) {
			return t[t.length - 1];
		}
		return null;
	}

	// Convert the stored ISO or numeric token expiry to Unix seconds.
	get expires() {
		return tokenExpirySeconds(this.token?.expires);
	}

	// Remove expired impersonation tokens, but do not treat missing/invalid
	// credentials as an authenticated session.
	hasActiveToken() {
		while (this.tokens.length) {
			if (typeof this.token?.token === "string" && this.token.token.length > 0 &&
				this.expires !== null && this.expires > Math.floor(Date.now() / 1000)) {
				return true;
			}
			this.drop();
		}
		return false;
	}

	private notify() {
		if (typeof window !== "undefined") window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
	}

	// Set a single token on the stack
	set({ token, expires }: TokenResponse) {
		localStorage.setItem(TOKEN_KEY, JSON.stringify([{ token, expires }]));
		this.notify();
	}

	// Add a token to the END of the stack
	add({ token, expires }: TokenResponse) {
		const t = this.tokens;
		t.push({ token, expires });
		localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
		this.notify();
	}

	// Drop a token from the END of the stack
	drop() {
		const t = this.tokens;
		t.splice(-1, 1);
		localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
		this.notify();
	}

	clear() {
		if (localStorage.getItem(TOKEN_KEY) !== null) {
			localStorage.removeItem(TOKEN_KEY);
			this.notify();
		}
	}

	count() {
		return this.tokens.length;
	}
}

export default new AuthStore();
