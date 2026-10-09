import {
	IconActivityHeartbeat,
	IconBook2,
	IconCertificate,
	IconFileAnalytics,
	IconHistory,
	IconHome,
	IconLock,
	IconRoute,
	IconServer2,
	IconSettings,
	IconShieldLock,
	IconUsers,
} from "@tabler/icons-react";
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { HasPermission } from "src/components";
import { T } from "src/locale";
import {
	ACCESS_LISTS,
	ADMIN,
	CERTIFICATES,
	DEAD_HOSTS,
	type MANAGE,
	PROXY_HOSTS,
	REDIRECTION_HOSTS,
	type Section,
	STREAMS,
	VIEW,
} from "src/modules/Permissions";
import styles from "./SiteMenu.module.css";

interface MenuItem {
	label: string;
	literalLabel?: string;
	icon?: React.ElementType;
	to: string;
	permissionSection?: Section | typeof ADMIN;
	permission?: typeof VIEW | typeof MANAGE;
}

const routingItems: MenuItem[] = [
	{
		to: "/nginx/proxy",
		icon: IconRoute,
		label: "proxy-hosts",
		permissionSection: PROXY_HOSTS,
		permission: VIEW,
	},
	{
		to: "/nginx/redirection",
		icon: IconRoute,
		label: "redirection-hosts",
		permissionSection: REDIRECTION_HOSTS,
		permission: VIEW,
	},
	{
		to: "/nginx/stream",
		icon: IconServer2,
		label: "streams",
		permissionSection: STREAMS,
		permission: VIEW,
	},
	{
		to: "/nginx/404",
		icon: IconShieldLock,
		label: "dead-hosts",
		permissionSection: DEAD_HOSTS,
		permission: VIEW,
	},
];

const controlItems: MenuItem[] = [
	{
		to: "/access",
		icon: IconLock,
		label: "access-lists",
		permissionSection: ACCESS_LISTS,
		permission: VIEW,
	},
	{
		to: "/certificates",
		icon: IconCertificate,
		label: "certificates",
		permissionSection: CERTIFICATES,
		permission: VIEW,
	},
	{
		to: "/users",
		icon: IconUsers,
		label: "users",
		permissionSection: ADMIN,
	},
];

const observabilityItems: MenuItem[] = [
	{
		to: "/analytics",
		icon: IconFileAnalytics,
		label: "analytics-center",
		literalLabel: "Analytics Center",
		permissionSection: ADMIN,
	},
	{
		to: "/audit-log",
		icon: IconBook2,
		label: "auditlogs",
		permissionSection: ADMIN,
	},
	{
		to: "/config-history",
		icon: IconHistory,
		label: "config-history",
		permissionSection: ADMIN,
	},
	{
		to: "/logs",
		icon: IconFileAnalytics,
		label: "logs",
		permissionSection: ADMIN,
	},
	{
		to: "/system-health",
		icon: IconActivityHeartbeat,
		label: "system-health",
		permissionSection: ADMIN,
	},
	{
		to: "/settings",
		icon: IconSettings,
		label: "settings",
		permissionSection: ADMIN,
	},
];

const isActive = (pathname: string, target: string) =>
	target === "/" ? pathname === "/" : pathname === target || pathname.startsWith(`${target}/`);

function MenuLink({ item, onNavigate }: { item: MenuItem; onNavigate: () => void }) {
	const location = useLocation();
	const navigate = useNavigate();
	const Icon = item.icon;
	const active = isActive(location.pathname, item.to);

	return (
		<HasPermission
			section={item.permissionSection}
			permission={item.permission || VIEW}
			hideError
		>
			<a
				href={item.to}
				className={`${styles.item} ${active ? styles.active : ""}`}
				aria-current={active ? "page" : undefined}
				onClick={(event) => {
					event.preventDefault();
					navigate(item.to);
					onNavigate();
				}}
			>
				<span className={styles.itemIcon}>{Icon ? <Icon size={19} stroke={1.8} /> : null}</span>
				<span className={styles.itemLabel}>
					{item.literalLabel || <T id={item.label} />}
				</span>
			</a>
		</HasPermission>
	);
}

function MenuGroup({
	title,
	items,
	onNavigate,
}: {
	title: string;
	items: MenuItem[];
	onNavigate: () => void;
}) {
	return (
		<div className={styles.group}>
			<div className={styles.groupLabel}>{title}</div>
			<div className={styles.groupItems}>
				{items.map((item) => (
					<MenuLink key={item.to} item={item} onNavigate={onNavigate} />
				))}
			</div>
		</div>
	);
}

export function SiteMenu() {
	const navigate = useNavigate();

	const closeMenu = () => {
		const menu = document.querySelector<HTMLElement>("#navbar-menu");
		const toggler = document.querySelector<HTMLElement>("[data-npmi-menu-toggle]");
		if (window.innerWidth < 768 && menu?.classList.contains("show")) {
			toggler?.click();
		}
	};

	return (
		<aside id="navbar-menu" className={`${styles.sidebar} collapse d-md-flex`}>
			<div className={styles.inner}>
				<a
					href="/"
					className={styles.brand}
					onClick={(event) => {
						event.preventDefault();
						navigate("/");
						closeMenu();
					}}
				>
					<img
						src="/images/npm-improved-logo.webp"
						alt="Nginx Proxy Manager Improved"
						className={styles.brandLogo}
					/>
				</a>

				<nav className={styles.navigation} aria-label="Primary navigation">
					<div className={styles.group}>
						<div className={styles.groupItems}>
							<MenuLink
								item={{ to: "/", icon: IconHome, label: "dashboard" }}
								onNavigate={closeMenu}
							/>
						</div>
					</div>
					<MenuGroup title="Routing" items={routingItems} onNavigate={closeMenu} />
					<MenuGroup title="Control" items={controlItems} onNavigate={closeMenu} />
					<MenuGroup title="System" items={observabilityItems} onNavigate={closeMenu} />
				</nav>

				<div className={styles.footer}>
					<div className={styles.footerLabel}>NPM Improved</div>
				</div>
			</div>
		</aside>
	);
}
