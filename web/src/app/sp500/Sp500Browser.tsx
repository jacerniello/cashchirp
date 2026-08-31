'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card } from '@/components/Card';
import { MultiLineChart, type MultiLineSeries } from '@/components/charts/MultiLineChart';
import { formatPercentRaw, formatNumber } from '@/lib/formatters';

// ---------------------------------------------------------------------------
// Types + fetching
// ---------------------------------------------------------------------------

interface ConcPoint {
  date: string;
  n_constituents: number;
  total_mktcap: number;
  hhi: number;
  effective_n: number;
  top1_ticker: string;
  top1_name: string;
  top1_weight: number;
  top3_weight: number;
  top5_weight: number;
  top10_weight: number;
  top25_weight: number;
  top50_weight: number;
}

interface Constituent {
  rank: number;
  permaticker: number;
  ticker: string;
  name: string;
  sector: string;
  marketcap: number;
  weight: number;
}

async function fetchConcentration(): Promise<{ asof: string | null; series: ConcPoint[] }> {
  const res = await api.get('/sp500/concentration');
  return res.data;
}

async function fetchConstituents(): Promise<Constituent[]> {
  const res = await api.get('/sp500/constituents', { params: { limit: 25 } });
  return res.data?.constituents ?? [];
}

// Top-N cap-weight lines (the headline "how concentrated" view).
const TOPN: { key: keyof ConcPoint; label: string }[] = [
  { key: 'top1_weight', label: 'Top 1' },
  { key: 'top3_weight', label: 'Top 3' },
  { key: 'top5_weight', label: 'Top 5' },
  { key: 'top10_weight', label: 'Top 10' },
  { key: 'top25_weight', label: 'Top 25' },
  { key: 'top50_weight', label: 'Top 50' },
];

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card variant="stat" className="flex flex-col gap-1">
      <span className="text-xs font-bold uppercase text-ink-light">{label}</span>
      <span className="text-2xl font-bold text-ink tracking-tight">{value}</span>
      {sub && <span className="text-xs text-ink-muted">{sub}</span>}
    </Card>
  );
}

// ---------------------------------------------------------------------------

export function Sp500Browser() {
  const { data: conc, isLoading } = useQuery({
    queryKey: ['sp500-concentration'],
    queryFn: fetchConcentration,
    staleTime: 30 * 60 * 1000,
  });
  const {
    data: constituents,
    isLoading: loadingTop,
    error: topError,
  } = useQuery({
    queryKey: ['sp500-constituents'],
    queryFn: fetchConstituents,
    staleTime: 30 * 60 * 1000,
  });

  const series = conc?.series ?? [];
  const latest = series.length ? series[series.length - 1] : undefined;

  const weightSeries = useMemo<MultiLineSeries[]>(
    () =>
      TOPN.map((t) => ({
        label: t.label,
        points: series.map((p) => ({ date: p.date, value: p[t.key] as number })),
      })),
    [series]
  );

  const effectiveNSeries = useMemo<MultiLineSeries[]>(
    () => [
      {
        label: 'Effective # of constituents',
        points: series.map((p) => ({ date: p.date, value: p.effective_n })),
        color: '#14b8a6',
      },
    ],
    [series]
  );

  return (
    <div className="max-w-[1200px] mx-auto py-10 px-5 md:py-12 md:px-6">
      <div className="mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-ink tracking-tight">
          S&amp;P 500 Concentration
        </h1>
        <p className="text-ink-muted mt-1 max-w-3xl">
          How top-heavy the index is, point-in-time from 1998. Membership is taken from the
          S&amp;P 500 log as it stood at each quarter-end and weighted by each constituent&apos;s
          market cap on that date. Full-cap weighting (Sharadar carries no float — a close
          proxy for S&amp;P&apos;s float-adjusted weights).
          {conc?.asof && <span className="text-ink-light"> · through {conc.asof}</span>}
        </p>
      </div>

      {/* Headline stats — latest snapshot */}
      {latest && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard
            label="Top 10 weight"
            value={formatPercentRaw(latest.top10_weight)}
            sub={`Top 5: ${formatPercentRaw(latest.top5_weight)} · Top 1: ${formatPercentRaw(latest.top1_weight)}`}
          />
          <StatCard
            label="Largest constituent"
            value={latest.top1_ticker}
            sub={`${formatPercentRaw(latest.top1_weight)} of the index`}
          />
          <StatCard
            label="Effective # names"
            value={formatNumber(latest.effective_n)}
            sub={`of ${latest.n_constituents} (1 / Σ wᵢ²)`}
          />
          <StatCard
            label="HHI"
            value={formatNumber(latest.hhi)}
            sub="Herfindahl points"
          />
        </div>
      )}

      {/* Top-N weight over time */}
      <Card className="mb-6">
        <h2 className="text-lg font-bold text-ink mb-1">Cap-weight of the largest constituents</h2>
        <p className="text-sm text-ink-muted mb-4 max-w-3xl">
          Share of total index market cap held by the top N names. The top 10&apos;s share has
          roughly doubled since the mid-2010s. Click a legend entry to hide/show it.
        </p>
        <MultiLineChart
          series={weightSeries}
          height={380}
          yAxisLabel="% of index market cap"
          yFormat={(v) => `${v.toFixed(0)}%`}
          isLoading={isLoading}
        />
      </Card>

      {/* Effective number of constituents */}
      <Card className="mb-6">
        <h2 className="text-lg font-bold text-ink mb-1">Effective number of constituents</h2>
        <p className="text-sm text-ink-muted mb-4 max-w-3xl">
          1 / Σ wᵢ² — the count of <em>equal-weight</em> names the index behaves like. Lower =
          more concentrated. A 500-stock index acting like ~45 names is historically extreme.
        </p>
        <MultiLineChart
          series={effectiveNSeries}
          height={300}
          yAxisLabel="effective names"
          yFormat={(v) => v.toFixed(0)}
          isLoading={isLoading}
        />
      </Card>

      {/* Current top constituents */}
      <Card>
        <h2 className="text-lg font-bold text-ink mb-4">Largest constituents now</h2>
        <div className="overflow-x-auto -mx-6 px-6">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {['#', 'Ticker', 'Company', 'Sector', 'Weight'].map((h) => (
                  <th
                    key={h}
                    className={`text-xs font-bold uppercase text-ink-light bg-surface-warm px-3 py-2 border-b border-rule ${
                      h === 'Weight' ? 'text-right' : 'text-left'
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingTop &&
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={`sk-${i}`} className="border-b border-rule-light">
                    {[8, 12, 40, 24, 14].map((w, j) => (
                      <td key={j} className="px-3 py-2">
                        <div
                          className="h-3 rounded bg-surface-warm animate-pulse"
                          style={{ width: `${w * 4}px`, marginLeft: j === 4 ? 'auto' : undefined }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}

              {/* An error must not render as an empty table: that reads as "no
                  constituents" when the truth is "we could not ask". */}
              {!loadingTop && topError && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-sm text-ink-faint">
                    Could not load constituents.
                  </td>
                </tr>
              )}

              {!loadingTop && !topError && (constituents ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-sm text-ink-faint">
                    No data
                  </td>
                </tr>
              )}

              {!loadingTop && !topError && (constituents ?? []).map((c) => (
                <tr key={c.permaticker} className="border-b border-rule-light hover:bg-surface">
                  <td className="px-3 py-2 text-ink-muted tabular-nums">{c.rank}</td>
                  <td className="px-3 py-2 font-semibold">
                    <Link
                      href={`/company/${c.permaticker}`}
                      className="text-green hover:text-green-dark no-underline"
                    >
                      {c.ticker}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-ink">{c.name}</td>
                  <td className="px-3 py-2 text-ink-muted">{c.sector}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink">
                    {formatPercentRaw(c.weight)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
