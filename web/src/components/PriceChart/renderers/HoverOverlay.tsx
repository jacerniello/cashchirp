import { memo } from 'react';
import type { CorporateAction } from '../../../hooks/usePrices';
import { Tooltip } from '../components/Tooltip';

interface ChartPoint {
  x: number;
  y: number;
  date: string;
  close?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
}

interface AdditionalLinePoint {
  ticker: string;
  x: number;
  y: number;
  color: string;
}

interface OverlayLinePoint {
  label: string;
  x: number;
  y: number;
  color: string;
  value: number;
}

interface HoverOverlayProps {
  hoveredPoint: ChartPoint | null;
  padding: { top: number; right: number; bottom: number; left: number };
  chartWidth: number;
  priceChartHeight: number;
  cursorMode: 'crosshair' | 'dot';

  // Corporate action at hovered point
  corporateAction?: CorporateAction;

  // Additional line points at hover position
  additionalLinePoints?: AdditionalLinePoint[];

  // Overlay line points at hover position
  overlayLinePoints?: OverlayLinePoint[];

  // Tooltip pinning
  pinnedTooltip?: boolean;
}

export const HoverOverlay = memo(function HoverOverlay({
  hoveredPoint,
  padding,
  chartWidth,
  priceChartHeight,
  cursorMode,
  corporateAction,
  additionalLinePoints = [],
  overlayLinePoints = [],
  pinnedTooltip = false,
}: HoverOverlayProps) {
  if (!hoveredPoint) return null;

  return (
    <g className="hover-overlay pointer-events-none">
      {/* Crosshair lines */}
      {cursorMode === 'crosshair' && (
        <>
          <line
            x1={hoveredPoint.x}
            y1={padding.top}
            x2={hoveredPoint.x}
            y2={padding.top + priceChartHeight}
            stroke="var(--color-ink-light)"
            strokeDasharray="4 4"
            strokeOpacity={0.5}
          />
          <line
            x1={padding.left}
            y1={hoveredPoint.y}
            x2={padding.left + chartWidth}
            y2={hoveredPoint.y}
            stroke="var(--color-ink-light)"
            strokeDasharray="4 4"
            strokeOpacity={0.5}
          />
        </>
      )}

      {/* Primary line dot - only in dot mode */}
      {cursorMode === 'dot' && (
        <circle
          cx={hoveredPoint.x}
          cy={hoveredPoint.y}
          r={6}
          fill="#3b82f6"
          stroke="white"
          strokeWidth={2}
          filter="url(#dot-shadow-hover)"
        />
      )}

      {/* Additional line dots - only in dot mode */}
      {cursorMode === 'dot' &&
        additionalLinePoints.map((point) => (
          <circle
            key={`hover-${point.ticker}`}
            cx={point.x}
            cy={point.y}
            r={6}
            fill={point.color}
            stroke="white"
            strokeWidth={2}
            filter="url(#dot-shadow-hover)"
          />
        ))}

      {/* Overlay line dots - only in dot mode */}
      {cursorMode === 'dot' &&
        overlayLinePoints.map((point) => (
          <circle
            key={`hover-overlay-${point.label}`}
            cx={point.x}
            cy={point.y}
            r={6}
            fill={point.color}
            stroke="white"
            strokeWidth={2}
            filter="url(#dot-shadow-hover)"
          />
        ))}

      {/* Tooltip - hidden when pinned (values shown in header instead) */}
      {!pinnedTooltip && (
        <Tooltip
          data={hoveredPoint}
          x={hoveredPoint.x}
          y={hoveredPoint.y}
          corporateAction={corporateAction}
          pinned={false}
        />
      )}
    </g>
  );
});
