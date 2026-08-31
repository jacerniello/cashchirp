'use client';

import { memo, useState, useMemo, useRef, useCallback } from 'react';
import type { Chart as ChartJS } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import {
  CHART_COLORS,
  formatChartValue,
  generateBarColors,
  cleanChartData,
  getBarChartOptions,
} from '../../lib/chart-utils';
import { formatPreScaledMillions } from '../../lib/formatters';
import { exportChartJsAsPng } from '../../lib/chart-export';
import { ChartContainer } from './ChartContainer';
import { EmptyState } from '../EmptyState';
import { RangeBar } from '../PriceChart/components/RangeBar';

// Throttle helper
function useThrottle<T extends (...args: number[]) => void>(fn: T, delay: number): T {
  const lastCall = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastArgs = useRef<number[] | null>(null);

  return useCallback((...args: number[]) => {
    const now = Date.now();
    lastArgs.current = args;

    if (now - lastCall.current >= delay) {
      lastCall.current = now;
      fn(...args);
    } else {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        lastCall.current = Date.now();
        if (lastArgs.current) fn(...lastArgs.current);
      }, delay - (now - lastCall.current));
    }
  }, [fn, delay]) as T;
}

interface BarChartProps {
  title: string;
  labels: string[];
  values: (number | null)[];
  isPerShare?: boolean;
  isPercent?: boolean;
  colorIndex?: number;
  rangeStart?: number;
  rangeEnd?: number;
  onRangeChange?: (start: number, end: number) => void;
  onSetAllRange?: (start: number, end: number) => void;
  /** Treat negative values as gaps (useful for ratios like P/E where negative doesn't make sense) */
  treatNegativeAsGap?: boolean;
  /** Color bars by sign (green positive / red negative) — e.g. net insider flow. */
  signColors?: boolean;
}

export const FundamentalsBarChart = memo(function FundamentalsBarChart({
  title,
  labels,
  values,
  isPerShare = false,
  isPercent = false,
  colorIndex = 0,
  signColors = false,
  rangeStart: externalRangeStart,
  rangeEnd: externalRangeEnd,
  onRangeChange,
  onSetAllRange,
  treatNegativeAsGap = false,
}: BarChartProps) {
  const chartRef = useRef<ChartJS<'bar'>>(null);

  // Use internal state if no external control
  const [internalRangeStart, setInternalRangeStart] = useState(0);
  const [internalRangeEnd, setInternalRangeEnd] = useState(1);

  const rangeStart = externalRangeStart ?? internalRangeStart;
  const rangeEnd = externalRangeEnd ?? internalRangeEnd;

  const updateRange = useCallback((start: number, end: number) => {
    if (onRangeChange) {
      onRangeChange(start, end);
    } else {
      setInternalRangeStart(start);
      setInternalRangeEnd(end);
    }
  }, [onRangeChange]);

  const handleRangeChange = useThrottle(updateRange, 32); // ~30fps

  // Filter data based on range - ensure at least 1 item
  const filteredData = useMemo(() => {
    const len = labels.length;
    if (len === 0) return { labels: [], values: [] };

    let startIdx = Math.floor(rangeStart * len);
    let endIdx = Math.ceil(rangeEnd * len);

    // Clamp to valid range
    startIdx = Math.max(0, Math.min(startIdx, len - 1));
    endIdx = Math.max(startIdx + 1, Math.min(endIdx, len));

    return {
      labels: labels.slice(startIdx, endIdx),
      values: values.slice(startIdx, endIdx),
    };
  }, [labels, values, rangeStart, rangeEnd]);

  // Convert negative values to null if treatNegativeAsGap is true
  const processedValues = useMemo(() => {
    if (!treatNegativeAsGap) return filteredData.values;
    return filteredData.values.map(v => (v !== null && v < 0) ? null : v);
  }, [filteredData.values, treatNegativeAsGap]);

  // Check if there's any data in the original filtered range (including negatives)
  // This ensures we show the chart even when zoomed into all-negative regions
  const hasAnyData = filteredData.values.some((v) => v !== null);

  const handleExport = useCallback(async () => {
    await exportChartJsAsPng(chartRef, title, undefined, title);
  }, [title]);

  if (!hasAnyData) {
    return (
      <ChartContainer title={title} height="md">
        <EmptyState variant="inline" />
      </ChartContainer>
    );
  }

  const color = CHART_COLORS[colorIndex % CHART_COLORS.length];
  const { values: displayValues, nullIndices } = cleanChartData(processedValues);
  const base = generateBarColors(processedValues, color);
  // Sign-colored bars (green positive / red negative) for net-flow style charts.
  const backgroundColor = signColors
    ? processedValues.map((v) => (v == null ? 'rgba(200,200,200,0.3)' : v >= 0 ? '#10b981' : '#ef4444'))
    : base.backgroundColor;
  const borderColor = signColors
    ? processedValues.map((v) => (v == null ? 'rgba(150,150,150,0.5)' : v >= 0 ? '#10b981' : '#ef4444'))
    : base.borderColor;

  const chartData = {
    labels: filteredData.labels,
    datasets: [
      {
        label: title,
        data: displayValues,
        backgroundColor,
        borderColor,
        borderWidth: 1,
        borderRadius: 4,
      },
    ],
  };

  const options = getBarChartOptions({ isPerShare, isPercent });

  // Override tooltip callback to handle null values
  if (options.plugins?.tooltip?.callbacks) {
    options.plugins.tooltip.callbacks.label = (context) => {
      if (nullIndices.has(context.dataIndex)) {
        return 'No data available';
      }
      // Use formatPreScaledMillions for currency values (pre-scaled to millions)
      // Use formatChartValue for percent/per-share which aren't pre-scaled
      if (isPercent || isPerShare) {
        return formatChartValue(context.raw as number, { isPerShare, isPercent });
      }
      return formatPreScaledMillions(context.raw as number);
    };
  }

  const showRangeBar = labels.length > 4;

  const rangeBarFooter = showRangeBar ? (
    <div className="mt-4 pt-3 border-t border-rule-light">
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1">
          <RangeBar
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            onRangeChange={handleRangeChange}
            height={24}
          />
        </div>
        {onSetAllRange && (
          <button
            onClick={() => onSetAllRange(rangeStart, rangeEnd)}
            className="shrink-0 text-xs font-medium text-green hover:text-green-dark whitespace-nowrap"
            title="Apply this range to all charts"
          >
            Set All
          </button>
        )}
      </div>
      <div className="text-[10px] text-ink-muted text-center">
        {filteredData.labels[0]} — {filteredData.labels[filteredData.labels.length - 1]}
      </div>
    </div>
  ) : null;

  return (
    <ChartContainer title={title} height="md" footer={rangeBarFooter} onExport={handleExport}>
      <Bar ref={chartRef} data={chartData} options={options} />
    </ChartContainer>
  );
});
