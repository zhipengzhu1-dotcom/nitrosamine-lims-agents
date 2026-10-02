/* oxlint-disable jsx-a11y/no-redundant-roles, jsx-a11y/no-interactive-element-to-noninteractive-role -- Safari drops a table's semantics once a phone stacks it with display: block, so the stacked table states its roles. */
import type { Key, ReactNode } from 'react';

export interface Column<T> {
  head: string;
  /** The shorter name a phone prints beside the value once the table stacks; the head when absent. */
  label?: string;
  cell: (row: T) => ReactNode;
}

/** A table that stacks each row into labelled lines on a phone and keeps its table, row and cell roles for screen readers. */
export function StackTable<T>({
  columns,
  rows,
  rowKey,
  rowClass,
}: {
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => Key;
  rowClass?: (row: T) => string | undefined;
}) {
  return (
    <table className="stack" role="table">
      <thead role="rowgroup">
        <tr role="row">
          {columns.map((c) => (
            <th key={c.head} role="columnheader">
              {c.head}
            </th>
          ))}
        </tr>
      </thead>
      <tbody role="rowgroup">
        {rows.map((row) => (
          <tr key={rowKey(row)} role="row" className={rowClass?.(row)}>
            {columns.map((c) => (
              <td key={c.head} role="cell" data-label={c.label ?? c.head}>
                {c.cell(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
