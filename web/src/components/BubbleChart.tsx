'use client';

import { useMemo, useState, useRef, useEffect, memo, useCallback } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LogarithmicScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Title,
} from 'chart.js';
import { Bubble } from 'react-chartjs-2';
import { formatNumberCompact, formatNumber, formatNormalizationReason } from '../lib/formatters';
import { exportChartJsAsPng } from '../lib/chart-export';
import { Spinner } from './Loading';
import { ExportButton } from './charts/ExportButton';

ChartJS.register(
  CategoryScale,
  LinearScale,
  LogarithmicScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Title
);

/**
 * Draw trend line connecting data points for an entity.
 *
 * Line behavior reflects filing status:
 * - Adjacent periods (consecutive quarters): solid line
 * - Gap (institution didn't file for intervening quarters): NO line drawn,
 *   leaving the chart visually disjoint so the gap is obvious
 * - Zero value (institution filed but didn't hold the security): treated as
 *   a normal data point; lines connect through it
 *
 * See also: frontend/docs/ui-components.md § Bubble Chart Data States
 */
function drawTrendLine(
  ctx: CanvasRenderingContext2D,
  validPoints: { x: number; y: number; r: number; label: string }[],
  allLabels: string[],
  strokeColor: string,
  fillColor: string,
  redrawBubbles: boolean,
  skipGapCheck = false,
  lineWidth = 2,
) {
  if (validPoints.length < 2) return;

  ctx.save();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash([]);

  for (let i = 0; i < validPoints.length - 1; i++) {
    const currentPoint = validPoints[i];
    const nextPoint = validPoints[i + 1];

    if (!skipGapCheck) {
      // Only draw lines between adjacent periods; skip gaps entirely
      const currentIdx = allLabels.indexOf(currentPoint.label);
      const nextIdx = allLabels.indexOf(nextPoint.label);
      // Gap = non-adjacent periods (institution didn't file). Leave disjoint.
      const isGap = currentIdx < 0 || nextIdx < 0 || (nextIdx - currentIdx) > 1;
      if (isGap) continue;
    }

    ctx.beginPath();
    ctx.moveTo(currentPoint.x, currentPoint.y);
    ctx.lineTo(nextPoint.x, nextPoint.y);
    ctx.stroke();
  }

  // Redraw the bubbles on top to bring them to front
  if (redrawBubbles) {
    for (const point of validPoints) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, point.r, 0, Math.PI * 2);
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  ctx.restore();
}

/** Extract valid pixel points from a dataset for trend line drawing. */
function getDatasetPoints(chart: any, datasetIndex: number) {
  const meta = chart.getDatasetMeta(datasetIndex);
  const data = chart.data.datasets[datasetIndex].data;
  const points: { x: number; y: number; r: number; label: string }[] = [];
  for (let i = 0; i < meta.data.length; i++) {
    const point = meta.data[i];
    if (point && typeof point.x === 'number' && typeof point.y === 'number') {
      points.push({ x: point.x, y: point.y, r: data[i]?.r || 5, label: data[i]?.x || '' });
    }
  }
  return points;
}

// Plugin to draw trend lines for hover, selected, and always-on modes
const hoverTrendLinePlugin = {
  id: 'hoverTrendLine',
  afterDatasetsDraw: (chart: any) => {
    const ctx = chart.ctx;
    const allLabels: string[] = chart.options?.scales?.x?.labels || [];
    const pluginOpts = chart.options?.plugins?.hoverTrendLine || {};
    const selectedEntityId = pluginOpts.selectedEntityId;
    const skipGaps = pluginOpts.alwaysShowTrendLines; // Skip gap check for irregular periods (ETFs)

    // Draw selected entity trend line (always visible when selected)
    if (selectedEntityId) {
      const selectedDataset = chart.data.datasets.find((ds: any) => ds.entityId === selectedEntityId);
      if (selectedDataset) {
        const datasetIndex = chart.data.datasets.indexOf(selectedDataset);
        const borderColor = selectedDataset.borderColor || 'rgba(0,0,0,0.5)';
        const bgColor = selectedDataset.backgroundColor || borderColor;
        const solidBorderColor = borderColor.replace(/[\d.]+\)$/, '1)');
        const points = getDatasetPoints(chart, datasetIndex);
        drawTrendLine(ctx, points, allLabels, solidBorderColor, bgColor, true, skipGaps);
      }
      return; // Don't draw hover line when something is selected
    }

    // Draw hover trend line
    const activeElements = chart.getActiveElements();
    if (activeElements.length === 0) return;

    const activeElement = activeElements[0];
    const dataset = chart.data.datasets[activeElement.datasetIndex];
    if (!dataset || !dataset.entityId) return;
    if (!dataset.data || dataset.data.length < 2) return;

    const borderColor = dataset.borderColor || 'rgba(0,0,0,0.5)';
    const bgColor = dataset.backgroundColor || borderColor;
    const solidBorderColor = borderColor.replace(/[\d.]+\)$/, '1)');
    const points = getDatasetPoints(chart, activeElement.datasetIndex);
    drawTrendLine(ctx, points, allLabels, solidBorderColor, bgColor, true, skipGaps);
  },
};

const BASE_COLORS = [
  'rgba(255, 99, 132, 0.7)',
  'rgba(54, 162, 235, 0.7)',
  'rgba(255, 205, 86, 0.7)',
  'rgba(75, 192, 192, 0.7)',
  'rgba(153, 102, 255, 0.7)',
  'rgba(255, 159, 64, 0.7)',
  'rgba(199, 199, 199, 0.7)',
  'rgba(83, 102, 255, 0.7)',
  'rgba(255, 99, 255, 0.7)',
  'rgba(99, 255, 132, 0.7)',
];

export interface NormalizationInfo {
  shares_reason?: string;
  value_reason?: string;
  price_used?: number;
  shares_raw?: number;
  shares_normalized?: number;
}

interface BubbleChartProps {
  processedData: Record<string, Record<string, number> & { maxShares: number }>;
  periods: string[];
  nameMap: Record<string, string>;
  title: string;
  yAxisLabel: string;
  isLoading?: boolean;
  onEntitySelect?: (entityId: string | null, entityName: string | null) => void;
  entityLinkPrefix?: string; // e.g., "/cik/" for institutions
  entityLinkMap?: Record<string, string>; // Maps entity ID to link value (e.g., "0" -> "APLD")
  height?: number; // Chart height in pixels
  onAddToChart?: (entityId: string, entityName: string, data: Array<{ date: string; value: number }>) => void;
  chartAddedEntities?: string[]; // Track which entities have been added to price chart
  totals?: Record<string, { total_shares: number; ownership_pct?: number | null }>; // For computing ownership %
  isSharesMode?: boolean; // Only show ownership % when viewing shares (not value)
  overrideAlwaysShowTrendLines?: boolean; // Always show trend lines for all entities (skips gap check for irregular periods)
  normalizationInfoMap?: Record<string, Record<string, NormalizationInfo>>; // Per-entity normalization info
  showNormalized?: boolean; // Whether normalization toggle is active
}

function formatDate(dateString: string): string {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
  } catch {
    return dateString;
  }
}

export const BubbleChart = memo(function BubbleChart({
  processedData,
  periods,
  nameMap,
  title,
  yAxisLabel,
  isLoading = false,
  onEntitySelect,
  entityLinkPrefix,
  entityLinkMap,
  height = 600,
  onAddToChart,
  chartAddedEntities = [],
  totals,
  isSharesMode = false,
  overrideAlwaysShowTrendLines = false,
  normalizationInfoMap,
  showNormalized = false,
}: BubbleChartProps) {
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [hiddenEntities, setHiddenEntities] = useState<Set<string>>(new Set());
  const [useLogScale, setUseLogScale] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [shouldAnimate, setShouldAnimate] = useState(false);
  const chartRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef({ x: 0, y: 0 });

  const handleExport = useCallback(async () => {
    await exportChartJsAsPng(chartRef, title.toLowerCase().replace(/\s+/g, '-'), undefined, title);
  }, [title]);

  const formattedPeriods = useMemo(() => periods.map(formatDate), [periods]);

  // Detect mobile for responsive bubble sizing
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  // Calculate max value for bubble sizing (from all visible entities, not just selected)
  // This keeps bubble sizes consistent when selecting/deselecting entities
  const maxValue = useMemo(() => {
    let max = 0;
    for (const [entityId, entityData] of Object.entries(processedData)) {
      // Skip hidden entities
      if (hiddenEntities.has(entityId)) continue;
      // Don't skip non-selected entities - we want consistent sizing
      max = Math.max(max, entityData.maxShares || 0);
    }
    return max;
  }, [processedData, hiddenEntities]);

  // Handle touch events for mobile lock
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleTouchStart = (e: TouchEvent) => {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
    };

    const handleTouchMove = (e: TouchEvent) => {
      const deltaX = e.touches[0].clientX - touchStartRef.current.x;
      const deltaY = e.touches[0].clientY - touchStartRef.current.y;

      // Check for horizontal swipe
      if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 2) {
        if (deltaX > 0 && !isLocked) {
          setIsLocked(true);
          touchStartRef.current.x = e.touches[0].clientX;
        } else if (deltaX < 0 && isLocked) {
          setIsLocked(false);
          touchStartRef.current.x = e.touches[0].clientX;
        }
      }

      if (isLocked) {
        e.preventDefault();
      }
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
    };
  }, [isLocked]);

  // Notify parent of selection changes
  useEffect(() => {
    if (onEntitySelect) {
      onEntitySelect(
        selectedEntity,
        selectedEntity ? nameMap[selectedEntity] || null : null
      );
    }
  }, [selectedEntity, nameMap, onEntitySelect]);

  const datasets = useMemo(() => {
    const entityIds = Object.keys(processedData);
    const result: any[] = [];

    entityIds.forEach((entityId, colorIndex) => {
      // Skip non-selected entities if one is selected
      if (selectedEntity && selectedEntity !== entityId) return;

      const entityData = processedData[entityId];
      const isHidden = hiddenEntities.has(entityId);
      const bubblePoints: { x: string; y: number; r: number }[] = [];

      periods.forEach((period) => {
        const value = entityData[period];
        if (value === undefined) return;

        const minSize = isMobile ? 2 : 3;
        const maxSize = isMobile ? 12 : 25;
        const bubbleSize =
          value === 0 || maxValue === 0
            ? minSize
            : Math.max(minSize, Math.min(maxSize, (value / maxValue) * (maxSize - minSize) + minSize));

        bubblePoints.push({
          x: formatDate(period),
          y: value,
          r: bubbleSize,
        });
      });

      if (bubblePoints.length === 0) return;

      const color = BASE_COLORS[colorIndex % BASE_COLORS.length];
      const isSelected = selectedEntity === entityId;

      // Note: Selected trend line is drawn by the hoverTrendLinePlugin using the same gap logic

      result.push({
        label: nameMap[entityId] || `Entity ${entityId}`,
        data: bubblePoints,
        backgroundColor: isSelected
          ? color.replace(/[\d.]+\)$/, '0.9)')
          : color,
        borderColor: color.replace('0.7', '1'),
        borderWidth: isSelected ? 3 : 1,
        entityId,
        order: 0, // Draw in front
        hidden: isHidden, // Chart.js will hide this dataset but keep legend item
      });
    });

    return result;
  }, [processedData, periods, nameMap, maxValue, selectedEntity, hiddenEntities]);

  const options: any = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'nearest',
      intersect: false,
    },
    layout: {
      padding: { top: 20, right: isMobile ? 10 : 20, bottom: 20, left: isMobile ? 5 : 20 },
    },
    scales: {
      x: {
        type: 'category',
        labels: formattedPeriods,
        title: { display: !isMobile, text: 'Time Period' },
      },
      y: {
        type: useLogScale ? 'logarithmic' : 'linear',
        title: { display: !isMobile, text: yAxisLabel + (useLogScale ? ' (Log Scale)' : '') },
        ticks: {
          callback: (value: number) => formatNumberCompact(value),
        },
      },
    },
    plugins: {
      title: {
        display: true,
        text: selectedEntity
          ? (isMobile
              ? [title, `Selected: ${nameMap[selectedEntity] || selectedEntity}`]
              : `${title} - Selected: ${nameMap[selectedEntity] || selectedEntity}`)
          : title,
        font: { size: isMobile ? 14 : 16, weight: 'bold' as const },
        padding: { top: 10, bottom: 20 },
      },
      legend: {
        display: true,
        position: 'bottom' as const,
        labels: {
          usePointStyle: true,
          padding: 15,
          font: { size: 12 },
        },
        onClick: (_event: any, legendItem: any, legend: any) => {
          // Get the entity ID from the dataset
          const datasetIndex = legendItem.datasetIndex;
          const dataset = legend.chart.data.datasets[datasetIndex];
          const entityId = dataset?.entityId;

          if (entityId) {
            setShouldAnimate(true);
            setHiddenEntities(prev => {
              const next = new Set(prev);
              if (next.has(entityId)) {
                next.delete(entityId);
              } else {
                next.add(entityId);
              }
              return next;
            });
          }
        },
      },
      tooltip: {
        enabled: true,
        callbacks: {
          title: (context: any) => context[0]?.dataset?.label || '',
          label: (context: any) => {
            const period = context.raw?.x || '';
            const rawValue = context.parsed?.y || 0;
            const value = formatNumberCompact(rawValue);
            const fullValue = formatNumber(Math.round(rawValue));
            const lines = [`Period: ${period}`, `${yAxisLabel}: ${value} (${fullValue})`];

            // Show normalization or price info based on mode
            if (normalizationInfoMap) {
              const entityId = context.dataset?.entityId;
              // Find the original period string (periods array has ISO dates, tooltip has formatted)
              const originalPeriod = periods.find(p => formatDate(p) === period);
              if (entityId && originalPeriod) {
                const info = normalizationInfoMap[entityId]?.[originalPeriod];
                if (info) {
                  if (showNormalized) {
                    // Show adjustment reasons when normalized toggle is on
                    const valueReason = formatNormalizationReason(info.value_reason, 'value');
                    const sharesReason = formatNormalizationReason(info.shares_reason, 'shares');
                    if (valueReason || sharesReason) {
                      lines.push(''); // Empty line for spacing
                      lines.push('Adjustments:');
                      if (valueReason) {
                        lines.push(`  Value: ${valueReason}`);
                      }
                      if (sharesReason) {
                        lines.push(`  Shares: ${sharesReason}`);
                      }
                    }
                  } else if (info.price_used) {
                    // Show price used when in derived mode (value = shares × price)
                    lines.push(`Price: $${info.price_used.toFixed(2)}`);
                  }
                }
              }
            }

            lines.push('Click to select/deselect');
            return lines;
          },
        },
      },
      hoverTrendLine: {
        selectedEntityId: selectedEntity,
        alwaysShowTrendLines: overrideAlwaysShowTrendLines,
      },
    },
    animation: shouldAnimate ? {
      duration: 400,
      easing: 'easeOutCubic' as const,
      onComplete: () => setShouldAnimate(false),
    } : false,
    onClick: (_event: any, elements: any[]) => {
      if (elements.length > 0) {
        const element = elements[0];
        const dataset = datasets[element.datasetIndex];
        const entityId = dataset?.entityId;
        if (entityId) {
          setShouldAnimate(true);
          setSelectedEntity(selectedEntity === entityId ? null : entityId);
        }
      } else if (selectedEntity) {
        setShouldAnimate(true);
        setSelectedEntity(null);
      }
    },
  };

  return (
    <div className="relative" ref={containerRef}>
      {/* Controls Row */}
      <div className={`flex flex-wrap items-center gap-4 mt-2 pt-2 ${isMobile ? 'mb-2' : 'mb-4'}`}>
        {/* Export Button */}
        <ExportButton onExport={handleExport} />

        {/* Log Scale Toggle */}
        <label className="flex items-center gap-2 text-sm text-ink-light cursor-pointer">
          <input
            type="checkbox"
            checked={useLogScale}
            onChange={(e) => setUseLogScale(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-green focus:ring-green"
          />
          Log Scale
        </label>

        {/* Show All Button (always takes space, invisible when no hidden entities) */}
        <button
          onClick={() => {
            setShouldAnimate(true);
            setHiddenEntities(new Set());
          }}
          className={`px-3 py-1.5 text-sm font-medium rounded-lg bg-surface-warm text-ink-light border border-rule-light hover:bg-gray-100 transition ${
            hiddenEntities.size === 0 ? 'invisible' : ''
          }`}
          disabled={hiddenEntities.size === 0}
        >
          Show All ({hiddenEntities.size} hidden)
        </button>

        {/* Selected Entity Actions */}
        {selectedEntity && (
          <div className="flex items-center gap-2 ml-auto">
            {/* Ownership % display - only show when viewing shares, not value */}
            {totals && isSharesMode && (() => {
              const entityData = processedData[selectedEntity];
              if (!entityData) return null;
              // Find most recent period with both entity data and ownership_pct
              const sortedPeriods = [...periods].sort().reverse();
              for (const period of sortedPeriods) {
                const entityShares = typeof entityData[period] === 'number' ? entityData[period] : 0;
                const periodTotals = totals[period];
                if (entityShares > 0 && periodTotals?.ownership_pct && periodTotals.total_shares > 0) {
                  const sharesOutstanding = periodTotals.total_shares / (periodTotals.ownership_pct / 100);
                  const ownershipPct = (entityShares / sharesOutstanding) * 100;
                  return (
                    <div className="flex flex-col items-end mr-2">
                      <span className="text-lg font-bold text-blue-600">{ownershipPct.toFixed(2)}%</span>
                      <span className="text-[10px] text-gray-500">of shares outstanding</span>
                    </div>
                  );
                }
              }
              return null;
            })()}
            {onAddToChart && (
              <button
                onClick={() => {
                  const entityData = processedData[selectedEntity];
                  if (!entityData) return;
                  const chartData = periods
                    .map((period) => ({
                      date: period,
                      value: typeof entityData[period] === 'number' ? (entityData[period] as number) : 0,
                    }))
                    .filter((d) => d.value > 0);
                  onAddToChart(selectedEntity, nameMap[selectedEntity] || selectedEntity, chartData);
                }}
                disabled={chartAddedEntities.includes(selectedEntity)}
                className={`px-4 py-2 text-sm font-medium rounded-lg shadow transition ${
                  chartAddedEntities.includes(selectedEntity)
                    ? 'bg-gray-400 text-white cursor-not-allowed'
                    : 'bg-green text-white hover:bg-green-dark'
                }`}
              >
                {chartAddedEntities.includes(selectedEntity) ? 'Added to Chart' : 'Add to Price Chart'}
              </button>
            )}
            {entityLinkPrefix && (
              <a
                href={`${entityLinkPrefix}${entityLinkMap?.[selectedEntity!] || selectedEntity}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg shadow hover:bg-blue-700 transition"
              >
                Go to {nameMap[selectedEntity] ? 'page' : 'entity page'}
              </a>
            )}
            <button
              onClick={() => setSelectedEntity(null)}
              className="px-4 py-2 bg-gray-600 text-white text-sm font-medium rounded-lg shadow hover:bg-gray-700 transition"
            >
              Clear Selection
            </button>
          </div>
        )}
      </div>

      {/* Mobile Lock Indicator */}
      {isMobile && (
        <div
          className={`flex justify-center items-center gap-1.5 mx-auto mb-2 py-1.5 px-3 rounded-full text-xs text-white w-fit transition-colors ${
            isLocked ? 'bg-emerald-500' : 'bg-black/70'
          }`}
        >
          {isLocked ? (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span>Swipe ← to unlock</span>
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
              </svg>
              <span>Swipe → to lock</span>
            </>
          )}
        </div>
      )}

      {/* Chart Container */}
      <div className="relative border-2 border-gray-300 rounded-lg" style={{ height: `${height}px`, minHeight: '400px' }}>
        {/* Loading Overlay */}
        {isLoading && (
          <div className="absolute inset-0 bg-gray-50/[0.98] flex items-center justify-center z-50 rounded-lg">
            <Spinner className="h-5 w-5 text-green" />
          </div>
        )}

        {/* Y-axis label for mobile (positioned below chart title) */}
        {isMobile && (
          <div className="absolute left-3 text-xs text-gray-600 font-semibold z-10 bg-white/80 px-1.5 py-0.5 rounded" style={{ top: selectedEntity ? '60px' : '44px' }}>
            {yAxisLabel}{useLogScale ? ' (Log)' : ''}
          </div>
        )}

        <Bubble ref={chartRef} data={{ datasets }} options={options} plugins={[hoverTrendLinePlugin]} />
      </div>
    </div>
  );
});
