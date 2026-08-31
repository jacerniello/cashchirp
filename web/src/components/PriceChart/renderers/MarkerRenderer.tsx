'use client';

import { useMemo, memo, useState, useCallback } from 'react';
import type { CorporateAction } from '../../../hooks/usePrices';

export interface InsiderMarker {
  date: string;
  accessionNumbers: string[];
  type: 'acquire' | 'dispose' | 'mixed';
  filingCount: number;
  buyShares: number;
  sellShares: number;
}

export interface FilingMarker {
  date: string;
  formType: string;
  accessionNumber: string;
  /** Period label to show in tooltip (e.g., "2021-Q2", "2023") */
  periodLabel?: string;
  /** Primary document filename for direct filing viewer link */
  primaryDocument?: string;
}

interface HoveredInsiderMarker extends InsiderMarker {
  x: number;
  y: number;
}

interface HoveredCorporateAction extends CorporateAction {
  x: number;
  y: number;
}

interface ChartPoint {
  x: number;
  y: number;
  date: string;
}

interface MarkerRendererProps {
  points: ChartPoint[];
  priceChartHeight: number;
  paddingTop: number;

  // Corporate actions
  corporateActions?: CorporateAction[];
  showCorporateActions?: boolean;

  // Insider markers
  insiderMarkers?: InsiderMarker[];
  onInsiderMarkerClick?: (date: string, accessionNumbers: string[]) => void;
  dotScale?: number;
  dotScaleMode?: 'logarithmic' | 'linear';

  // News markers
  newsMarkers?: { date: string; count: number }[];

  // Filing markers (10-K, 10-Q, etc.)
  filingMarkers?: FilingMarker[];
  /** Whether to show filing markers visually. Defaults to true. */
  showFilingMarkers?: boolean;
  onFilingMarkerClick?: (marker: FilingMarker) => void;

  // Hover state - for highlighting nearest marker
  hoveredX?: number | null;

  // Active filing period - when set, only show the filing marker matching this period label (for bar overlays)
  // This matches against FilingMarker.periodLabel (e.g., "2021-Q2"), not the filing date
  activeFilingDate?: string | null;
}

export const MarkerRenderer = memo(function MarkerRenderer({
  points,
  priceChartHeight,
  paddingTop,
  corporateActions = [],
  showCorporateActions = true,
  insiderMarkers = [],
  onInsiderMarkerClick,
  dotScale = 1.0,
  dotScaleMode = 'logarithmic',
  newsMarkers = [],
  filingMarkers = [],
  showFilingMarkers = true,
  onFilingMarkerClick,
  hoveredX = null,
  activeFilingDate = null,
}: MarkerRendererProps) {
  // Hover state for insider markers
  const [hoveredMarker, setHoveredMarker] = useState<HoveredInsiderMarker | null>(null);

  const handleMarkerMouseEnter = useCallback((marker: InsiderMarker, x: number, y: number) => {
    setHoveredMarker({ ...marker, x, y });
  }, []);

  const handleMarkerMouseLeave = useCallback(() => {
    setHoveredMarker(null);
  }, []);

  // Hover state for corporate action markers
  const [hoveredCorporateAction, setHoveredCorporateAction] = useState<HoveredCorporateAction | null>(null);

  const handleCorporateActionMouseEnter = useCallback((action: CorporateAction, x: number, y: number) => {
    setHoveredCorporateAction({ ...action, x, y });
  }, []);

  const handleCorporateActionMouseLeave = useCallback(() => {
    setHoveredCorporateAction(null);
  }, []);

  // Create a map of date -> point for fast lookups
  const pointsMap = useMemo(() => {
    const map = new Map<string, ChartPoint>();
    points.forEach((point) => {
      map.set(point.date, point);
    });
    return map;
  }, [points]);

  const insiderMap = useMemo(() => {
    const map = new Map<string, InsiderMarker[]>();
    insiderMarkers.forEach((marker) => {
      const existing = map.get(marker.date) || [];
      existing.push(marker);
      map.set(marker.date, existing);
    });
    return map;
  }, [insiderMarkers]);

  // Find nearest insider marker date based on hoveredX
  // Only iterate over dates with markers, not all points
  const nearestInsiderDate = useMemo(() => {
    if (hoveredX === null || insiderMarkers.length === 0) return null;

    let nearestDate: string | null = null;
    let nearestDistance = Infinity;

    // Only check dates that have insider markers
    insiderMap.forEach((_, date) => {
      const point = pointsMap.get(date);
      if (point) {
        const distance = Math.abs(point.x - hoveredX);
        // Only highlight if within 50px (reasonable hover distance)
        if (distance < nearestDistance && distance < 50) {
          nearestDistance = distance;
          nearestDate = date;
        }
      }
    });

    return nearestDate;
  }, [hoveredX, insiderMarkers.length, pointsMap, insiderMap]);

  // Calculate scaled dot radius based on total shares
  // More consistent sizing like Django - base 8px, max around 16px
  const getScaledRadius = (totalShares: number): number => {
    const baseRadius = 10;
    const maxRadius = 20;
    if (totalShares <= 0) return baseRadius * dotScale;

    if (dotScaleMode === 'logarithmic') {
      // Gentler log scale for more consistent sizing
      // log10(1000) = 3, log10(1000000) = 6
      const logScale = Math.log10(Math.max(1, totalShares));
      const scaled = baseRadius + Math.min(logScale * 1.2, maxRadius - baseRadius);
      return scaled * dotScale;
    } else {
      const scaled = baseRadius + Math.min(totalShares / 50000, maxRadius - baseRadius);
      return scaled * dotScale;
    }
  };

  // Generate pie chart path for a given percentage
  const getPieSlicePath = (cx: number, cy: number, radius: number, startAngle: number, endAngle: number): string => {
    const start = {
      x: cx + radius * Math.cos(startAngle),
      y: cy + radius * Math.sin(startAngle),
    };
    const end = {
      x: cx + radius * Math.cos(endAngle),
      y: cy + radius * Math.sin(endAngle),
    };
    const largeArcFlag = endAngle - startAngle > Math.PI ? 1 : 0;

    return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y} Z`;
  };

  return (
    <g className="chart-markers">
      {/* Corporate action markers - iterate over actions, not all points */}
      {showCorporateActions &&
        corporateActions.map((action, index) => {
          const point = pointsMap.get(action.date);
          if (!point) return null;

          const label = action.type === 'dividend' ? 'D' : action.type === 'split' ? 'S' : '';
          const isHovered = hoveredCorporateAction?.date === action.date;
          // Increase dot size on hover. action.radius is the API's base (5px); scale
          // it up so the dividend/split event dots are easier to see.
          const baseRadius = action.radius * 1.7;
          const hoverRadius = baseRadius + 3;
          const radius = isHovered ? hoverRadius : baseRadius;

          return (
            <g
              key={`action-${index}`}
              className="cursor-pointer"
              onMouseEnter={() => handleCorporateActionMouseEnter(action, point.x, point.y)}
              onMouseLeave={handleCorporateActionMouseLeave}
            >
              {/* Invisible hit area */}
              <circle
                cx={point.x}
                cy={point.y}
                r={hoverRadius + 6}
                fill="transparent"
              />
              {/* Highlight ring when hovered */}
              {isHovered && (
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={radius + 4}
                  fill="none"
                  stroke="var(--color-ink)"
                  strokeWidth={2}
                  strokeOpacity={0.3}
                  pointerEvents="none"
                />
              )}
              <circle
                cx={point.x}
                cy={point.y}
                r={radius}
                fill={action.color}
                opacity={0.9}
                stroke="white"
                strokeWidth={isHovered ? 2.5 : 2}
                pointerEvents="none"
                filter={isHovered ? 'url(#dot-shadow-hover)' : undefined}
                style={{ transition: 'r 0.15s ease-out' }}
              />
              <text
                x={point.x}
                y={point.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill="white"
                fontSize={radius}
                fontWeight="bold"
                fontFamily="Plus Jakarta Sans, sans-serif"
                className="pointer-events-none"
                style={{ transition: 'font-size 0.15s ease-out' }}
              >
                {label}
              </text>
            </g>
          );
        })}

      {/* News markers - iterate over news markers, not all points */}
      {newsMarkers.length > 0 &&
        newsMarkers.map((marker, index) => {
          const point = pointsMap.get(marker.date);
          if (!point) return null;

          return (
            <g key={`news-${index}`}>
              <circle
                cx={point.x}
                cy={paddingTop + priceChartHeight + 30}
                r={Math.min(11, 4 + marker.count)}
                fill="var(--color-blue)"
                opacity={0.6}
              />
            </g>
          );
        })}

      {/* Filing markers (10-K, 10-Q) - show on price line */}
      {/* Always show all markers, but highlight the active one when hovering over overlay data */}
      {showFilingMarkers && filingMarkers.length > 0 &&
        filingMarkers.map((marker, index) => {
          const point = pointsMap.get(marker.date);
          if (!point) return null;

          // 10-K = annual (darker blue), 10-Q = quarterly (teal)
          const is10K = marker.formType.toUpperCase().includes('10-K');
          const baseColor = is10K ? '#2563eb' : '#0891b2';
          const baseRadius = is10K ? 10 : 8;
          const label = is10K ? 'K' : 'Q';

          // Highlight if this is the active filing (when overlay is hovered)
          const isActive = activeFilingDate === marker.periodLabel;
          // Dim non-active markers when there's an active one
          const isDimmed = activeFilingDate !== null && !isActive;
          const color = isDimmed ? '#9ca3af' : baseColor;
          const radius = isActive ? baseRadius + 2 : baseRadius;

          return (
            <g
              key={`filing-${index}`}
              className={onFilingMarkerClick ? 'cursor-pointer' : 'cursor-default'}
              onClick={(e) => {
                e.stopPropagation();
                onFilingMarkerClick?.(marker);
              }}
            >
              {/* Invisible hit area */}
              <circle
                cx={point.x}
                cy={point.y}
                r={radius + 4}
                fill="transparent"
              />
              {/* Highlight ring when active */}
              {isActive && (
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={radius + 5}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  strokeOpacity={0.4}
                />
              )}
              {/* White background for contrast */}
              <circle
                cx={point.x}
                cy={point.y}
                r={radius + 1}
                fill="white"
                filter={isActive ? 'url(#dot-shadow-hover)' : 'url(#dot-shadow)'}
                opacity={isDimmed ? 0.5 : 1}
              />
              {/* Colored circle */}
              <circle
                cx={point.x}
                cy={point.y}
                r={radius}
                fill={color}
                opacity={isDimmed ? 0.5 : 1}
              />
              {/* Label */}
              <text
                x={point.x}
                y={point.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill="white"
                fontSize={radius * 0.9}
                fontWeight="bold"
                fontFamily="Plus Jakarta Sans, sans-serif"
                className="pointer-events-none"
                opacity={isDimmed ? 0.5 : 1}
              >
                {label}
              </text>
              <title>{`${marker.formType}${marker.periodLabel ? ` (${marker.periodLabel})` : ''} - ${marker.date}`}</title>
            </g>
          );
        })}

      {/* Insider transaction markers - iterate over unique dates with markers */}
      {insiderMarkers.length > 0 &&
        Array.from(insiderMap.entries()).map(([date, dateMarkers], index) => {
          const point = pointsMap.get(date);
          if (!point) return null;

          // Aggregate buy/sell shares across all markers for this date
          const totalBuyShares = dateMarkers.reduce((sum, m) => sum + m.buyShares, 0);
          const totalSellShares = dateMarkers.reduce((sum, m) => sum + m.sellShares, 0);
          const totalShares = totalBuyShares + totalSellShares;
          const allAccessionNumbers = dateMarkers.flatMap((m) => m.accessionNumbers);

          const radius = getScaledRadius(totalShares);
          const isNearest = nearestInsiderDate === date;

          // Calculate pie percentages
          const buyPercent = totalShares > 0 ? totalBuyShares / totalShares : 0;
          const sellPercent = totalShares > 0 ? totalSellShares / totalShares : 0;

          // Colors
          const buyColor = '#10b981'; // green
          const sellColor = '#ef4444'; // red

          // Calculate pie angles (start from top: -PI/2)
          const startAngle = -Math.PI / 2;
          const buyEndAngle = startAngle + buyPercent * 2 * Math.PI;
          const sellEndAngle = buyEndAngle + sellPercent * 2 * Math.PI;

          // Get aggregated marker for hover
          const aggregatedMarker: InsiderMarker = {
            date,
            accessionNumbers: allAccessionNumbers,
            type: totalBuyShares > 0 && totalSellShares > 0 ? 'mixed' : totalBuyShares > 0 ? 'acquire' : 'dispose',
            filingCount: dateMarkers.length,
            buyShares: totalBuyShares,
            sellShares: totalSellShares,
          };

          return (
            <g
              key={`insider-${index}`}
              className={onInsiderMarkerClick ? 'cursor-pointer' : 'cursor-default'}
              onClick={(e) => {
                e.stopPropagation();
                if (onInsiderMarkerClick) {
                  onInsiderMarkerClick(date, allAccessionNumbers);
                }
              }}
              onMouseEnter={() => handleMarkerMouseEnter(aggregatedMarker, point.x, point.y)}
              onMouseLeave={handleMarkerMouseLeave}
            >
              {/* Invisible hit area to prevent flickering */}
              <circle
                cx={point.x}
                cy={point.y}
                r={radius + 8}
                fill="transparent"
              />

              {/* Highlight ring for nearest marker */}
              {isNearest && (
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={radius + 6}
                  fill="none"
                  stroke="var(--color-ink)"
                  strokeWidth={2}
                  strokeOpacity={0.3}
                  pointerEvents="none"
                />
              )}

              {/* White background circle for cleaner look */}
              <circle
                cx={point.x}
                cy={point.y}
                r={radius + 1}
                fill="white"
                filter={isNearest ? 'url(#dot-shadow-hover)' : 'url(#dot-shadow)'}
                pointerEvents="none"
              />

              {/* Pie chart slices */}
              <g pointerEvents="none">
                {totalShares > 0 ? (
                  <>
                    {/* Buy slice (green) */}
                    {buyPercent > 0 && buyPercent < 1 && (
                      <path
                        d={getPieSlicePath(point.x, point.y, radius, startAngle, buyEndAngle)}
                        fill={buyColor}
                      />
                    )}
                    {/* Sell slice (red) */}
                    {sellPercent > 0 && sellPercent < 1 && (
                      <path
                        d={getPieSlicePath(point.x, point.y, radius, buyEndAngle, sellEndAngle)}
                        fill={sellColor}
                      />
                    )}
                    {/* Full circle if 100% one type */}
                    {buyPercent === 1 && (
                      <circle cx={point.x} cy={point.y} r={radius} fill={buyColor} />
                    )}
                    {sellPercent === 1 && (
                      <circle cx={point.x} cy={point.y} r={radius} fill={sellColor} />
                    )}
                  </>
                ) : (
                  /* Fallback gray circle if no shares data */
                  <circle cx={point.x} cy={point.y} r={radius} fill="#9ca3af" />
                )}

                {/* White border */}
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={radius}
                  fill="none"
                  stroke="white"
                  strokeWidth={2}
                />
              </g>
            </g>
          );
        })}

      {/* Insider Marker Tooltip */}
      {hoveredMarker && (
        <g className="pointer-events-none">
          {(() => {
            const tooltipWidth = 140;
            const tooltipHeight = 70;
            const padding = 8;

            // Position tooltip above the marker, with boundary checking
            let tooltipX = hoveredMarker.x - tooltipWidth / 2;
            let tooltipY = hoveredMarker.y - tooltipHeight - 15;

            // Keep tooltip within horizontal bounds (assuming chart starts around x=60)
            const minX = 10;
            const maxX = 800 - tooltipWidth - 10;
            tooltipX = Math.max(minX, Math.min(maxX, tooltipX));

            // If marker is too close to top, show tooltip below instead
            if (tooltipY < paddingTop) {
              tooltipY = hoveredMarker.y + 20;
            }

            // Format numbers
            const formatShares = (num: number) => {
              if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
              if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
              return num.toLocaleString();
            };

            const formatDate = (dateStr: string) => {
              const date = new Date(dateStr + 'T00:00:00');
              return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
            };

            return (
              <>
                {/* Tooltip background */}
                <rect
                  x={tooltipX}
                  y={tooltipY}
                  width={tooltipWidth}
                  height={tooltipHeight}
                  rx={6}
                  fill="var(--color-ink)"
                  filter="url(#dot-shadow)"
                />

                {/* Buy/Sell row */}
                <text
                  x={tooltipX + padding}
                  y={tooltipY + 18}
                  className="text-[11px] font-medium"
                  fill="white"
                >
                  <tspan fill="#10b981">Buys: </tspan>
                  <tspan fill="white">{formatShares(hoveredMarker.buyShares)}</tspan>
                  <tspan fill="white"> | </tspan>
                  <tspan fill="#ef4444">Sells: </tspan>
                  <tspan fill="white">{formatShares(hoveredMarker.sellShares)}</tspan>
                </text>

                {/* Filings count */}
                <text
                  x={tooltipX + padding}
                  y={tooltipY + 38}
                  className="text-[11px]"
                  fill="white"
                  opacity={0.8}
                >
                  {hoveredMarker.filingCount} filing{hoveredMarker.filingCount !== 1 ? 's' : ''}
                </text>

                {/* Date */}
                <text
                  x={tooltipX + padding}
                  y={tooltipY + 56}
                  className="text-[10px]"
                  fill="white"
                  opacity={0.6}
                >
                  {formatDate(hoveredMarker.date)}
                </text>
              </>
            );
          })()}
        </g>
      )}

      {/* Corporate Action Tooltip */}
      {hoveredCorporateAction && (
        <g className="pointer-events-none">
          {(() => {
            const tooltipWidth = 130;
            const tooltipHeight = 50;
            const padding = 10;

            // Position tooltip above the marker
            let tooltipX = hoveredCorporateAction.x - tooltipWidth / 2;
            let tooltipY = hoveredCorporateAction.y - tooltipHeight - 15;

            // Keep within bounds
            const minX = 10;
            const maxX = 800 - tooltipWidth - 10;
            tooltipX = Math.max(minX, Math.min(maxX, tooltipX));

            // If too close to top, show below
            if (tooltipY < paddingTop) {
              tooltipY = hoveredCorporateAction.y + 20;
            }

            const formatDate = (dateStr: string) => {
              const date = new Date(dateStr + 'T00:00:00');
              return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            };

            const isDividend = hoveredCorporateAction.type === 'dividend';
            const actionVal = hoveredCorporateAction.value;
            const valueText =
              actionVal == null
                ? ''
                : isDividend
                  ? `$${actionVal.toFixed(2)}`
                  : `${actionVal}:1`;

            return (
              <>
                <rect
                  x={tooltipX}
                  y={tooltipY}
                  width={tooltipWidth}
                  height={tooltipHeight}
                  rx={6}
                  fill="var(--color-ink)"
                  filter="url(#dot-shadow)"
                />

                {/* Type and value */}
                <text
                  x={tooltipX + padding}
                  y={tooltipY + 20}
                  className="text-[12px] font-semibold"
                  fill={hoveredCorporateAction.color}
                >
                  {isDividend ? 'Dividend: ' : 'Stock Split: '}
                  <tspan fill="white">{valueText}</tspan>
                </text>

                {/* Date */}
                <text
                  x={tooltipX + padding}
                  y={tooltipY + 38}
                  className="text-[10px]"
                  fill="white"
                  opacity={0.7}
                >
                  {formatDate(hoveredCorporateAction.date)}
                </text>
              </>
            );
          })()}
        </g>
      )}
    </g>
  );
});
