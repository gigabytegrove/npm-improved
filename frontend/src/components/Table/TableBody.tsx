import { flexRender, type RowData } from "@tanstack/react-table";
import type { TableLayoutProps } from "src/components";
import { EmptyRow } from "./EmptyRow";

function TableBody<T extends RowData>(props: TableLayoutProps<T>) {
	const { tableInstance, extraStyles, emptyState } = props;
	const rows = tableInstance.getRowModel().rows;

	if (rows.length === 0) {
		return (
			<tbody className="table-tbody">
				{emptyState ? emptyState : <EmptyRow tableInstance={tableInstance} />}
			</tbody>
		);
	}

	return (
		<tbody className="table-tbody">
			{rows.map((row: any) => {
				return (
					<tr key={row.id} {...extraStyles?.row(row.original)}>
						{row.getVisibleCells().map((cell: any) => {
							const { className } = (cell.column.columnDef.meta as any) ?? {};
							const header = cell.column.columnDef.header;
							const label = typeof header === "string" && header.trim()
								? header
								: cell.column.id === "id" || cell.column.id === "actions"
									? "Actions"
									: cell.column.id.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ");
							return (
								<td key={cell.id} className={className} data-label={label}>
									{flexRender(cell.column.columnDef.cell, cell.getContext())}
								</td>
							);
						})}
					</tr>
				);
			})}
		</tbody>
	);
}

export { TableBody };
