import { describe, expect, it } from "vitest";
import { showFirewallNavigation } from "./instanceFirewallVisibility";

describe("firewall navigation visibility", () => {
	it("shows the top-level item only for explicitly enabled functionality", () => {
		expect(showFirewallNavigation(true)).toBe(true);
		expect(showFirewallNavigation(false)).toBe(false);
		expect(showFirewallNavigation(null)).toBe(false);
		expect(showFirewallNavigation(undefined)).toBe(false);
	});
});
