'use client';

import { memo, useMemo, useRef, useCallback } from 'react';
import type { Chart as ChartJS, ChartOptions, Plugin } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { formatCurrency } from '../../lib/formatters';
// Importing from chart-utils also runs registerChartComponents() (side effect).
import { getLineChartOptions } from '../../lib/chart-utils';
import { exportChartJsAsPng } from '../../lib/chart-export';
import { ExportButton } from './ExportButton';

interface DataPoint {
  date: string;
  value: number | null;
}

/** Horizontal colored zone band. Omit `from`/`to` to extend to the axis min/max. */
export interface ZoneBand {
  from?: number;
  to?: number;
  color: string;
}

// Fills horizontal value-bands behind the series (e.g. Altman Z safe/grey/distress).
// Reads its config from chart.options.plugins.zoneBands so the plugin object stays
// stable across renders. Drawn before datasets so the line sits on top.
const zoneBandsPlugin: Plugin<'line'> = {
  id: 'zoneBands',
  beforeDatasetsDraw(chart) {
    const bands = (chart.options.plugins as { zoneBands?: { bands?: ZoneBand[] } } | undefined)
      ?.zoneBands?.bands;
    const y = chart.scales.y;
    if (!bands?.length || !y) return;
    const { ctx, chartArea } = chart;
    ctx.save();
    for (const b of bands) {
      const yHi = y.getPixelForValue(b.to ?? y.max);
      const yLo = y.getPixelForValue(b.from ?? y.min);
      const top = Math.max(chartArea.top, Math.min(yHi, yLo));
      const bottom = Math.min(chartArea.bottom, Math.max(yHi, yLo));
      if (bottom <= top) continue;
      ctx.fillStyle = b.color;
      ctx.fillRect(chartArea.left, top, chartArea.right - chartArea.left, bottom - top);
    }
    ctx.restore();
  },
};

interface ValuationLineChartProps {
  /** Array of data points with date and value */
  data: DataPoint[];
  /** Chart title */
  title: string;
  /** Y-axis label */
  yAxisLabel?: string;
  /** Kept for API compatibility — lines are always black now. */
  color?: string;
  /** Format type for values */
  format?: 'currency' | 'ratio' | 'percent';
  /** Whether data is loading */
  isLoading?: boolean;
  /** Treat negative values as gaps (e.g. P/E where negative is meaningless) */
  treatNegativeAsGap?: boolean;
  /** Horizontal colored zone bands drawn behind the line (e.g. Altman Z thresholds) */
  bands?: ZoneBand[];
}

const LINE_COLOR = '#111111';

/**
 * Single-series line chart on Chart.js (react-chartjs-2) — canvas-rendered, so it
 * sizes responsively without the stretch/distortion of a fixed-viewBox SVG. Lines
 * are black and unfilled. Mirrors the Dash `time_series` charts.
 */
export const ValuationLineChart = memo(function ValuationLineChart({
  data,
  title,
  yAxisLabel,
  color: _color,
  format = 'ratio',
  isLoading = false,
  treatNegativeAsGap = false,
  bands,
}: ValuationLineChartProps) {
  void _color;
  const chartRef = useRef<ChartJS<'line'>>(null);

  const handleExport = useCallback(async () => {
    await exportChartJsAsPng(chartRef, title, undefined, title);
  }, [title]);

  const fmt = useCallback(
    (v: number) =>
      format === 'currency'
        ? formatCurrency(v)
        : format === 'percent'
          ? `${v.toFixed(1)}%`
          : v.toFixed(2),
    [format]
  );

  const { labels, values, hasData } = useMemo(() => {
    const sorted = [...(data || [])].sort((a, b) => a.date.localeCompare(b.date));
    const labels = sorted.map((d) =>
      new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
    );
    const values = sorted.map((d) => {
      if (d.value === null) return null;
      if (treatNegativeAsGap && d.value < 0) return null;
      return d.value;
    });
    return { labels, values, hasData: values.some((v) => v !== null) };
  }, [data, treatNegativeAsGap]);

  const chartData = useMemo(
    () => ({
      labels,
      datasets: [
        {
          label: title,
          data: values,
          borderColor: LINE_COLOR,
          backgroundColor: LINE_COLOR,
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: LINE_COLOR,
          tension: 0,
          fill: false,
          spanGaps: false,
        },
      ],
    }),
    [labels, values, title]
  );

  const options = useMemo<ChartOptions<'line'>>(() => {
    const base = getLineChartOptions({
      isCurrency: format === 'currency',
      isPercent: format === 'percent',
      maxTicksLimit: 8,
    });
    return {
      ...base,
      // No load animation: these tabs mount several charts at once, and the default
      // ~1s animation makes them feel slow to appear (esp. with many points).
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        ...base.plugins,
        // Consumed by zoneBandsPlugin (passed to <Line> below).
        ...(bands && bands.length ? { zoneBands: { bands } } : {}),
        tooltip: {
          callbacks: {
            label: (c) => (c.parsed.y == null ? '' : fmt(Number(c.parsed.y))),
          },
        },
      },
      scales: {
        ...base.scales,
        x: {
          ...base.scales?.x,
          ticks: { ...base.scales?.x?.ticks, color: '#475569' },
        },
        y: {
          ...base.scales?.y,
          ticks: {
            ...base.scales?.y?.ticks,
            color: '#475569',
            // Use the same formatter as the tooltip so currency axes show $1.2B etc.
            callback: (v) => fmt(Number(v)),
          },
          title: yAxisLabel ? { display: true, text: yAxisLabel, color: '#475569' } : undefined,
        },
      },
    };
  }, [format, fmt, yAxisLabel, bands]);

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-ink">{title}</h4>
        {hasData && !isLoading && <ExportButton onExport={handleExport} />}
      </div>
      <div className="h-[300px]">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-ink-faint">
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : !hasData ? (
          <div className="flex items-center justify-center h-full text-ink-faint text-sm">No data</div>
        ) : (
          <Line ref={chartRef} data={chartData} options={options} plugins={bands && bands.length ? [zoneBandsPlugin] : []} />
        )}
      </div>
    </div>
  );
});
