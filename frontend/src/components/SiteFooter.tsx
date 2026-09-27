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
		<footer className="footer d-print-none py-3 npm-improved-footer">
			<div className="container-xl">
				<div className="row text-center align-items-center flex-row-reverse">
					<div className="col-lg-auto ms-lg-auto">
						<ul className="list-inline list-inline-dots mb-0">
							<li className="list-inline-item">
								<a
									href={repositoryUrl}
									target="_blank"
									className="link-secondary"
									rel="noopener noreferrer"
								>
									<T id="footer.github-fork" />
								</a>
							</li>
							<li className="list-inline-item">
								<a
									href={`${repositoryUrl}/releases`}
									target="_blank"
									className="link-secondary"
									rel="noopener noreferrer"
								>
									Release history
								</a>
							</li>
						</ul>
					</div>
					<div className="col-12 col-lg-auto mt-3 mt-lg-0">
						<ul className="list-inline list-inline-dots mb-0">
							<li className="list-inline-item">© 2026 Gigabyte Grove</li>
							<li className="list-inline-item">
								<a
									href={`${repositoryUrl}/releases`}
									className="link-secondary"
									target="_blank"
									rel="noopener noreferrer"
								>
									NPM Improved {getVersion()}
								</a>
							</li>
							{versionData?.updateAvailable && versionData?.latest && (
								<li className="list-inline-item">
									<a
										href={`${repositoryUrl}/releases/tag/${versionData.latest}`}
										className="link-warning fw-bold"
										target="_blank"
										rel="noopener noreferrer"
										title={`NPM Improved ${versionData.latest} is available`}
									>
										<T id="update-available" data={{ latestVersion: versionData.latest }} />
									</a>
								</li>
							)}
						</ul>
					</div>
				</div>
			</div>
		</footer>
	);
}
