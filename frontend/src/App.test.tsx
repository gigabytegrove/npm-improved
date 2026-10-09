import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("application query provider", () => {
	it("retains TanStack React Query without mounting developer tools", () => {
		const app = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
		expect(app).toContain("QueryClientProvider");
		expect(app).not.toContain("ReactQueryDevtools");
		expect(app).not.toContain("@tanstack/react-query-devtools");
	});
});
