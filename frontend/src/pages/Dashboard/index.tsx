import {
	IconArrowUpRight,
	IconArrowsCross,
	IconBolt,
	IconBoltOff,
	IconDisc,
	IconNetwork,
	IconRoute,
	IconShieldCheck,
} from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import { HasPermission } from "src/components";
import { useHostReport } from "src/hooks";
import { T } from "src/locale";
import { DEAD_HOSTS, PROXY_HOSTS, REDIRECTION_HOSTS, STREAMS, VIEW } from "src/modules/Permissions";
import styles from "./Dashboard.module.css";

interface MetricCardProps {
	title: React.ReactNode;
	value?: number;
	icon: React.ReactNode;
	to: string;
	accent: "blue" | "cyan" | "violet" | "red";
}

function MetricCard({ title, value, icon, to, accent }: MetricCardProps) {
	const navigate = useNavigate();

	return (
		<a
			href={to}
			className={`${styles.metric} ${styles[accent]}`}
			onClick={(event) => {
				event.preventDefault();
				navigate(to);
			}}
		>
			<span className={styles.metricIcon}>{icon}</span>
			<span className={styles.metricCopy}>
				<strong>{typeof value === "number" ? value : "—"}</strong>
				<span>{title}</span>
			</span>
			<IconArrowUpRight size={15} className={styles.metricLink} />
		</a>
	);
}

const Dashboard = () => {
	const { data: hostReport, isPending, isError, refetch } = useHostReport();
	const navigate = useNavigate();

	const totalRoutes =
		(hostReport?.proxy || 0) +
		(hostReport?.redirection || 0) +
		(hostReport?.stream || 0) +
		(hostReport?.dead || 0);

	if (isPending) return <div className="p-4 text-secondary" role="status">Loading routing summary…</div>;
	if (isError || !hostReport) {
		return <div className="p-4" role="alert">
			<h1 className="h3">Routing summary unavailable</h1>
			<p>Unable to load current routing counts. This does not mean your hosts were removed.</p>
			<button type="button" className="btn btn-primary" onClick={() => void refetch()}>Retry</button>
		</div>;
	}

	return (
		<div className={styles.dashboard}>
			<section className={styles.toolbar}>
				<div>
					<h1>Overview</h1>
					<p>Current routing configuration and quick links.</p>
				</div>
				<div className={styles.toolbarActions}>
					<button
						type="button"
						className="btn btn-primary btn-sm"
						onClick={() => navigate("/nginx/proxy")}
					>
						<IconRoute size={16} />
						Proxy Hosts
					</button>
					<button
						type="button"
						className="btn btn-outline-secondary btn-sm"
						onClick={() => navigate("/system-health")}
					>
						<IconShieldCheck size={16} />
						System Health
					</button>
				</div>
			</section>

			<section className={styles.metricsGrid}>
				<HasPermission section={PROXY_HOSTS} permission={VIEW} hideError>
					<MetricCard
						title={<T id="proxy-hosts" />}
						value={hostReport?.proxy}
						icon={<IconBolt size={18} />}
						to="/nginx/proxy"
						accent="blue"
					/>
				</HasPermission>
				<HasPermission section={REDIRECTION_HOSTS} permission={VIEW} hideError>
					<MetricCard
						title={<T id="redirection-hosts" />}
						value={hostReport?.redirection}
						icon={<IconArrowsCross size={18} />}
						to="/nginx/redirection"
						accent="cyan"
					/>
				</HasPermission>
				<HasPermission section={STREAMS} permission={VIEW} hideError>
					<MetricCard
						title={<T id="streams" />}
						value={hostReport?.stream}
						icon={<IconDisc size={18} />}
						to="/nginx/stream"
						accent="violet"
					/>
				</HasPermission>
				<HasPermission section={DEAD_HOSTS} permission={VIEW} hideError>
					<MetricCard
						title={<T id="dead-hosts" />}
						value={hostReport?.dead}
						icon={<IconBoltOff size={18} />}
						to="/nginx/404"
						accent="red"
					/>
				</HasPermission>
			</section>

			<section className={styles.lowerGrid}>
				<div className={styles.summaryCard}>
					<div className={styles.sectionHeader}>
						<h2>Routing summary</h2>
						<span className={styles.totalBadge}>{totalRoutes} total</span>
					</div>
					<div className={styles.summaryRows}>
						<div className={styles.summaryRow}>
							<span>HTTP / HTTPS routing</span>
							<strong>{hostReport?.proxy || 0}</strong>
						</div>
						<div className={styles.summaryRow}>
							<span>Redirect rules</span>
							<strong>{hostReport?.redirection || 0}</strong>
						</div>
						<div className={styles.summaryRow}>
							<span>Layer 4 streams</span>
							<strong>{hostReport?.stream || 0}</strong>
						</div>
						<div className={styles.summaryRow}>
							<span>404 hosts</span>
							<strong>{hostReport?.dead || 0}</strong>
						</div>
					</div>
				</div>

				<div className={styles.haCard}>
					<div className={styles.haHeading}>
						<IconNetwork size={20} />
						<h2>High availability</h2>
					</div>
					<p>
						Use upstream pools for backend redundancy and Instance Synchronization for redundant
						NPM Improved nodes.
					</p>
					<div className={styles.haActions}>
						<button
							type="button"
							className="btn btn-outline-secondary btn-sm"
							onClick={() => navigate("/nginx/proxy")}
						>
							Upstream pools
						</button>
						<button
							type="button"
							className="btn btn-outline-secondary btn-sm"
							onClick={() => navigate("/settings?section=instance-sync")}
						>
							Instance sync
						</button>
					</div>
				</div>
			</section>
		</div>
	);
};

export default Dashboard;
