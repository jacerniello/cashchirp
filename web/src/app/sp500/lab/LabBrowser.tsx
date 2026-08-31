'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card } from '@/components/Card';
import { SegmentedControl } from '@/components/SegmentedControl';
import { MultiLineChart, type MultiLineSeries } from '@/components/charts/MultiLineChart';
import { formatPercent, formatPercentSigned, formatRatio } from '@/lib/formatters';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Company {
  permaticker: number;
  ticker: string;
  name: string;
  sector: string;
}
interface LabOptions {
  sectors: string[];
  companies: Company[];
  all_members: Company[];
  start: string | null;
  end: string | null;
}
interface Stat {
  total_return: number;
  cagr: number | null;
  vol: number | null;
  max_drawdown: number;
  sharpe_naive: number | null;
  best_month: number;
  worst_month: number;
  n_months: number;
}
interface Backtest {
  baseline: { date: string; level: number }[];
  scenario: { date: string; level: number }[];
  removed: { date: string; level: number }[];
  gap: { date: string; pct: number }[];
  stats: { baseline?: Stat; scenario?: Stat; removed?: Stat };
  excluded: Company[];
  n_excluded: number;
}

type Weighting = 'cap' | 'equal';
type View = 'levels' | 'gap';

const MAG7 = ['NVDA', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA'];
const RANGES: { label: string; start: string }[] = [
  { label: 'All', start: '1900-01-01' },
  { label: '2010', start: '2010-01-01' },
  { label: '2015', start: '2015-01-01' },
  { label: '2020', start: '2020-01-01' },
];

// Month grid (YYYY-MM-01) between two dates, inclusive — drives the range bars.
function monthsBetween(start?: string | null, end?: string | null): string[] {
  if (!start || !end) return [];
  const e = new Date(`${end}T00:00:00`);
  const d = new Date(`${start.slice(0, 7)}-01T00:00:00`);
  const out: string[] = [];
  while (d <= e) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

function monthLabel(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// ---------------------------------------------------------------------------

export function LabBrowser() {
  const { data: opts } = useQuery<LabOptions>({
    queryKey: ['lab-options'],
    queryFn: async () => (await api.get('/sp500/lab/options')).data,
    staleTime: 30 * 60 * 1000,
  });

  const [weighting, setWeighting] = useState<Weighting>('cap');
  const [view, setView] = useState<View>('levels');
  const [excludedSectors, setExcludedSectors] = useState<Set<string>>(new Set());
  const [excludedTickers, setExcludedTickers] = useState<Set<number>>(new Set());
  const [companyFilter, setCompanyFilter] = useState('');

  // Time horizon: two bars (start + end handles) over the available month grid.
  const months = useMemo(() => monthsBetween(opts?.start, opts?.end), [opts?.start, opts?.end]);
  const [startIdx, setStartIdx] = useState(0);
  const [endIdx, setEndIdx] = useState(0);
  // Default to the full window once the options load.
  useEffect(() => {
    if (months.length) {
      setStartIdx(0);
      setEndIdx(months.length - 1);
    }
  }, [months.length]);

  const start = months[startIdx] ?? null;
  const end = months[endIdx] ?? null;
  const setStartSafe = (i: number) => setStartIdx(Math.min(i, endIdx - 1 < 0 ? i : endIdx - 1));
  const setEndSafe = (i: number) => setEndIdx(Math.max(i, startIdx + 1));
  const jumpToPreset = (presetStart: string) => {
    if (!months.length) return;
    let i = months.findIndex((m) => m >= presetStart);
    if (i < 0) i = 0;
    setStartIdx(Math.min(i, months.length - 2));
    setEndIdx(months.length - 1);
  };

  const sectorList = useMemo(() => [...(excludedSectors)], [excludedSectors]);
  const tickerList = useMemo(() => [...(excludedTickers)], [excludedTickers]);

  const { data: bt, isFetching } = useQuery<Backtest>({
    queryKey: ['lab-backtest', weighting, sectorList.sort().join(','), tickerList.sort().join(','), start, end],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('weighting', weighting);
      sectorList.forEach((s) => params.append('exclude_sectors', s));
      tickerList.forEach((t) => params.append('exclude_tickers', String(t)));
      if (start) params.set('start', start);
      if (end) params.set('end', end);
      return (await api.get(`/sp500/lab/backtest?${params.toString()}`)).data;
    },
    enabled: months.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 10 * 60 * 1000,
  });

  const hasExclusion = sectorList.length > 0 || tickerList.length > 0;

  const series = useMemo<MultiLineSeries[]>(() => {
    if (!bt) return [];
    const out: MultiLineSeries[] = [
      { label: 'S&P 500 (full)', color: '#94a3b8', points: bt.baseline.map((p) => ({ date: p.date, value: p.level })) },
    ];
    if (hasExclusion && bt.scenario.length) {
      out.push({ label: 'Scenario (ex-removed)', color: '#14b8a6', points: bt.scenario.map((p) => ({ date: p.date, value: p.level })) });
      out.push({ label: 'Removed sleeve', color: '#f59e0b', points: bt.removed.map((p) => ({ date: p.date, value: p.level })) });
    }
    return out;
  }, [bt, hasExclusion]);

  const gapSeries = useMemo<MultiLineSeries[]>(() => {
    if (!bt?.gap?.length) return [];
    return [{
      label: 'Full − scenario (cumulative %)',
      color: '#7c3aed',
      points: bt.gap.map((p) => ({ date: p.date, value: p.pct })),
    }];
  }, [bt]);

  const toggleSector = (s: string) =>
    setExcludedSectors((prev) => {
      const n = new Set(prev);
      n.has(s) ? n.delete(s) : n.add(s);
      return n;
    });
  const toggleTicker = (pt: number) =>
    setExcludedTickers((prev) => {
      const n = new Set(prev);
      n.has(pt) ? n.delete(pt) : n.add(pt);
      return n;
    });
  const applyMag7 = () => {
    const pts = (opts?.companies ?? []).filter((c) => MAG7.includes(c.ticker)).map((c) => c.permaticker);
    setExcludedTickers((prev) => {
      const allOn = pts.every((p) => prev.has(p));
      const n = new Set(prev);
      pts.forEach((p) => (allOn ? n.delete(p) : n.add(p)));
      return n;
    });
  };
  const reset = () => {
    setExcludedSectors(new Set());
    setExcludedTickers(new Set());
  };

  // Default view = today's largest constituents; once you type, search ALL ever-members
  // (so you can remove names that mattered historically, not just today's winners).
  const companies = useMemo(() => {
    const f = companyFilter.trim().toLowerCase();
    if (!f) return opts?.companies ?? [];
    return (opts?.all_members ?? [])
      .filter((c) => c.ticker.toLowerCase().includes(f) || c.name.toLowerCase().includes(f))
      .slice(0, 80);
  }, [opts, companyFilter]);

  const base = bt?.stats.baseline;
  const scen = bt?.stats.scenario;
  const deltaCagr =
    base?.cagr != null && scen?.cagr != null ? scen.cagr - base.cagr : null;

  return (
    <div className="max-w-[1200px] mx-auto py-10 px-5 md:py-12 md:px-6">
      <div className="mb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl md:text-3xl font-bold text-ink tracking-tight">S&amp;P 500 Index Lab</h1>
          <Link href="/sp500" className="text-sm text-green hover:text-green-dark no-underline">
            ← Concentration
          </Link>
        </div>
        <p className="text-ink-muted mt-1 max-w-3xl">
          Remove any companies or sectors and re-run the index on the survivors — weights
          renormalised each month. A faithful cap-weighted total-return reconstruction (full-cap,
          quarterly membership; ~0.96 monthly correlation with SPY). The scenario-vs-baseline gap
          is what matters: the methodology bias cancels.
        </p>
        <p className="text-xs text-ink-light mt-2 max-w-3xl">
          Mind the hindsight: removing today&apos;s winners (e.g. the Mag-7) is partly
          tautological — they&apos;re today&apos;s giants <em>because</em> they rose, and they
          weren&apos;t obvious in 2010. Search the picker to remove names that led in earlier eras
          (Cisco, GE, Intel) for a fairer test. The reconstruction is also frictionless — no
          fees, taxes, or rebalancing cost (which most flatters equal-weight).
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        {/* Controls */}
        <div className="flex flex-col gap-4">
          <Card variant="compact">
            <label className="block text-xs font-bold uppercase text-ink-light mb-2">Weighting</label>
            <SegmentedControl<Weighting>
              value={weighting}
              onChange={setWeighting}
              options={[
                { value: 'cap', label: 'Cap-weighted' },
                { value: 'equal', label: 'Equal-weighted' },
              ]}
            />
            <div className="flex items-center justify-between mt-4 mb-2">
              <label className="text-xs font-bold uppercase text-ink-light">Time horizon</label>
              <span className="text-xs font-semibold text-ink tabular-nums">
                {monthLabel(start ?? undefined)} → {monthLabel(end ?? undefined)}
              </span>
            </div>
            {/* Two bars: drag the start and end handles to set the period. */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="w-8 shrink-0 text-[0.6875rem] uppercase text-ink-light">Start</span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, months.length - 1)}
                  value={startIdx}
                  onChange={(e) => setStartSafe(Number(e.target.value))}
                  className="flex-1 accent-green cursor-pointer"
                  aria-label="Start month"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="w-8 shrink-0 text-[0.6875rem] uppercase text-ink-light">End</span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, months.length - 1)}
                  value={endIdx}
                  onChange={(e) => setEndSafe(Number(e.target.value))}
                  className="flex-1 accent-green cursor-pointer"
                  aria-label="End month"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {RANGES.map((r) => (
                <button
                  key={r.label}
                  type="button"
                  onClick={() => jumpToPreset(r.start)}
                  className="px-2.5 py-1 text-xs rounded-md border border-rule text-ink-muted hover:bg-surface transition-colors"
                >
                  {r.label}
                </button>
              ))}
            </div>
          </Card>

          <Card variant="compact">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold uppercase text-ink-light">Remove sectors</label>
              {hasExclusion && (
                <button type="button" onClick={reset} className="text-xs text-green hover:text-green-dark">
                  Reset all
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(opts?.sectors ?? []).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleSector(s)}
                  className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                    excludedSectors.has(s) ? 'bg-red-500 text-white border-red-500' : 'border-rule text-ink-muted hover:bg-surface'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </Card>

          <Card variant="compact">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold uppercase text-ink-light">Remove companies</label>
              <button type="button" onClick={applyMag7} className="text-xs text-green hover:text-green-dark">
                Toggle Mag 7
              </button>
            </div>
            <input
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
              placeholder="Search all ever-members (e.g. CSCO, GE)…"
              className="w-full mb-2 px-3 py-1.5 text-sm border border-rule rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-green"
            />
            <div className="max-h-64 overflow-y-auto flex flex-col gap-0.5 pr-1">
              {companies.map((c) => (
                <label
                  key={c.permaticker}
                  className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface cursor-pointer text-sm"
                >
                  <input
                    type="checkbox"
                    checked={excludedTickers.has(c.permaticker)}
                    onChange={() => toggleTicker(c.permaticker)}
                    className="accent-red-500"
                  />
                  <span className="font-semibold text-ink w-16 shrink-0">{c.ticker}</span>
                  <span className="text-ink-muted truncate">{c.name}</span>
                </label>
              ))}
            </div>
          </Card>
        </div>

        {/* Results */}
        <div className="flex flex-col gap-6">
          {/* Headline */}
          {hasExclusion && deltaCagr != null && (
            <Card variant="compact" className="bg-surface-warm">
              <p className="text-sm text-ink">
                Removing <strong>{bt?.n_excluded}</strong> name{bt?.n_excluded === 1 ? '' : 's'}{' '}
                {deltaCagr >= 0 ? (
                  <>
                    <strong className="text-green">added</strong> {formatPercentSigned(deltaCagr)}/yr
                  </>
                ) : (
                  <>
                    <strong className="text-red-600">cost</strong> {formatPercentSigned(deltaCagr)}/yr
                  </>
                )}{' '}
                to the {weighting === 'cap' ? 'cap-weighted' : 'equal-weighted'} index&apos;s CAGR over
                this window.
              </p>
            </Card>
          )}

          <Card>
            {hasExclusion && (
              <div className="mb-3">
                <SegmentedControl<View>
                  value={view}
                  onChange={setView}
                  options={[
                    { value: 'levels', label: 'Cumulative levels' },
                    { value: 'gap', label: 'Gap over time' },
                  ]}
                />
              </div>
            )}
            <div className="flex items-start justify-between gap-4 flex-wrap mb-1">
              <h2 className="text-lg font-bold text-ink">
                {view === 'gap' && hasExclusion
                  ? 'Cumulative gap (full − scenario)'
                  : 'Cumulative performance (rebased to 100)'}
              </h2>
              {base && (
                <div className="flex items-center gap-4 text-right">
                  <div>
                    <div className="text-[0.6875rem] uppercase text-ink-light">Full · return</div>
                    <div className={`text-lg font-bold tabular-nums ${base.total_return >= 0 ? 'text-green' : 'text-red-600'}`}>
                      {formatPercentSigned(base.total_return)}
                    </div>
                  </div>
                  {hasExclusion && scen && (
                    <div>
                      <div className="text-[0.6875rem] uppercase text-ink-light">Scenario · return</div>
                      <div className={`text-lg font-bold tabular-nums ${scen.total_return >= 0 ? 'text-green' : 'text-red-600'}`}>
                        {formatPercentSigned(scen.total_return)}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <p className="text-sm text-ink-muted mb-4">
              {view === 'gap' && hasExclusion ? (
                <>How far the full index has pulled ahead of (or behind) the ex-removed scenario,
                  cumulatively — the running contribution of the removed names. Above 0 = the
                  removed set lifted the index.</>
              ) : (
                <>Total return (price + dividends) over {monthLabel(start ?? undefined)}–
                  {monthLabel(end ?? undefined)}. Click a legend entry to hide/show it.</>
              )}
            </p>
            <MultiLineChart
              series={view === 'gap' && hasExclusion ? gapSeries : series}
              height={400}
              yAxisLabel={view === 'gap' && hasExclusion ? 'cumulative gap %' : 'rebased to 100'}
              yFormat={(v) => (view === 'gap' && hasExclusion ? `${v.toFixed(0)}%` : v.toFixed(0))}
              isLoading={isFetching && !bt}
            />
          </Card>

          {/* Stats table */}
          <Card>
            <h2 className="text-lg font-bold text-ink mb-4">Performance &amp; risk</h2>
            <div className="overflow-x-auto -mx-6 px-6">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    {['Metric', 'S&P 500 (full)', hasExclusion ? 'Scenario' : '', hasExclusion ? 'Removed' : '']
                      .filter(Boolean)
                      .map((h) => (
                        <th
                          key={h}
                          className={`text-xs font-bold uppercase text-ink-light bg-surface-warm px-3 py-2 border-b border-rule ${
                            h === 'Metric' ? 'text-left' : 'text-right'
                          }`}
                        >
                          {h}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ['Total return', (s: Stat) => formatPercent(s.total_return)],
                      ['CAGR', (s: Stat) => (s.cagr == null ? '—' : formatPercent(s.cagr))],
                      ['Volatility (ann.)', (s: Stat) => (s.vol == null ? '—' : formatPercent(s.vol))],
                      ['Max drawdown', (s: Stat) => formatPercent(s.max_drawdown)],
                      ['Return/vol', (s: Stat) => (s.sharpe_naive == null ? '—' : formatRatio(s.sharpe_naive))],
                      ['Best month', (s: Stat) => formatPercentSigned(s.best_month)],
                      ['Worst month', (s: Stat) => formatPercentSigned(s.worst_month)],
                    ] as [string, (s: Stat) => string][]
                  ).map(([label, fmt]) => (
                    <tr key={label} className="border-b border-rule-light">
                      <td className="px-3 py-2 text-ink-muted">{label}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink">
                        {base ? fmt(base) : '—'}
                      </td>
                      {hasExclusion && (
                        <td className="px-3 py-2 text-right tabular-nums text-ink font-medium">
                          {scen ? fmt(scen) : '—'}
                        </td>
                      )}
                      {hasExclusion && (
                        <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                          {bt?.stats.removed ? fmt(bt.stats.removed) : '—'}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Excluded chips */}
          {hasExclusion && (bt?.excluded.length ?? 0) > 0 && (
            <Card variant="compact">
              <div className="text-xs font-bold uppercase text-ink-light mb-2">
                Removed ({bt?.excluded.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {bt?.excluded.slice(0, 80).map((c) => (
                  <span key={c.permaticker} className="px-2 py-0.5 text-xs rounded-full bg-surface text-ink-muted border border-rule">
                    {c.ticker}
                  </span>
                ))}
                {(bt?.excluded.length ?? 0) > 80 && (
                  <span className="px-2 py-0.5 text-xs text-ink-light">+{(bt?.excluded.length ?? 0) - 80} more</span>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
