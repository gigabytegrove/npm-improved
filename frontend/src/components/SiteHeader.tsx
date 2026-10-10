import {
	IconActivityHeartbeat,
	IconArrowsExchange,
	IconServer2,
	IconChevronDown,
	IconLock,
	IconLogout,
	IconMenu2,
	IconShieldLock,
	IconUser,
} from "@tabler/icons-react";
import { useLocation } from "react-router-dom";
import { LocalePicker, ThemeSwitcher } from "src/components";
import { useAuthState } from "src/context";
import { useHealth, useUser } from "src/hooks";
import { useBackendNode } from "src/modules/BackendNode";
import { T } from "src/locale";
import { showChangePasswordModal, showTwoFactorModal, showUserModal } from "src/modals";
import styles from "./SiteHeader.module.css";

const routeTitles: Array<[RegExp, string, string]> = [
	[/^\/$/, "Dashboard", "Overview"],
	[/^\/analytics(?:\/|$)/, "Analytics Center", "Local-node traffic and enforcement"],
	[/^\/nginx\/proxy/, "Proxy Hosts", "HTTP and HTTPS routing"],
	[/^\/nginx\/redirection/, "Redirection Hosts", "Redirect rules"],
	[/^\/nginx\/stream/, "Streams", "TCP and UDP forwarding"],
	[/^\/nginx\/404/, "404 Hosts", "Unmatched host responses"],
	[/^\/access/, "Access Lists", "Authentication and access rules"],
	[/^\/certificates/, "Certificates", "TLS certificates"],
	[/^\/users/, "Users", "Accounts and permissions"],
	[/^\/audit-log/, "Audit Log", "Administrative activity"],
	[/^\/config-history/, "Configuration History", "Saved configuration revisions"],
	[/^\/logs/, "Logs", "Traffic and error logs"],
	[/^\/system-health/, "System Health", "Runtime status"],
	[/^\/settings/, "Settings", "Application settings"],
];

const settingsSectionSubtitles: Record<string, string> = {
	"default-site": "Fallback page and templates",
	"certificate-lifecycle": "Retention and cleanup",
	protection: "HTTP and connection limits",
	database: "Database and storage",
	"instance-sync": "NPMX synchronization",
	"disaster-recovery": "Backup and restore",
	update: "Updates and restart",
};

const resolveTitle = (pathname: string, search = "") => {
	if (pathname.startsWith("/settings")) {
		const section = new URLSearchParams(search).get("section") || "default-site";
		return [
			"",
			"Settings",
			settingsSectionSubtitles[section] || "Application settings",
		];
	}
	return routeTitles.find(([pattern]) => pattern.test(pathname)) || ["", "NPM Improved", "Administration"];
};

export function SiteHeader() {
	const { data: currentUser } = useUser("me");
	const health = useHealth();
	const node = useBackendNode();
	const location = useLocation();
	const isAdmin = currentUser?.roles.includes("admin");
	const { logout } = useAuthState();
	const [, title, subtitle] = resolveTitle(location.pathname, location.search);
	const version = health.data?.version?.display || "";
	const logicalNodeName = health.data?.node?.name || null;
	const physicalHostname = node.hostname;
	const displayNode = physicalHostname || logicalNodeName || "Unidentified";

	return (
		<header className={`${styles.header} npm-improved-header`}>
			<div className={styles.left}>
				<button
					className={styles.menuButton}
					type="button"
					data-bs-toggle="collapse"
					data-bs-target="#navbar-menu"
					aria-controls="navbar-menu"
					aria-expanded="false"
					aria-label="Toggle navigation"
					data-npmi-menu-toggle
				>
					<IconMenu2 size={22} />
				</button>
				<div className={styles.pageIdentity}>
					<div className={styles.pageTitle}>{title}</div>
					<div className={styles.pageSubtitle}>{subtitle}</div>
				</div>
			</div>

			<div className={styles.actions}>
				<div
					className={styles.nodePill}
					role="status"
					aria-live="polite"
					title={physicalHostname
						? node.switched
							? `API backend changed from ${node.previousHostname} to ${physicalHostname}. A shared hostname may distribute requests to different nodes.`
							: "Physical Linux hostname of the most recent identified NPM Improved API responder."
						: logicalNodeName
							? "NPMX configured node name from the latest health response. Physical Linux hostname is unavailable until the native host updater or host-name mount is installed."
							: "Physical Linux hostname and NPMX node name are not available. Check host updater identity provisioning."}
				>
					<IconServer2 size={16} aria-hidden="true" />
					<span className={styles.nodeLabel}>{physicalHostname ? "Host:" : logicalNodeName ? "NPMX:" : "Node:"}</span>
					<strong className={styles.nodeHostname}>{displayNode}</strong>
					{node.switched ? <IconArrowsExchange size={15} className={styles.nodeSwitched} aria-label="Node changed" /> : null}
				</div>
				<div className={styles.statusPill} title="NPM Improved control plane is responding">
					<span className={styles.statusIcon}>
						<IconActivityHeartbeat size={15} />
					</span>
					<span className={styles.statusText}>Online</span>
					{version ? <span className={styles.version}>{version}</span> : null}
				</div>

				<div className={styles.desktopTools}>
					<LocalePicker />
					<ThemeSwitcher />
				</div>

				<div className="dropdown">
					<button
						type="button"
						className={styles.userButton}
						data-bs-toggle="dropdown"
						aria-expanded="false"
						aria-label="Open user menu"
					>
						<span
							className={`${styles.avatar} avatar avatar-sm`}
							style={{
								backgroundImage: `url(${currentUser?.avatar || "/images/default-avatar.jpg"})`,
							}}
						/>
						<span className={styles.userText}>
							<strong>{currentUser?.nickname || "User"}</strong>
							<small>
								<T id={isAdmin ? "role.admin" : "role.standard-user"} />
							</small>
						</span>
						<IconChevronDown size={15} className={styles.chevron} />
					</button>
					<div className={`${styles.userMenu} dropdown-menu dropdown-menu-end`}>
						<div className={styles.mobileTools}>
							<ThemeSwitcher />
							<LocalePicker menuAlign="end" />
						</div>
						<a
							href="?"
							className="dropdown-item"
							onClick={(event) => {
								event.preventDefault();
								showUserModal("me");
							}}
						>
							<IconUser width={18} />
							<T id="user.edit-profile" />
						</a>
						<a
							href="?"
							className="dropdown-item"
							onClick={(event) => {
								event.preventDefault();
								showChangePasswordModal("me");
							}}
						>
							<IconLock width={18} />
							<T id="user.change-password" />
						</a>
						<a
							href="?"
							className="dropdown-item"
							onClick={(event) => {
								event.preventDefault();
								showTwoFactorModal("me");
							}}
						>
							<IconShieldLock width={18} />
							<T id="user.two-factor" />
						</a>
						<div className="dropdown-divider" />
						<a
							href="?"
							className="dropdown-item text-danger"
							onClick={(event) => {
								event.preventDefault();
								logout();
							}}
						>
							<IconLogout width={18} />
							<T id="user.logout" />
						</a>
					</div>
				</div>
			</div>
		</header>
	);
}
