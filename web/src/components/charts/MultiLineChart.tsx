'use client';

import { memo, useMemo, useRef, useCallback, useState } from 'react';
import Link from 'next/link';
import type { Chart as ChartJS, ChartOptions } from 'chart.js';
import { Line } from 'react-chartjs-2';
// Importing from chart-utils also runs registerChartComponents() (side effect).
import { MULTI_SERIES_COLORS } from '@/lib/chart-utils';
import { exportChartJsAsPng } from '@/lib/chart-export';
import { ExportButton } from './ExportButton';

export interface MultiLineSeries {
  label: string;
  points: { date: string; value: number }[];
  color?: string;
  /** If set, the legend entry links here (e.g. /insider/<owner_id>). */
  href?: string;
}

interface MultiLineChartProps {
  series: MultiLineSeries[];
  title?: string;
  yAxisLabel?: string;
  height?: number;
  /** Step the line (holdings carry forward flat between trades). */
  stepped?: boolean;
  /** Tooltip / y-tick formatter. */
  yFormat?: (v: number) => string;
  isLoading?: boolean;
}

/**
 * Multi-series line chart on Chart.js (react-chartjs-2) with a custom legend whose
 * entries can deep-link (e.g. each insider's name → their people page). Used for the
 * Company → Insiders "holdings over time, line per insider" chart.
 */
export const MultiLineChart = memo(function MultiLineChart({
  series,
  title,
  yAxisLabel,
  height = 360,
  stepped = false,
  yFormat = (v) => v.toLocaleString(),
  isLoading = false,
}: MultiLineChartProps) {
  const chartRef = useRef<ChartJS<'line'>>(null);
  // Legend entries toggle their line's visibility on click (Chart.js-style).
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggle = useCallback((label: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);

  const handleExport = useCallback(async () => {
    await exportChartJsAsPng(chartRef, title || 'chart', undefined, title);
  }, [title]);

  const colored = useMemo(
    () => series.map((s, i) => ({ ...s, color: s.color ?? MULTI_SERIES_COLORS[i % MULTI_SERIES_COLORS.length] })),
    [series]
  );

  const { labels, datasets } = useMemo(() => {
    const dateSet = new Set<string>();
    for (const s of colored) for (const p of s.points) dateSet.add(p.date);
    const allDates = Array.from(dateSet).sort();
    const datasets = colored.map((s) => {
      const byDate = new Map(s.points.map((p) => [p.date, p.value]));
      return {
        label: s.label,
        data: allDates.map((d) => (byDate.has(d) ? byDate.get(d)! : null)),
        borderColor: s.color,
        backgroundColor: s.color,
        borderWidth: 1.5,
        pointRadius: 0,
        pointHoverRadius: 3,
        tension: 0,
        stepped: stepped ? ('before' as const) : false,
        spanGaps: true,
        fill: false,
        hidden: hidden.has(s.label),
      };
    });
    return { labels: allDates, datasets };
  }, [colored, stepped, hidden]);

  const options = useMemo<ChartOptions<'line'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c) => `${c.dataset.label}: ${c.parsed.y == null ? '-' : yFormat(Number(c.parsed.y))}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 10 }, color: '#475569', maxTicksLimit: 8, autoSkip: true },
        },
        y: {
          grid: { color: '#f1f5f9' },
          ticks: { font: { size: 10 }, color: '#475569', callback: (v) => yFormat(Number(v)) },
          title: yAxisLabel ? { display: true, text: yAxisLabel, color: '#475569' } : undefined,
        },
      },
    }),
    [yFormat, yAxisLabel]
  );

  const hasData = colored.some((s) => s.points.length > 0);

  return (
    <div>
      {(title || hasData) && (
        <div className="flex items-center justify-between mb-2">
          {title ? <h4 className="text-sm font-semibold text-ink">{title}</h4> : <span />}
          {hasData && !isLoading && <ExportButton onExport={handleExport} />}
        </div>
      )}
      <div style={{ height }}>
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-ink-faint text-sm">Loading…</div>
        ) : !hasData ? (
          <div className="flex items-center justify-center h-full text-ink-faint text-sm">No data</div>
        ) : (
          <Line ref={chartRef} data={{ labels, datasets }} options={options} />
        )}
      </div>
      {/* Custom legend — click an entry to hide/show its line; any deep-link
          (e.g. an insider's page) stays reachable via the ↗ next to the name. */}
      {hasData && (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
          {colored.map((s) => {
            const off = hidden.has(s.label);
            return (
              <span key={s.label} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => toggle(s.label)}
                  title={off ? 'Show' : 'Hide'}
                  className={`flex items-center gap-1.5 bg-transparent border-none cursor-pointer p-0 transition-opacity ${off ? 'opacity-40' : 'hover:opacity-70'}`}
                >
                  <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
                  <span className={`text-xs text-ink-light ${off ? 'line-through' : ''}`}>{s.label}</span>
                </button>
                {s.href && (
                  <Link href={s.href} title={`Go to ${s.label}`} className="text-xs text-ink-faint no-underline hover:text-green">↗</Link>
                )}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
});
