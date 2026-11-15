import { useSyncExternalStore } from "react";

export type ReleaseChannel = "stable" | "beta" | "alpha";

const STORAGE_KEY = "npm-improved.update.release-channel";
const CHANGE_EVENT = "npmi:release-channel-change";
let fallbackChannel: ReleaseChannel = "stable";

const isReleaseChannel = (value: unknown): value is ReleaseChannel =>
	value === "stable" || value === "beta" || value === "alpha";

export const readReleaseChannel = (): ReleaseChannel => {
	try {
		const saved = window.localStorage.getItem(STORAGE_KEY);
		if (isReleaseChannel(saved)) return saved;
	} catch {
		// Continue to use the selected channel within this browser tab.
	}
	return fallbackChannel;
};

export const setReleaseChannelPreference = (channel: ReleaseChannel) => {
	if (!isReleaseChannel(channel)) return;
	fallbackChannel = channel;
	try {
		window.localStorage.setItem(STORAGE_KEY, channel);
	} catch {
		// Storage can be disabled. Keep the in-memory preference for this tab.
	}
	window.dispatchEvent(new Event(CHANGE_EVENT));
};

const subscribe = (listener: () => void): (() => void) => {
	window.addEventListener(CHANGE_EVENT, listener);
	window.addEventListener("storage", listener);
	return () => {
		window.removeEventListener(CHANGE_EVENT, listener);
		window.removeEventListener("storage", listener);
	};
};

export const useReleaseChannel = (): readonly [ReleaseChannel, (channel: ReleaseChannel) => void] => {
	const channel = useSyncExternalStore<ReleaseChannel>(subscribe, readReleaseChannel, () => "stable");
	return [channel, setReleaseChannelPreference] as const;
};
