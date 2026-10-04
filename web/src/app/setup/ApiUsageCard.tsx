'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ChartOptions } from 'chart.js';
import { Line } from 'react-chartjs-2';
import api from '@/lib/api';
// Importing from chart-utils also registers Chart.js components, including the time scale.
import { getLineChartOptions } from '@/lib/chart-utils';

// Nasdaq Data Link API usage, from the x-ratelimit-* headers the backend records on every
// call (at most one reading a minute) plus a tiny probe every 30 minutes. The headers do
// not say how long the window is; a drop in "used" is a reset, and those are listed.

type Period = '24h' | '7d' | '30d';

interface UsagePoint { t: string; used: number; limit: number }
interface RateLimits {
  latest: { sampled_at: string; limit: number; remaining: number; used: number } | null;
  points: UsagePoint[];
  resets: string[];
  bucket: string;
}

const LINE_COLOR = '#111111';
const n = (v: number) => v.toLocaleString();
const ts = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-rule px-4 py-3">
      <div className="text-xs text-ink-faint">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums text-ink">{value}</div>
      {sub && <div className="text-xs text-ink-muted">{sub}</div>}
    </div>
  );
}

export function ApiUsageCard() {
  const [period, setPeriod] = useState<Period>('24h');
  const [showTable, setShowTable] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['setup-rate-limits', period],
    queryFn: async (): Promise<RateLimits> =>
      (await api.get(`/setup/rate-limits?period=${period}`)).data,
    refetchInterval: 60000,
    retry: false,
  });

  const chartData = useMemo(() => ({
    datasets: [{
      label: 'Calls used',
      data: (data?.points ?? []).map((p) => ({ x: new Date(p.t).getTime(), y: p.used })),
      borderColor: LINE_COLOR,
      backgroundColor: LINE_COLOR,
      borderWidth: 2,
      pointRadius: (data?.points.length ?? 0) < 40 ? 3 : 0,
      pointHoverRadius: 5,
      tension: 0,
      fill: false,
    }],
  }), [data]);

  const options = useMemo<ChartOptions<'line'>>(() => {
    const base = getLineChartOptions({ isCurrency: false, maxTicksLimit: 8 });
    return {
      ...base,
      animation: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        ...base.plugins,
        tooltip: {
          callbacks: {
            title: (items) => (items[0]?.parsed.x != null ? ts(new Date(items[0].parsed.x).toISOString()) : ''),
            label: (c) => `${n(Number(c.parsed.y))} calls used`,
          },
        },
      },
      scales: {
        x: {
          type: 'time',
          time: { tooltipFormat: 'PPpp' },
          grid: { display: false },
          ticks: { font: { size: 10 }, color: '#475569', maxTicksLimit: 8 },
        },
        y: {
          beginAtZero: true,
          grid: { color: '#f1f5f9' },
          ticks: { font: { size: 10 }, color: '#475569', callback: (v) => n(Number(v)) },
          title: { display: true, text: 'Calls used', color: '#475569' },
        },
      },
    };
  }, []);

  const latest = data?.latest;
  const pct = latest ? (latest.used / latest.limit) * 100 : null;

  return (
    <div className="rounded-xl border border-rule bg-white p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">Sharadar API usage</h2>
          <p className="mt-1 text-xs text-ink-muted">
            From Nasdaq Data Link&apos;s rate-limit headers.{' '}
            {latest ? `Last reading ${ts(latest.sampled_at)}.` : ''}
          </p>
        </div>
        <div className="flex gap-1" role="group" aria-label="Period">
          {(['24h', '7d', '30d'] as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              aria-pressed={period === p}
              className={`rounded-md border px-2.5 py-1 text-xs cursor-pointer
                ${period === p
                  ? 'border-green bg-green-soft text-green-text font-medium'
                  : 'border-rule bg-white text-ink-light hover:border-green'}`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {isError && (
        <p className="mt-4 text-sm text-ink-light">
          Could not read API usage. Check that the backend is running and the Nasdaq key is set.
        </p>
      )}
      {!isError && !isLoading && !latest && (
        <p className="mt-4 text-sm text-ink-light">
          No readings yet. One is taken on the first API call, and every 30 minutes after.
        </p>
      )}

      {latest && (
        <>
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Used this window" value={n(latest.used)}
                  sub={pct != null ? `${pct < 0.1 ? '<0.1' : pct.toFixed(1)}% of the limit` : undefined} />
            <Stat label="Remaining" value={n(latest.remaining)} />
            <Stat label="Limit" value={n(latest.limit)} sub="calls per window" />
            <Stat label="Resets seen" value={String(data?.resets.length ?? 0)}
                  sub={data?.resets.length ? `last ${ts(data.resets[data.resets.length - 1])}` : `in the last ${period}`} />
          </div>

          <div className="mt-5 h-[220px]">
            {(data?.points.length ?? 0) > 0 ? (
              <Line data={chartData} options={options} aria-label="Calls used over time" />
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-ink-faint">
                No readings in the last {period}.
              </div>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-ink-muted">
            <span>Highest reading per {data?.bucket}. A drop means the window reset.</span>
            <button type="button" onClick={() => setShowTable((v) => !v)}
                    className="underline cursor-pointer bg-transparent border-0 p-0 text-ink-muted">
              {showTable ? 'Hide table' : 'Show table'}
            </button>
          </div>
          {showTable && (
            <div className="mt-2 max-h-56 overflow-y-auto border border-rule rounded-lg">
              <table className="w-full text-xs">
                <thead className="text-left text-ink-faint">
                  <tr><th className="px-3 py-1.5 font-medium">Time</th>
                      <th className="px-3 py-1.5 font-medium text-right">Calls used</th></tr>
                </thead>
                <tbody>
                  {[...(data?.points ?? [])].reverse().map((p) => (
                    <tr key={p.t} className="border-t border-rule">
                      <td className="px-3 py-1.5 text-ink-light">{ts(p.t)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-ink">{n(p.used)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
