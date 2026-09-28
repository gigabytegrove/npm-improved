import { Link } from "react-router-dom";
import { useCheckVersion, useHealth } from "src/hooks";
import { T } from "src/locale";

const repositoryUrl = "https://github.com/gigabytegrove/npm-improved";

export function SiteFooter() {
	const health = useHealth();
	const { data: versionData } = useCheckVersion();

	const getVersion = () => {
		if (!health.data) {
			return "";
		}
		const v = health.data.version;
		return v.display || `v${v.major}.${v.minor}.${v.revision}`;
	};

	return (
		<footer className="npm-improved-footer">
			<div className="npmi-footer-inner">
				<div className="npmi-footer-brand">
					<span className="npmi-footer-dot" />
					<span>NPM Improved {getVersion()}</span>
					<span className="npmi-footer-separator">·</span>
					<span>Gigabyte Grove</span>
				</div>
				<div className="npmi-footer-links">
					<a href={repositoryUrl} target="_blank" rel="noopener noreferrer">
						<T id="footer.github-fork" />
					</a>
					<a href={`${repositoryUrl}/releases`} target="_blank" rel="noopener noreferrer">
						Release history
					</a>
					{versionData?.updateAvailable && versionData?.latest ? (
						<Link
							to="/settings?section=update"
							className="npmi-footer-update"
							title={`Install NPM Improved ${versionData.latest}`}
						>
							<T id="update-available" data={{ latestVersion: versionData.latest }} />
						</Link>
					) : null}
				</div>
			</div>
		</footer>
	);
}
