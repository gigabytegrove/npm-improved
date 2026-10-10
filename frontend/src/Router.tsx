import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import {
	ErrorNotFound,
	LoadingPage,
	Page,
	SiteContainer,
	SiteFooter,
	SiteHeader,
	SiteMenu,
	Unhealthy,
} from "src/components";
import { useAuthState } from "src/context";
import { useHealth, useUser } from "src/hooks";

const Setup = lazy(() => import("src/pages/Setup"));
const Login = lazy(() => import("src/pages/Login"));
const Dashboard = lazy(() => import("src/pages/Dashboard"));
const Settings = lazy(() => import("src/pages/Settings"));
const SystemHealth = lazy(() => import("src/pages/SystemHealth"));
const Certificates = lazy(() => import("src/pages/Certificates"));
const ConfigHistory = lazy(() => import("src/pages/ConfigHistory"));
const Access = lazy(() => import("src/pages/Access"));
const AuditLog = lazy(() => import("src/pages/AuditLog"));
const Logs = lazy(() => import("src/pages/Logs"));
const Users = lazy(() => import("src/pages/Users"));
const ProxyHosts = lazy(() => import("src/pages/Nginx/ProxyHosts"));
const HostAnalytics = lazy(() => import("src/pages/Nginx/ProxyHosts/HostAnalytics"));
const AnalyticsCenter = lazy(() => import("src/pages/AnalyticsCenter"));
const AnalyticsOverview = lazy(() => import("src/pages/AnalyticsCenter/Overview"));
const AnalyticsTrends = lazy(() => import("src/pages/AnalyticsCenter/Trends"));
const AnalyticsTraffic = lazy(() => import("src/pages/AnalyticsCenter/Traffic"));
const AnalyticsHosts = lazy(() => import("src/pages/AnalyticsCenter/Hosts"));
const AnalyticsHostDetail = lazy(() => import("src/pages/AnalyticsCenter/HostDetail"));
const AnalyticsStreams = lazy(() => import("src/pages/AnalyticsCenter/Streams"));
const AnalyticsRequests = lazy(() => import("src/pages/AnalyticsCenter/Requests"));
const AnalyticsConnections = lazy(() => import("src/pages/AnalyticsCenter/Connections"));
const AnalyticsClients = lazy(() => import("src/pages/AnalyticsCenter/Clients"));
const AnalyticsUserAgents = lazy(() => import("src/pages/AnalyticsCenter/UserAgents"));
const AnalyticsSecurity = lazy(() => import("src/pages/AnalyticsCenter/Security"));
const AnalyticsBlocking = lazy(() => import("src/pages/AnalyticsCenter/Blocking"));
const AnalyticsPerformance = lazy(() => import("src/pages/AnalyticsCenter/Performance"));
const AnalyticsProfile = lazy(() => import("src/pages/AnalyticsCenter/Profile"));
const RedirectionHosts = lazy(() => import("src/pages/Nginx/RedirectionHosts"));
const DeadHosts = lazy(() => import("src/pages/Nginx/DeadHosts"));
const Streams = lazy(() => import("src/pages/Nginx/Streams"));

function Router() {
	const health = useHealth();
	const { authenticated, logout } = useAuthState();
	const session = useUser("me", { enabled: authenticated, retry: false });

	// Losing authentication must show Login immediately, even while the
	// health check is loading or the updater is restarting the backend.
	// Only a confirmed first-time installation enters the setup wizard.
	if (!authenticated) {
		if (health.data?.status === "OK" && !health.data.setup) return <Setup />;
		return (
			<Suspense fallback={<LoadingPage />}>
				<Login />
			</Suspense>
		);
	}

	if (health.isLoading) {
		return <LoadingPage />;
	}

	if (health.isError || health.data?.status !== "OK") {
		return <Unhealthy />;
	}

	if (!health.data?.setup) {
		return <Setup />;
	}

	// Never display protected data before the server has verified /users/me.
	// This prevents authentication failures from looking like empty installations.
	if (session.isPending) return <LoadingPage />;
	if (session.isError) {
		return (
			<Page>
				<main className="container py-5" role="alert">
					<h1 className="h3">Unable to verify your session</h1>
					<p>Routing configuration is unavailable. No hosts have been removed.</p>
					<div className="d-flex gap-2">
						<button type="button" className="btn btn-primary" onClick={() => void session.refetch()}>Retry</button>
						<button type="button" className="btn btn-outline-secondary" onClick={logout}>Sign in again</button>
					</div>
				</main>
			</Page>
		);
	}

	return (
		<BrowserRouter>
			<Page>
				<div className="npmi-shell">
					<SiteMenu />
					<div className="npmi-workspace">
						<SiteHeader />
						<SiteContainer>
							<Suspense fallback={<LoadingPage noLogo />}>
								<Routes>
									<Route path="*" element={<ErrorNotFound />} />
									<Route path="/login" element={<Navigate to="/" replace />} />
									<Route path="/certificates" element={<Certificates />} />
									<Route path="/config-history" element={<ConfigHistory />} />
									<Route path="/access" element={<Access />} />
									<Route path="/audit-log" element={<AuditLog />} />
									<Route path="/logs" element={<Logs />} />
									<Route path="/settings" element={<Settings />} />
									<Route path="/system-health" element={<SystemHealth />} />
									<Route path="/users" element={<Users />} />
									<Route path="/nginx/proxy" element={<ProxyHosts />} />
									<Route path="/nginx/proxy/:id/analytics" element={<HostAnalytics />} />
									<Route path="/analytics" element={<AnalyticsCenter />}>
                    <Route index element={<AnalyticsOverview />} />
                    <Route path="trends" element={<AnalyticsTrends />} />
                    <Route path="traffic" element={<AnalyticsTraffic />} />
                    <Route path="hosts" element={<AnalyticsHosts />} />
                    <Route path="hosts/detail" element={<AnalyticsHostDetail />} />
                    <Route path="streams" element={<AnalyticsStreams />} />
                    <Route path="requests" element={<AnalyticsRequests />} />
                    <Route path="connections" element={<AnalyticsConnections />} />
                    <Route path="ips" element={<AnalyticsClients />} />
                    <Route path="ips/detail" element={<AnalyticsProfile />} />
                    <Route path="user-agents" element={<AnalyticsUserAgents />} />
                    <Route path="user-agents/detail" element={<AnalyticsProfile />} />
                    <Route path="security" element={<AnalyticsSecurity />} />
                    <Route path="blocking" element={<AnalyticsBlocking />} />
                    <Route path="performance" element={<AnalyticsPerformance />} />
                    <Route path="*" element={<ErrorNotFound />} />
                  </Route>
									<Route path="/nginx/redirection" element={<RedirectionHosts />} />
									<Route path="/nginx/404" element={<DeadHosts />} />
									<Route path="/nginx/stream" element={<Streams />} />
									<Route path="/" element={<Dashboard />} />
								</Routes>
							</Suspense>
						</SiteContainer>
						<SiteFooter />
					</div>
				</div>
			</Page>
		</BrowserRouter>
	);
}

export default Router;
