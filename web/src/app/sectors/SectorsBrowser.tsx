'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card } from '@/components/Card';
import { SegmentedControl } from '@/components/SegmentedControl';
import { MultiLineChart, type MultiLineSeries } from '@/components/charts/MultiLineChart';
import { formatCurrency, formatPercentRaw, formatRatio, formatPercent } from '@/lib/formatters';

// ---------------------------------------------------------------------------
// Types + fetching
// ---------------------------------------------------------------------------

interface SectorRow {
  sector: string;
  n: number;
  pct_profitable: number | null; // share of members with positive EPS (0-100)
  total_mktcap: number;
  weight: number; // % of (filtered) universe market cap
  median_mktcap: number;
  pe: number | null;
  ps: number | null;
  pb: number | null;
  net_margin: number | null;
  roe: number | null;
  sales_g_ttm: number | null;
}

interface SectorWeights {
  asof: string | null;
  sectors: string[];
  series: Record<string, number | string>[]; // { date, <sector>: weight }
}

type Floor = '0' | '1e9' | '1e10';
const FLOORS: { value: Floor; label: string }[] = [
  { value: '0', label: 'All' },
  { value: '1e9', label: '≥ $1B' },
  { value: '1e10', label: '≥ $10B' },
];

async function fetchOverview(minMktcap: Floor): Promise<SectorRow[]> {
  const res = await api.get('/sectors/overview', { params: { min_mktcap: Number(minMktcap) } });
  return res.data?.sectors ?? [];
}

async function fetchSp500Sectors(): Promise<SectorWeights> {
  const res = await api.get('/sp500/sectors');
  return res.data;
}

// Cap-weighted aggregate columns in the cross-section table.
const METRIC_COLS: { key: keyof SectorRow; label: string; fmt: (v: number | null) => string }[] = [
  { key: 'pe', label: 'P/E', fmt: (v) => formatRatio(v) },
  { key: 'ps', label: 'P/S', fmt: (v) => formatRatio(v) },
  { key: 'pb', label: 'P/B', fmt: (v) => formatRatio(v) },
  { key: 'net_margin', label: 'Net margin', fmt: (v) => formatPercent(v) },
  { key: 'roe', label: 'ROE', fmt: (v) => formatPercent(v) },
  { key: 'sales_g_ttm', label: 'Sales growth', fmt: (v) => formatPercent(v) },
  { key: 'pct_profitable', label: '% profitable', fmt: (v) => (v == null ? '—' : formatPercentRaw(v)) },
];

// ---------------------------------------------------------------------------

export function SectorsBrowser() {
  const [floor, setFloor] = useState<Floor>('1e9');
  const { data: overview, isLoading } = useQuery({
    queryKey: ['sectors-overview', floor],
    queryFn: () => fetchOverview(floor),
    staleTime: 30 * 60 * 1000,
  });
  const { data: sp500Sectors, isLoading: weightsLoading } = useQuery({
    queryKey: ['sp500-sectors'],
    queryFn: fetchSp500Sectors,
    staleTime: 30 * 60 * 1000,
  });

  const [sortKey, setSortKey] = useState<keyof SectorRow>('total_mktcap');
  const rows = useMemo(() => {
    const r = [...(overview ?? [])];
    r.sort((a, b) => {
      const av = a[sortKey] as number;
      const bv = b[sortKey] as number;
      if (av == null) return 1;
      if (bv == null) return -1;
      return bv - av;
    });
    return r;
  }, [overview, sortKey]);

  const maxWeight = useMemo(
    () => Math.max(1, ...(overview ?? []).map((r) => r.weight)),
    [overview]
  );

  const weightSeries = useMemo<MultiLineSeries[]>(() => {
    if (!sp500Sectors) return [];
    return sp500Sectors.sectors.map((sec) => ({
      label: sec,
      points: sp500Sectors.series
        .filter((p) => p[sec] != null)
        .map((p) => ({ date: String(p.date), value: Number(p[sec]) })),
    }));
  }, [sp500Sectors]);

  return (
    <div className="max-w-[1200px] mx-auto py-10 px-5 md:py-12 md:px-6">
      <div className="mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-ink tracking-tight">Sectors</h1>
        <p className="text-ink-muted mt-1 max-w-3xl">
          The equity universe by sector — size, breadth, and <strong>cap-weighted</strong>{' '}
          valuation/quality — plus how the S&amp;P 500&apos;s sector mix has rotated over time.
        </p>
      </div>

      {/* S&P 500 sector weights over time */}
      <Card className="mb-6">
        <h2 className="text-lg font-bold text-ink mb-1">S&amp;P 500 sector mix over time</h2>
        <p className="text-sm text-ink-muted mb-4 max-w-3xl">
          Each sector&apos;s share of S&amp;P 500 market cap, point-in-time from Dec 1998 — the
          Technology re-rating, Financials&apos; 2008 collapse, Energy&apos;s long decline. Click a
          legend entry to hide/show it.
          {sp500Sectors?.asof && (
            <span className="text-ink-light"> · through {sp500Sectors.asof}</span>
          )}
        </p>
        <p className="text-xs text-ink-light mb-4 max-w-3xl">
          Caveat: sector labels are today&apos;s GICS-style classification applied backward
          (the data carries no historical sector), so pre-2018 history doesn&apos;t reflect
          reclassifications like the 2018 Communication Services reshuffle.
        </p>
        <MultiLineChart
          series={weightSeries}
          height={400}
          yAxisLabel="% of S&P 500 market cap"
          yFormat={(v) => `${v.toFixed(0)}%`}
          isLoading={weightsLoading}
        />
      </Card>

      {/* Cross-section: universe weight bars + size floor (governs the table too) */}
      <Card className="mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-1">
          <h2 className="text-lg font-bold text-ink">Universe weight by sector</h2>
          <div>
            <span className="block text-[0.6875rem] uppercase text-ink-light mb-1 text-right">Size floor</span>
            <SegmentedControl<Floor>
              value={floor}
              onChange={setFloor}
              options={FLOORS.map((f) => ({ value: f.value, label: f.label }))}
            />
          </div>
        </div>
        <p className="text-sm text-ink-muted mb-4 max-w-3xl">
          Share of total market cap across the covered equity universe (not just the S&amp;P
          500). The <strong>size floor</strong> trims the micro-cap tail — it governs the
          cross-section table below too.
        </p>
        {isLoading ? (
          <div className="h-40 flex items-center justify-center text-ink-muted">Loading…</div>
        ) : (
          <div className="flex flex-col gap-2">
            {[...(overview ?? [])]
              .sort((a, b) => b.weight - a.weight)
              .map((r) => (
                <div key={r.sector} className="flex items-center gap-3">
                  <span className="w-44 shrink-0 text-sm text-ink truncate">{r.sector}</span>
                  <div className="flex-1 bg-surface rounded h-5 overflow-hidden">
                    <div
                      className="h-full bg-green/80 rounded"
                      style={{ width: `${(r.weight / maxWeight) * 100}%` }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right text-sm tabular-nums text-ink-muted">
                    {formatPercentRaw(r.weight)}
                  </span>
                </div>
              ))}
          </div>
        )}
      </Card>

      {/* Cross-section table */}
      <Card>
        <h2 className="text-lg font-bold text-ink mb-1">Sector cross-section</h2>
        <p className="text-sm text-ink-muted mb-4 max-w-3xl">
          <strong>Cap-weighted</strong> valuation &amp; quality per sector (multiples via the
          earnings-yield identity, so loss-makers net in rather than distort; margins/growth are
          cap-weighted, winsorised against near-zero-denominator outliers). Currency-safe — it
          aggregates ratios, not mixed-currency dollar sums. Click a column header to sort.
        </p>
        <div className="overflow-x-auto -mx-6 px-6">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="text-xs font-bold uppercase text-ink-light bg-surface-warm px-3 py-2 text-left border-b border-rule">
                  Sector
                </th>
                {(
                  [
                    { key: 'n', label: '#' },
                    { key: 'total_mktcap', label: 'Total cap' },
                  ] as { key: keyof SectorRow; label: string }[]
                ).map((c) => (
                  <th
                    key={c.key}
                    onClick={() => setSortKey(c.key)}
                    className="text-xs font-bold uppercase text-ink-light bg-surface-warm px-3 py-2 text-right border-b border-rule cursor-pointer hover:text-ink"
                  >
                    {c.label}
                  </th>
                ))}
                {METRIC_COLS.map((c) => (
                  <th
                    key={c.key}
                    onClick={() => setSortKey(c.key)}
                    className="text-xs font-bold uppercase text-ink-light bg-surface-warm px-3 py-2 text-right border-b border-rule cursor-pointer hover:text-ink"
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sector} className="border-b border-rule-light hover:bg-surface">
                  <td className="px-3 py-2 font-medium text-ink">
                    <Link
                      href={`/filter?sector=${encodeURIComponent(r.sector)}`}
                      className="text-green hover:text-green-dark no-underline"
                    >
                      {r.sector}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{r.n}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink">
                    {formatCurrency(r.total_mktcap)}
                  </td>
                  {METRIC_COLS.map((c) => (
                    <td key={c.key} className="px-3 py-2 text-right tabular-nums text-ink">
                      {c.fmt(r[c.key] as number | null)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
