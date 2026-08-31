'use client';

import { memo, useMemo, useRef, useCallback } from 'react';
import type { Chart as ChartJS } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { MULTI_SERIES_COLORS } from '@/lib/chart-utils';
import { exportChartJsAsPng } from '@/lib/chart-export';
import { ExportButton } from '@/components/charts/ExportButton';
import type { ChartOptions } from 'chart.js';

const DEFAULT_FONT_FAMILY = 'Plus Jakarta Sans, sans-serif';

export interface RebasedSeries {
  /** Legend label */
  label: string;
  /** Points sorted by date ascending; value already rebased to 100 at series start */
  points: { date: string; value: number }[];
  /** Optional explicit color (else palette by index) */
  color?: string;
  /** Render dashed (used for the FRED-spot reference line) */
  dashed?: boolean;
}

interface RebasedLineChartProps {
  series: RebasedSeries[];
  title?: string;
  /** Y-axis label (default "Rebased to 100") */
  yAxisLabel?: string;
  height?: number;
  isLoading?: boolean;
}

/**
 * Multi-series line chart for rebased (=100 at start) performance comparisons.
 * Mirrors the Dash commodities `time_series` rebased charts. Each series carries
 * its own date axis; we union all dates so lines align on a shared category axis.
 */
export const RebasedLineChart = memo(function RebasedLineChart({
  series,
  title,
  yAxisLabel = 'Rebased to 100',
  height = 320,
  isLoading = false,
}: RebasedLineChartProps) {
  const chartRef = useRef<ChartJS<'line'>>(null);

  const handleExport = useCallback(async () => {
    await exportChartJsAsPng(chartRef, title || 'commodities', undefined, title);
  }, [title]);

  const { labels, datasets } = useMemo(() => {
    if (series.length === 0) return { labels: [] as string[], datasets: [] };

    // Union of all dates across series (sorted).
    const dateSet = new Set<string>();
    for (const s of series) for (const p of s.points) dateSet.add(p.date);
    const allDates = Array.from(dateSet).sort();

    const datasets = series.map((s, i) => {
      const byDate = new Map(s.points.map((p) => [p.date, p.value]));
      const color = s.color ?? MULTI_SERIES_COLORS[i % MULTI_SERIES_COLORS.length];
      return {
        label: s.label,
        data: allDates.map((d) => (byDate.has(d) ? (byDate.get(d) as number) : null)),
        borderColor: color,
        backgroundColor: color,
        borderWidth: 2,
        borderDash: s.dashed ? [6, 4] : undefined,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.1,
        spanGaps: true,
      };
    });

    return { labels: allDates, datasets };
  }, [series]);

  const options = useMemo<ChartOptions<'line'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            usePointStyle: true,
            padding: 16,
            font: { size: 11, family: DEFAULT_FONT_FAMILY },
          },
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          titleFont: { size: 12, family: DEFAULT_FONT_FAMILY },
          bodyFont: { size: 11, family: DEFAULT_FONT_FAMILY },
          padding: 12,
          callbacks: {
            label: (ctx) =>
              `${ctx.dataset.label}: ${
                ctx.parsed.y == null ? '—' : ctx.parsed.y.toFixed(1)
              }`,
          },
        },
        title: { display: false },
      },
      scales: {
        x: {
          type: 'time',
          time: { unit: 'year' },
          grid: { display: false },
          ticks: {
            font: { size: 10, family: DEFAULT_FONT_FAMILY },
            color: '#94a3b8',
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 8,
          },
        },
        y: {
          grid: { color: '#e2e8f0' },
          title: {
            display: true,
            text: yAxisLabel,
            font: { size: 11, family: DEFAULT_FONT_FAMILY },
            color: '#64748b',
          },
          ticks: { font: { size: 10, family: DEFAULT_FONT_FAMILY }, color: '#94a3b8' },
        },
      },
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
    }),
    [yAxisLabel]
  );

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center text-ink-muted"
        style={{ height }}
      >
        <div className="flex items-center gap-3">
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading…
        </div>
      </div>
    );
  }

  if (datasets.length === 0 || labels.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-ink-muted"
        style={{ height }}
      >
        No price history in this window
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="absolute top-0 right-0 z-10">
        <ExportButton onExport={handleExport} />
      </div>
      <div style={{ height }}>
        <Line ref={chartRef} data={{ labels, datasets }} options={options} />
      </div>
    </div>
  );
});
