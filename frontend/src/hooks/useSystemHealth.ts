import { useQuery } from "@tanstack/react-query";
import { getControlPlaneHealth, getSystemHealth, type ControlPlaneHealth, type SystemHealth } from "src/api/backend";

export const useSystemHealth = () =>
	useQuery<SystemHealth, Error>({
		queryKey: ["system-health"],
		queryFn: getSystemHealth,
		refetchInterval: 15 * 1000,
		staleTime: 10 * 1000,
		refetchOnWindowFocus: true,
	});

export const useControlPlaneHealth = () =>
	useQuery<ControlPlaneHealth, Error>({
		queryKey: ["control-plane-health"],
		queryFn: getControlPlaneHealth,
		refetchInterval: 15 * 1000,
		staleTime: 10 * 1000,
		retry: 2,
		refetchOnWindowFocus: true,
	});