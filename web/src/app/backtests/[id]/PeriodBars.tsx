'use client';

import { useMemo } from 'react';
import type { ChartOptions } from 'chart.js';
import { Bar } from 'react-chartjs-2';
// Importing chart-utils registers the Chart.js components (side effect).
import '@/lib/chart-utils';
import type { BacktestPeriod } from '@/hooks/useBacktests';

interface Props {
  periods: BacktestPeriod[];
  benchmark: string;
  height?: number;
}

/** Per-period (or per-cohort) return: strategy vs benchmark vs universe, grouped bars. */
export function PeriodBars({ periods, benchmark, height = 300 }: Props) {
  const data = useMemo(() => {
    const labels = periods.map((p) => p.start);
    const v = (x: number | null | undefined) => (x == null ? null : x * 100);
    return {
      labels,
      datasets: [
        { label: 'Strategy', data: periods.map((p) => v(p.ret_net)), backgroundColor: '#111111' },
        { label: benchmark, data: periods.map((p) => v(p.bench_ret)), backgroundColor: '#94a3b8' },
        { label: 'Universe (EW)', data: periods.map((p) => v(p.universe_ret)), backgroundColor: '#93c5fd' },
      ],
    };
  }, [periods, benchmark]);

  const options = useMemo<ChartOptions<'bar'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (c) => `${c.dataset.label}: ${c.parsed.y == null ? '—' : `${Number(c.parsed.y).toFixed(1)}%`}`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#475569' } },
        y: {
          grid: { color: '#f1f5f9' },
          ticks: { font: { size: 10 }, color: '#475569', callback: (v) => `${v}%` },
        },
      },
    }),
    []
  );

  if (!periods.length) {
    return <div className="flex items-center justify-center text-sm text-ink-faint" style={{ height }}>No periods</div>;
  }
  return (
    <div style={{ height }}>
      <Bar data={data} options={options} />
    </div>
  );
}
