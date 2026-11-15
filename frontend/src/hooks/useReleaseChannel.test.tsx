import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readReleaseChannel, setReleaseChannelPreference, useReleaseChannel } from "./useReleaseChannel";

describe("persistent release-channel update notification", () => {
	beforeEach(() => {
		setReleaseChannelPreference("stable");
	});
	afterEach(() => {
		cleanup();
		setReleaseChannelPreference("stable");
	});

	it("notifies Update and Settings badge consumers when Beta is selected", () => {
		const update = renderHook(() => useReleaseChannel());
		const sidebar = renderHook(() => useReleaseChannel());
		expect(update.result.current[0]).toBe("stable");
		expect(sidebar.result.current[0]).toBe("stable");
		act(() => update.result.current[1]("beta"));
		expect(update.result.current[0]).toBe("beta");
		expect(sidebar.result.current[0]).toBe("beta");
		expect(window.localStorage.getItem("npm-improved.update.release-channel")).toBe("beta");
		expect(readReleaseChannel()).toBe("beta");
		update.unmount();
		sidebar.unmount();
	});

	it("retains the selected channel on a new mount and follows cross-tab storage changes", () => {
		setReleaseChannelPreference("alpha");
		const sidebar = renderHook(() => useReleaseChannel());
		expect(sidebar.result.current[0]).toBe("alpha");
		act(() => {
			window.localStorage.setItem("npm-improved.update.release-channel", "beta");
			window.dispatchEvent(new StorageEvent("storage", {
				key: "npm-improved.update.release-channel",
				newValue: "beta",
			}));
		});
		expect(sidebar.result.current[0]).toBe("beta");
		sidebar.unmount();
	});
});
