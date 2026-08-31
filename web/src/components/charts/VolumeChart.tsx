'use client';

import { memo, useMemo, useRef, useCallback, useState } from 'react';
import type { Chart as ChartJS, ChartOptions } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { usePrices } from '@/hooks/usePrices';
import { registerChartComponents } from '@/lib/chart-utils';
import { exportChartJsAsPng } from '@/lib/chart-export';
import { formatNumberCompact, formatDate } from '@/lib/formatters';
import { ExportButton } from './ExportButton';
import { RangeBar } from '../PriceChart/components/RangeBar';

// This chart can be the only chart-utils consumer on a page; ensure registration.
registerChartComponents();

interface VolumeChartProps {
  /** permaticker (default) or ticker symbol — passed straight to usePrices. */
  ticker: string;
  isTickerSymbol?: boolean;
  height?: number;
  title?: string;
  /** Show the draggable date-range bar below the chart (default true). */
  showRange?: boolean;
}

/**
 * Standalone daily-volume chart (bars colored up green / down red by the day's
 * direction), broken out of the price chart so volume can be read on its own larger
 * scale. Reads the same `usePrices` data as PriceChart.
 */
export const VolumeChart = memo(function VolumeChart({
  ticker,
  isTickerSymbol = false,
  height = 220,
  title = 'Volume',
  showRange = true,
}: VolumeChartProps) {
  const chartRef = useRef<ChartJS<'bar'>>(null);
  const { data, isLoading } = usePrices(ticker, { isTickerSymbol });
  const prices = useMemo(() => data?.prices ?? [], [data?.prices]);

  // Date-range brush: [start, end] as 0–1 fractions of the full history.
  const [range, setRange] = useState<[number, number]>([0, 1]);
  const visible = useMemo(() => {
    const n = prices.length;
    if (n === 0) return prices;
    const a = Math.floor(range[0] * n);
    const b = Math.max(a + 1, Math.ceil(range[1] * n));
    return prices.slice(a, b);
  }, [prices, range]);

  const handleExport = useCallback(async () => {
    await exportChartJsAsPng(chartRef, title, undefined, title);
  }, [title]);

  const chartData = useMemo(() => {
    const labels = visible.map((p) => p.date);
    const values = visible.map((p) => p.volume);
    const colors = visible.map((p) => (p.close >= p.open ? '#10b981' : '#ef4444'));
    return {
      labels,
      datasets: [
        {
          label: 'Volume',
          data: values,
          backgroundColor: colors,
          borderColor: colors,
          borderWidth: 0,
          barPercentage: 1,
          categoryPercentage: 1,
        },
      ],
    };
  }, [visible]);

  const options = useMemo<ChartOptions<'bar'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c) => formatNumberCompact(Number(c.parsed.y)) + ' sh',
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 10 }, color: '#475569', maxTicksLimit: 10, autoSkip: true },
        },
        y: {
          beginAtZero: true,
          grid: { color: '#f1f5f9' },
          ticks: { font: { size: 10 }, color: '#475569', callback: (v) => formatNumberCompact(Number(v)) },
        },
      },
    }),
    []
  );

  const hasData = prices.length > 0;
  const rangeLabel =
    visible.length > 0 ? `${formatDate(visible[0].date)} – ${formatDate(visible[visible.length - 1].date)}` : '';

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-baseline gap-2">
          <h4 className="text-sm font-semibold text-ink">{title}</h4>
          {hasData && <span className="text-xs text-ink-muted tabular-nums">{rangeLabel}</span>}
        </div>
        {hasData && !isLoading && <ExportButton onExport={handleExport} />}
      </div>
      <div style={{ height }}>
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-ink-faint text-sm">Loading…</div>
        ) : !hasData ? (
          <div className="flex items-center justify-center h-full text-ink-faint text-sm">No volume data</div>
        ) : (
          <Bar ref={chartRef} data={chartData} options={options} />
        )}
      </div>
      {/* Draggable date-range bar with handles. */}
      {hasData && showRange && (
        <div className="mt-2">
          <RangeBar
            rangeStart={range[0]}
            rangeEnd={range[1]}
            onRangeChange={(s, e) => setRange([s, e])}
          />
        </div>
      )}
    </div>
  );
});
