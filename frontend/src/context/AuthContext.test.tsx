import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AuthStore from "src/modules/AuthStore";
import { AuthProvider, useAuthState } from "./AuthContext";

vi.mock("rooks", () => ({ useIntervalWhen: () => undefined }));
function Indicator() {
	const auth = useAuthState();
	return <div>{auth.authenticated ? "Authenticated" : "Sign in required"}</div>;
}
describe("expired-session React state", () => {
	beforeEach(() => {
		localStorage.clear();
		window.history.replaceState(null, "", "/analytics/requests");
	});
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});
	it("returns to login immediately when API invalidates a token without a full reload", async () => {
		AuthStore.set({ token: "test-session", expires: new Date(Date.now() + 3600000).toISOString() });
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		render(<QueryClientProvider client={client}><AuthProvider><Indicator /></AuthProvider></QueryClientProvider>);
		expect(screen.getByText("Authenticated")).toBeVisible();
		AuthStore.clear();
		await waitFor(() => expect(screen.getByText("Sign in required")).toBeVisible());
		expect(window.location.pathname).toBe("/login");
	});
});
