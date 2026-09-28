import {
	IconCertificate,
	IconDatabase,
	IconDownload,
	IconHistory,
	IconHome,
	IconShieldLock,
	IconTopologyStar3,
} from "@tabler/icons-react";
import type { ElementType } from "react";
import { useSearchParams } from "react-router-dom";
import { useCheckVersion } from "src/hooks";
import CertificateLifecycle from "./CertificateLifecycle";
import Database from "./Database";
import DefaultSite from "./DefaultSite";
import DisasterRecovery from "./DisasterRecovery";
import InstanceSync from "./InstanceSync";
import Protection from "./Protection";
import Update from "./Update";
import styles from "./Layout.module.css";

type SettingsPage =
	| "default-site"
	| "certificate-lifecycle"
	| "protection"
	| "database"
	| "instance-sync"
	| "disaster-recovery"
	| "update";

interface SettingsSection {
	id: SettingsPage;
	label: string;
	description: string;
	icon: ElementType;
}

const sections: SettingsSection[] = [
	{
		id: "default-site",
		label: "Default Site",
		description: "Fallback behavior and custom templates",
		icon: IconHome,
	},
	{
		id: "certificate-lifecycle",
		label: "Certificate Lifecycle",
		description: "Retention and unused certificate cleanup",
		icon: IconCertificate,
	},
	{
		id: "protection",
		label: "Protection",
		description: "Managed HTTP and connection limits",
		icon: IconShieldLock,
	},
	{
		id: "database",
		label: "Database & Storage",
		description: "SQLite, MySQL, and shared database mode",
		icon: IconDatabase,
	},
	{
		id: "instance-sync",
		label: "Instance Synchronization",
		description: "NPMX pairing, peers, and failover",
		icon: IconTopologyStar3,
	},
	{
		id: "disaster-recovery",
		label: "Backup & Recovery",
		description: "Encrypted backups and restore controls",
		icon: IconHistory,
	},
	{
		id: "update",
		label: "Update",
		description: "Software updates, rollback, and restart",
		icon: IconDownload,
	},
];

const isSettingsPage = (value: string | null): value is SettingsPage =>
	sections.some((section) => section.id === value);

export default function Layout() {
	const [searchParams, setSearchParams] = useSearchParams();
	const { data: versionData } = useCheckVersion();
	const requestedPage = searchParams.get("section");
	const page: SettingsPage = isSettingsPage(requestedPage) ? requestedPage : "default-site";
	const activeSection = sections.find((section) => section.id === page) || sections[0];

	const selectPage = (nextPage: SettingsPage) => {
		const next = new URLSearchParams(searchParams);
		next.set("section", nextPage);
		setSearchParams(next);
	};

	const renderPage = () => {
		switch (page) {
			case "certificate-lifecycle":
				return <CertificateLifecycle />;
			case "protection":
				return <Protection />;
			case "database":
				return <Database />;
			case "instance-sync":
				return <InstanceSync />;
			case "disaster-recovery":
				return <DisasterRecovery />;
			case "update":
				return <Update />;
			default:
				return <DefaultSite />;
		}
	};

	return (
		<section className={`card ${styles.shell}`}>
			<header className={styles.header}>
				<div>
					<div className={styles.eyebrow}>Control Center</div>
					<h2 className={styles.title}>Settings</h2>
					<p className={styles.subtitle}>
						Configure traffic behavior, security, storage, clustering, recovery, and software updates.
					</p>
				</div>
				<div className={styles.activeContext}>
					<activeSection.icon size={18} stroke={1.8} />
					<span>{activeSection.label}</span>
				</div>
			</header>

			<div className={styles.mobilePicker}>
				<label className="form-label" htmlFor="settings-section">
					Settings section
				</label>
				<select
					id="settings-section"
					className="form-select"
					value={page}
					onChange={(event) => selectPage(event.target.value as SettingsPage)}
				>
					{sections.map((section) => (
						<option key={section.id} value={section.id}>
							{section.label}
							{section.id === "update" && versionData?.updateAvailable ? " — Update available" : ""}
						</option>
					))}
				</select>
				<div className={styles.mobileDescription}>{activeSection.description}</div>
			</div>

			<div className={styles.layout}>
				<aside className={styles.sidebar}>
					<nav className={styles.navigation} aria-label="Settings sections">
						{sections.map((section) => {
							const Icon = section.icon;
							const active = page === section.id;
							const hasUpdate = section.id === "update" && versionData?.updateAvailable;
							return (
								<button
									key={section.id}
									type="button"
									className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}
									aria-current={active ? "page" : undefined}
									onClick={() => selectPage(section.id)}
								>
									<span className={styles.navIcon}>
										<Icon size={19} stroke={1.8} />
									</span>
									<span className={styles.navCopy}>
										<span className={styles.navLabelRow}>
											<span className={styles.navLabel}>{section.label}</span>
											{hasUpdate ? <span className={styles.updateBadge}>New</span> : null}
										</span>
										<span className={styles.navDescription}>{section.description}</span>
									</span>
								</button>
							);
						})}
					</nav>
				</aside>

				<main className={styles.content} aria-label={`${activeSection.label} settings`}>
					{renderPage()}
				</main>
			</div>
		</section>
	);
}
