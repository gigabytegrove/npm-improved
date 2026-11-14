import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("unified instance firewall console", () => {
  it("uses one component for the Settings tab and the top-level Firewall route", () => {
    const settings = read("src/pages/Settings/Layout.tsx");
    const topLevel = read("src/pages/Settings/InstanceSecurity.tsx");
    expect(settings).toContain('import FirewallSettings from "./Firewall"');
    expect(settings).toContain("return <FirewallSettings />");
    expect(topLevel).toContain('export { default } from "./Firewall"');
  });

  it("distinguishes observed live kernel rules from saved configuration", () => {
    const page = read("src/pages/Settings/Firewall.tsx");
    expect(page).toContain("data.liveRules");
    expect(page).toContain("data.liveRulesObservedAt");
    expect(page).toContain("data.desiredPolicy");
    expect(page).toContain("No active kernel firewall rules have been confirmed");
  });

  it("does not require a typed host LAN address in setup or firewall settings", () => {
    const page = read("src/pages/Settings/Firewall.tsx");
    const setup = read("src/pages/Setup/index.tsx");
    expect(page).not.toContain('id="host-lan-ip"');
    expect(setup).not.toContain('id="initial-security-lan"');
    expect(page).toContain("data.instanceIp");
    expect(page).toContain("data.publicIpv4");
  });

  it("retains confirmation and rollback safeguards", () => {
    const page = read("src/pages/Settings/Firewall.tsx");
    expect(page).toContain("confirmActivation");
    expect(page).toContain("data.pendingUntil");
    expect(page).toContain('savePolicy("active")');
    expect(page).toContain("confirm.mutateAsync()");
  });
});
