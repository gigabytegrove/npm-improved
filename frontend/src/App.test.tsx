import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("application query provider", () => {
	it("retains TanStack React Query without mounting developer tools", () => {
		const app = readFileSync(fileURLToPath(new URL("./App.tsx", import.meta.url)), "utf8");
		expect(app).toContain("QueryClientProvider");
		expect(app).not.toContain("ReactQueryDevtools");
		expect(app).not.toContain("@tanstack/react-query-devtools");
	});
});
