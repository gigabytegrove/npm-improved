import { describe, expect, it } from "vitest";
import { getBackendNodeSnapshot, observeBackendNode } from "./BackendNode";

describe("live backend hostname indicator", () => {
  it("tracks the actual latest API responder and detects a node switch", () => {
    observeBackendNode(null);
    expect(getBackendNodeSnapshot().hostname).toBeNull();

    observeBackendNode("proxy1");
    expect(getBackendNodeSnapshot()).toMatchObject({
      hostname: "proxy1",
      previousHostname: null,
      switched: false,
    });

    observeBackendNode("proxy2");
    expect(getBackendNodeSnapshot()).toMatchObject({
      hostname: "proxy2",
      previousHostname: "proxy1",
      switched: true,
    });

    observeBackendNode("proxy2");
    expect(getBackendNodeSnapshot().hostname).toBe("proxy2");
    expect(getBackendNodeSnapshot().previousHostname).toBe("proxy1");

    // Do not display a stale, plausible but unverified node identity when a
    // legacy backend returns without the new node-identity header.
    observeBackendNode(null);
    expect(getBackendNodeSnapshot()).toMatchObject({
      hostname: null,
      previousHostname: "proxy2",
      switched: false,
    });

    observeBackendNode("hostname\r\nInvalid: yes");
    expect(getBackendNodeSnapshot().hostname).toBeNull();
  });
});
