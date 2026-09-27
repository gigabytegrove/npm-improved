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
import { useHostReport, useUser } from "src/hooks";
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
			<div className={styles.metricTop}>
				<span className={styles.metricIcon}>{icon}</span>
				<span className={styles.metricLink}>
					<IconArrowUpRight size={16} />
				</span>
			</div>
			<div className={styles.metricValue}>{typeof value === "number" ? value : "—"}</div>
			<div className={styles.metricLabel}>{title}</div>
		</a>
	);
}

const Dashboard = () => {
	const { data: hostReport } = useHostReport();
	const { data: currentUser } = useUser("me");
	const navigate = useNavigate();

	const totalRoutes =
		(hostReport?.proxy || 0) +
		(hostReport?.redirection || 0) +
		(hostReport?.stream || 0) +
		(hostReport?.dead || 0);

	return (
		<div className={styles.dashboard}>
			<section className={styles.hero}>
				<div className={styles.heroGlow} />
				<div className={styles.heroContent}>
					<div className={styles.eyebrow}>
						<span className={styles.liveDot} />
						NPM Improved Control Center
					</div>
					<h1>
						Good to see you{currentUser?.nickname ? `, ${currentUser.nickname}` : ""}.
					</h1>
					<p>
						Manage the routing fabric, TLS, access policy, and high-availability paths from one
						control plane.
					</p>
					<div className={styles.heroActions}>
						<button
							type="button"
							className="btn btn-primary"
							onClick={() => navigate("/nginx/proxy")}
						>
							<IconRoute size={18} />
							Open Proxy Hosts
						</button>
						<button
							type="button"
							className="btn btn-outline-secondary"
							onClick={() => navigate("/system-health")}
						>
							<IconShieldCheck size={18} />
							System Health
						</button>
					</div>
				</div>
				<div className={styles.heroGraphic} aria-hidden="true">
					<div className={styles.orbitOuter} />
					<div className={styles.orbitInner} />
					<div className={styles.nodeCenter}>
						<IconNetwork size={34} stroke={1.5} />
					</div>
					<span className={`${styles.node} ${styles.nodeOne}`} />
					<span className={`${styles.node} ${styles.nodeTwo}`} />
					<span className={`${styles.node} ${styles.nodeThree}`} />
				</div>
			</section>

			<section className={styles.metricsGrid}>
				<HasPermission section={PROXY_HOSTS} permission={VIEW} hideError>
					<MetricCard
						title={<T id="proxy-hosts" />}
						value={hostReport?.proxy}
						icon={<IconBolt size={21} />}
						to="/nginx/proxy"
						accent="blue"
					/>
				</HasPermission>
				<HasPermission section={REDIRECTION_HOSTS} permission={VIEW} hideError>
					<MetricCard
						title={<T id="redirection-hosts" />}
						value={hostReport?.redirection}
						icon={<IconArrowsCross size={21} />}
						to="/nginx/redirection"
						accent="cyan"
					/>
				</HasPermission>
				<HasPermission section={STREAMS} permission={VIEW} hideError>
					<MetricCard
						title={<T id="streams" />}
						value={hostReport?.stream}
						icon={<IconDisc size={21} />}
						to="/nginx/stream"
						accent="violet"
					/>
				</HasPermission>
				<HasPermission section={DEAD_HOSTS} permission={VIEW} hideError>
					<MetricCard
						title={<T id="dead-hosts" />}
						value={hostReport?.dead}
						icon={<IconBoltOff size={21} />}
						to="/nginx/404"
						accent="red"
					/>
				</HasPermission>
			</section>

			<section className={styles.lowerGrid}>
				<div className={styles.summaryCard}>
					<div className={styles.sectionHeader}>
						<div>
							<div className={styles.sectionEyebrow}>Routing fabric</div>
							<h2>Control plane summary</h2>
						</div>
						<span className={styles.totalBadge}>{totalRoutes} configured routes</span>
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
							<span>Controlled 404 hosts</span>
							<strong>{hostReport?.dead || 0}</strong>
						</div>
					</div>
				</div>

				<div className={styles.haCard}>
					<div className={styles.haIcon}>
						<IconNetwork size={26} />
					</div>
					<div>
						<div className={styles.sectionEyebrow}>High availability</div>
						<h2>Build for failure, not hope.</h2>
						<p>
							Use upstream pools for backend redundancy and Instance Synchronization for redundant
							NPMi control-plane nodes.
						</p>
					</div>
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
							onClick={() => navigate("/settings")}
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
