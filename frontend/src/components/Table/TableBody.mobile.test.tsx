import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TableBody } from "./TableBody";

describe("mobile table cells", () => {
	it("exposes visible labels and action access on small screens", () => {
		const cells = [
			{
				id: "domain",
				column: { id: "domainNames", columnDef: { header: "Source", cell: () => "example.test" } },
				getContext: () => ({}),
			},
			{
				id: "menu",
				column: { id: "id", columnDef: { cell: () => "Menu" } },
				getContext: () => ({}),
			},
		];
		const tableInstance = {
			getRowModel: () => ({ rows: [{ id: "host-1", original: {}, getVisibleCells: () => cells }] }),
		};
		const markup = renderToStaticMarkup(
			<table>
				<TableBody tableInstance={tableInstance as any} />
			</table>,
		);
		expect(markup).toContain('data-label="Source"');
		expect(markup).toContain('data-label="Actions"');
		expect(markup).toContain("example.test");
		expect(markup).toContain("Menu");
	});
});
