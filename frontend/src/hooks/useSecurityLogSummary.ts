import { useQuery } from "@tanstack/react-query";
import {
	type GetSecurityLogSummaryParams,
	getSecurityLogSummary,
	type SecurityLogSummary,
} from "src/api/backend";

const SECURITY_POLL_INTERVAL_MS = 30_000;

interface UseSecurityLogSummaryOptions extends GetSecurityLogSummaryParams {
	live?: boolean;
}

const useSecurityLogSummary = ({ live = true, ...params }: UseSecurityLogSummaryOptions = {}) =>
	useQuery<SecurityLogSummary, Error>({
		queryKey: ["security-log-summary", params],
		queryFn: () => getSecurityLogSummary(params),
		refetchInterval: live ? SECURITY_POLL_INTERVAL_MS : false,
		placeholderData: (previousData) => previousData,
	});

export { useSecurityLogSummary };
