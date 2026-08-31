'use client';

import { forwardRef, type ReactNode } from 'react';
import { tableStyles, linkStyles, cn } from '../lib/styles';

interface TableProps {
  children: ReactNode;
}

export function Table({ children }: TableProps) {
  return (
    // No negative-margin bleed: it made `sticky left-0` pin to the padded edge, so
    // horizontally-scrolled cells peeked out to the left of the sticky label column.
    <div className={tableStyles.container}>
      <table className="w-full border-collapse">{children}</table>
    </div>
  );
}

interface TableHeaderProps {
  columns: string[];
  stickyFirstColumn?: boolean;
  highlightedIndex?: number | null;
  onHeaderClick?: (index: number) => void;
  /** Optional actions to render next to each column header (indexed by data column, not including first label column) */
  headerActions?: (ReactNode | null)[];
}

export function TableHeader({ columns, stickyFirstColumn, highlightedIndex, onHeaderClick, headerActions }: TableHeaderProps) {
  return (
    <thead>
      <tr>
        {columns.map((col, i) => {
          // Adjust index for data columns (first column is "Metric" label)
          const dataIndex = i - 1;
          const isHighlighted = highlightedIndex != null && dataIndex === highlightedIndex;
          const isClickable = i > 0 && onHeaderClick;
          const action = i > 0 && headerActions ? headerActions[dataIndex] : null;
          return (
            <th
              key={`${col}-${i}`}
              onClick={isClickable ? () => onHeaderClick(dataIndex) : undefined}
              className={cn(
                'text-xs font-bold uppercase text-ink-light bg-surface-warm px-2 py-2 md:px-4 text-left',
                'border-b border-rule',
                i === 0 && 'rounded-tl-lg',
                i === columns.length - 1 && 'rounded-tr-lg',
                i === 0 && stickyFirstColumn && 'sticky left-0 z-10 bg-white',
                isHighlighted && 'bg-blue-100 text-blue-800',
                isClickable && 'cursor-pointer hover:bg-gray-100'
              )}
            >
              <div className="flex items-center justify-between gap-1">
                <span>{col}</span>
                {action}
              </div>
            </th>
          );
        })}
      </tr>
    </thead>
  );
}

export interface TableRowProps {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}

export function TableRow({ children, onClick, className = '' }: TableRowProps) {
  return (
    <tr className={cn(tableStyles.row, className)} onClick={onClick}>
      {children}
    </tr>
  );
}

interface TableCellProps {
  children: ReactNode;
  muted?: boolean;
  align?: 'left' | 'center' | 'right';
  sticky?: boolean;
  className?: string;
}

export const TableCell = forwardRef<HTMLTableCellElement, TableCellProps>(
  function TableCell({ children, muted, align = 'left', sticky, className }, ref) {
    return (
      <td
        ref={ref}
        className={cn(
          'px-2 py-2 md:px-4 md:py-2.5 text-xs md:text-[13px] border-b border-rule-light',
          muted ? 'text-ink-faint' : 'text-ink-mid',
          align === 'right' && 'text-right tabular-nums',
          align === 'center' && 'text-center',
          // Opaque background + higher z so scrolled cells never show through the label.
          sticky && 'sticky left-0 z-20 bg-white',
          className
        )}
      >
        {children}
      </td>
    );
  }
);

interface TableLinkProps {
  href: string;
  children: ReactNode;
}

export function TableLink({ href, children }: TableLinkProps) {
  return (
    <a href={href} className={cn(linkStyles.base, 'font-semibold text-ink')}>
      {children}
    </a>
  );
}
