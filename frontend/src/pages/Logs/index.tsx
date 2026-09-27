import { useState } from "react";
import { HasPermission } from "src/components";
import { ADMIN, VIEW } from "src/modules/Permissions";
import LogViewer from "./LogViewer";
import SecurityOverview from "./SecurityOverview";

type LogWorkspace = "security" | "raw";

const Logs = () => {
	const [workspace, setWorkspace] = useState<LogWorkspace>("security");

	return (
		<HasPermission section={ADMIN} permission={VIEW} pageLoading loadingNoLogo>
			<div className="mt-4">
				<div className="btn-group" role="group" aria-label="Log workspace">
					<button
						type="button"
						className={"btn " + (workspace === "security" ? "btn-primary" : "btn-outline-secondary")}
						onClick={() => setWorkspace("security")}
					>
						Security Events
					</button>
					<button
						type="button"
						className={"btn " + (workspace === "raw" ? "btn-primary" : "btn-outline-secondary")}
						onClick={() => setWorkspace("raw")}
					>
						Raw Logs
					</button>
				</div>
			</div>
			{workspace === "security" ? <SecurityOverview /> : <LogViewer />}
		</HasPermission>
	);
};

export default Logs;
