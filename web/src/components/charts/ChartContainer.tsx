import type { ReactNode } from 'react';
import { cardStyles } from '../../lib/styles';
import { ExportButton } from './ExportButton';

interface ChartContainerProps {
  title?: string;
  subtitle?: string;
  height?: 'sm' | 'md' | 'lg' | 'xl';
  children: ReactNode;
  className?: string;
  /** If true, renders without the card wrapper (just the chart area) */
  bare?: boolean;
  /** Content to render after the chart area but inside the card */
  footer?: ReactNode;
  /** Export callback - when provided, shows export button */
  onExport?: () => Promise<void>;
}

const HEIGHT_CLASSES = {
  sm: 'h-48',
  md: 'h-56',
  lg: 'h-64',
  xl: 'h-96',
} as const;

/**
 * Consistent container for chart components
 * Handles common layout, styling, and title rendering
 */
export function ChartContainer({
  title,
  subtitle,
  height = 'md',
  children,
  className = '',
  bare = false,
  footer,
  onExport,
}: ChartContainerProps) {
  const chartArea = (
    <div className={`${HEIGHT_CLASSES[height]} ${className}`}>
      {children}
    </div>
  );

  if (bare) {
    return chartArea;
  }

  return (
    <div className={cardStyles.compact}>
      {(title || onExport) && (
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {title && <h3 className="text-lg font-semibold text-ink">{title}</h3>}
            {subtitle && (
              <p className="text-sm text-ink-faint mt-0.5">{subtitle}</p>
            )}
          </div>
          {onExport && <ExportButton onExport={onExport} />}
        </div>
      )}
      {chartArea}
      {footer}
    </div>
  );
}
