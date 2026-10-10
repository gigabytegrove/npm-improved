import { describe, expect, it } from "vitest";
import { hostUpdaterBootstrap } from "./hostUpdaterBootstrap";

describe("one-time native host updater bootstrap", () => {
  it("generates a multiline checksum-verified host command for the installed release", () => {
    const cmd = hostUpdaterBootstrap("/opt/npm-improved", "1.6.4");
    expect(cmd).toContain("NPMI_PROJECT='/opt/npm-improved'");
    expect(cmd).toContain("NPMI_RELEASE='v1.6.4'");
    expect(cmd).toContain("sha256sum -c selected-checksum.txt");
    expect(cmd).toContain('sudo bash scripts/install-host-updater "$NPMI_PROJECT"');
    expect(cmd).toContain("\n");
    expect(cmd).not.toContain("docker run");
  });
  it("rejects untrusted release tags and quotes project paths", () => {
    expect(hostUpdaterBootstrap("/opt/npm-improved", "latest")).toBeNull();
    expect(hostUpdaterBootstrap("/opt/npm-improved", "1.6.4; touch /root/hacked")).toBeNull();
    const cmd = hostUpdaterBootstrap("/opt/this ' node", "v1.6.4");
    expect(cmd).toContain("NPMI_RELEASE='v1.6.4'");
    expect(cmd).toContain("NPMI_PROJECT='/opt/this ");
    expect(cmd).toContain("node'");
  });
});
