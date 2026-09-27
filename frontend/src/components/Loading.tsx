import type { ReactNode } from "react";
import { T } from "src/locale";
import styles from "./Loading.module.css";

interface Props {
	label?: string | ReactNode;
	noLogo?: boolean;
}
export function Loading({ label, noLogo }: Props) {
	return (
		<div className="empty text-center">
			{noLogo ? null : (
				<div className={styles.brandLoader} aria-hidden="true">
					<div className={styles.logoFrame}>
						<img
							className={styles.logo}
							src="/images/npm-improved-mark.webp"
							alt=""
						/>
					</div>
					<div className={styles.pulseRing} />
				</div>
			)}
			<div className="text-secondary mb-3">{label || <T id="loading" />}</div>
			<div className="progress progress-sm">
				<div className="progress-bar progress-bar-indeterminate" />
			</div>
		</div>
	);
}
