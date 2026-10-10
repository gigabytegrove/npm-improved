import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import Router from "src/Router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authState } = vi.hoisted(() => ({ authState: { authenticated: true } }));

vi.mock("src/context", () => ({ useAuthState: () => authState }));
vi.mock("src/hooks", () => ({
	useHealth: () => ({ data: { status: "OK", setup: true }, isLoading: false, isError: false }),
}));
vi.mock("src/components", () => ({
	Page: ({ children }: { children: ReactNode }) => children,
	SiteContainer: ({ children }: { children: ReactNode }) => children,
	SiteHeader: () => null,
	SiteMenu: () => null,
	SiteFooter: () => null,
	LoadingPage: () => <div>Loading</div>,
	Unhealthy: () => <div>Unhealthy</div>,
	ErrorNotFound: () => <h1>Not found</h1>,
}));
vi.mock("src/pages/Dashboard", () => ({ default: () => <h1>Dashboard</h1> }));
vi.mock("src/pages/Login", () => ({ default: () => <h1>Login</h1> }));
vi.mock("src/pages/Nginx/ProxyHosts", () => ({ default: () => <h1>Proxy hosts</h1> }));

vi.mock("src/pages/Nginx/ProxyHosts/HostAnalytics", () => ({ default: () => <h1>Proxy Host Analytics</h1> }));
vi.mock("src/pages/AnalyticsCenter", async () => {
  const { Outlet } = await import("react-router-dom");
  return { default: () => <div><Outlet /></div> };
});
vi.mock("src/pages/AnalyticsCenter/Overview", () => ({ default: () => <h1>Overview</h1> }));
vi.mock("src/pages/AnalyticsCenter/Trends", () => ({ default: () => <h1>Trends</h1> }));
vi.mock("src/pages/AnalyticsCenter/Traffic", () => ({ default: () => <h1>Traffic Breakdown</h1> }));
vi.mock("src/pages/AnalyticsCenter/Hosts", () => ({ default: () => <h1>HTTP Routes</h1> }));
vi.mock("src/pages/AnalyticsCenter/Streams", () => ({ default: () => <h1>TCP UDP Streams</h1> }));
vi.mock("src/pages/AnalyticsCenter/Requests", () => ({ default: () => <h1>Request History</h1> }));
vi.mock("src/pages/AnalyticsCenter/Connections", () => ({ default: () => <h1>Connection History</h1> }));
vi.mock("src/pages/AnalyticsCenter/Clients", () => ({ default: () => <h1>IP Addresses</h1> }));
vi.mock("src/pages/AnalyticsCenter/UserAgents", () => ({ default: () => <h1>User Agents & Bots</h1> }));
vi.mock("src/pages/AnalyticsCenter/Security", () => ({ default: () => <h1>Errors & Security</h1> }));
vi.mock("src/pages/AnalyticsCenter/Blocking", () => ({ default: () => <h1>Blocking & Enforcement</h1> }));
vi.mock("src/pages/AnalyticsCenter/Performance", () => ({ default: () => <h1>Performance</h1> }));


describe("Router", () => {
	beforeEach(() => {
		authState.authenticated = true;
		window.history.replaceState(null, "", "/");
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it.each(["/login", "/login/", "/login?next=/users#form"])(
		"redirects an authenticated visit to %s to the dashboard",
		async (path) => {
			window.history.replaceState(null, "", path);
			const replaceState = vi.spyOn(window.history, "replaceState");
			render(<Router />);

			expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeVisible();
			expect(window.location.pathname).toBe("/");
			expect(window.location.search).toBe("");
			expect(window.location.hash).toBe("");
			expect(replaceState).toHaveBeenCalledWith(expect.anything(), "", "/");
		},
	);

	it("shows the login form when signed out and redirects after sign-in", async () => {
		authState.authenticated = false;
		window.history.replaceState(null, "", "/login");
		const { rerender } = render(<Router />);

		expect(await screen.findByRole("heading", { name: "Login" })).toBeVisible();
		expect(window.location.pathname).toBe("/login");

		authState.authenticated = true;
		rerender(<Router />);

		expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeVisible();
		await waitFor(() => expect(window.location.pathname).toBe("/"));
	});

	it.each([
    ["/analytics", "Overview"],
    ["/analytics/trends", "Trends"],
    ["/analytics/traffic", "Traffic Breakdown"],
    ["/analytics/hosts", "HTTP Routes"],
    ["/analytics/streams", "TCP UDP Streams"],
    ["/analytics/requests", "Request History"],
    ["/analytics/requests?ip=203.0.113.50", "Request History"],
    ["/analytics/connections", "Connection History"],
    ["/analytics/ips", "IP Addresses"],
    ["/analytics/user-agents", "User Agents & Bots"],
    ["/analytics/security", "Errors & Security"],
    ["/analytics/blocking", "Blocking & Enforcement"],
    ["/analytics/performance", "Performance"],
    ["/nginx/proxy/9/analytics", "Proxy Host Analytics"],
		["/", "Dashboard"],
		["/nginx/proxy", "Proxy hosts"],
		["/unknown", "Not found"],
	])("preserves the existing route for %s", async (path, heading) => {
		window.history.replaceState(null, "", path);
		render(<Router />);

		expect(await screen.findByRole("heading", { name: heading })).toBeVisible();
		const expectedUrl = new URL(path, window.location.origin);
    expect(window.location.pathname).toBe(expectedUrl.pathname);
    expect(window.location.search).toBe(expectedUrl.search);
	});
});
