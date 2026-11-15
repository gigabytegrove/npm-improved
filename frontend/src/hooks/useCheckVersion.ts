import { useQuery } from "@tanstack/react-query";
import { checkVersion, type VersionCheckResponse } from "src/api/backend";

const fetchVersion = (channel: "stable" | "beta" | "alpha" = "stable") => checkVersion(channel);

const useCheckVersion = (options = {}, channel: "stable" | "beta" | "alpha" = "stable") => {
	return useQuery<VersionCheckResponse, Error>({
		queryKey: ["version-check", channel],
		queryFn: () => fetchVersion(channel),
		refetchOnWindowFocus: false,
		retry: 5,
		refetchInterval: 30 * 1000, // 30 seconds
		staleTime: 5 * 60 * 1000, // 5 mins
		...options,
	});
};

export { fetchVersion, useCheckVersion };
