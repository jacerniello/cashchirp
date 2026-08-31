'use client';

import { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card } from '@/components/Card';
import { PriceChart } from '@/components/PriceChart';
import { RebasedLineChart, type RebasedSeries } from './RebasedLineChart';
import {
  COMMODITIES,
  LABEL,
  SPOT,
  LOOKBACKS,
  type Lookback,
} from './commodities-data';

// ---------------------------------------------------------------------------
// Data fetching (shared with usePrices' /prices/ endpoint and /macro/observations)
// ---------------------------------------------------------------------------

interface PricePoint { date: string; adj_close: number }

async function fetchEtf(ticker: string): Promise<PricePoint[]> {
  const res = await api.get(`/prices/?ticker=${encodeURIComponent(ticker)}`);
  const prices = res.data?.prices ?? {};
  return Object.keys(prices)
    .sort()
    .map((d) => ({ date: d, adj_close: prices[d].adj_close }));
}

async function fetchSpot(seriesId: string): Promise<PricePoint[]> {
  const res = await api.get('/macro/observations', { params: { series_id: seriesId } });
  return (res.data?.observations ?? [])
    .filter((o: { value: number | null }) => o.value != null)
    .map((o: { date: string; value: number }) => ({ date: o.date, adj_close: o.value }));
}

// Lookback start date (null = full history).
function startFor(lookback: Lookback): string | null {
  const entry = LOOKBACKS.find((l) => l.label === lookback);
  if (!entry || entry.years == null) return null;
  const d = new Date();
  d.setFullYear(d.getFullYear() - entry.years);
  return d.toISOString().slice(0, 10);
}

function rebase(points: PricePoint[], start: string | null): { date: string; value: number }[] {
  const filtered = start ? points.filter((p) => p.date >= start) : points;
  if (filtered.length === 0) return [];
  const base = filtered[0].adj_close;
  if (!base) return [];
  return filtered.map((p) => ({ date: p.date, value: (p.adj_close / base) * 100 }));
}

const DEFAULT_COMPARE = ['GLD', 'USO', 'DBC'];

// ---------------------------------------------------------------------------

export function CommoditiesBrowser() {
  const [compare, setCompare] = useState<string[]>(DEFAULT_COMPARE);
  const [lookback, setLookback] = useState<Lookback>('5Y');
  const [focus, setFocus] = useState<string>('USO');

  const start = useMemo(() => startFor(lookback), [lookback]);

  // PriceChart's range selector doesn't have a 10Y preset; fall back to ALL there.
  const detailRange: '1Y' | '3Y' | '5Y' | 'ALL' =
    lookback === '1Y' || lookback === '3Y' || lookback === '5Y' ? lookback : 'ALL';

  // Compare: one query per selected ETF.
  const compareQueries = useQueries({
    queries: compare.map((t) => ({
      queryKey: ['commodity-etf', t],
      queryFn: () => fetchEtf(t),
      staleTime: 20 * 60 * 1000,
    })),
  });

  const compareSeries = useMemo<RebasedSeries[]>(() => {
    const out: RebasedSeries[] = [];
    compare.forEach((t, i) => {
      const data = compareQueries[i]?.data;
      if (!data) return;
      const points = rebase(data, start);
      if (points.length) out.push({ label: LABEL[t] ?? t, points });
    });
    return out;
  }, [compare, compareQueries, start]);

  const compareLoading = compareQueries.some((q) => q.isLoading);

  // Focus ETF (for the spot-compare chart; the detail chart uses PriceChart directly).
  const { data: focusEtf, isLoading: focusLoading } = useQuery({
    queryKey: ['commodity-etf', focus],
    queryFn: () => fetchEtf(focus),
    staleTime: 20 * 60 * 1000,
  });

  const spotCode = SPOT[focus];
  const { data: spotData, isLoading: spotLoading } = useQuery({
    queryKey: ['commodity-spot', spotCode],
    queryFn: () => fetchSpot(spotCode as string),
    enabled: !!spotCode,
    staleTime: 20 * 60 * 1000,
  });

  const spotSeries = useMemo<RebasedSeries[]>(() => {
    if (!spotCode || !focusEtf || !spotData) return [];
    const etfPoints = rebase(focusEtf, start);
    const spotPoints = rebase(spotData, start);
    if (!etfPoints.length || !spotPoints.length) return [];
    return [
      { label: `${focus} (ETF)`, points: etfPoints, color: '#14b8a6' },
      { label: `${spotCode} (FRED spot)`, points: spotPoints, color: '#64748b', dashed: true },
    ];
  }, [spotCode, focusEtf, spotData, start, focus]);

  return (
    <div className="max-w-[1200px] mx-auto py-10 px-5 md:py-12 md:px-6">
      <div className="mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-ink tracking-tight">Commodities</h1>
        <p className="text-ink-muted mt-1 max-w-3xl">
          Major commodity ETFs from the Sharadar fund-price mirror (sfp). Rebased compare +
          per-name detail; spot benchmarks link to FRED.
        </p>
      </div>

      {/* Compare controls */}
      <Card variant="compact" className="mb-6">
        <div className="flex flex-col md:flex-row gap-4 md:items-start">
          <div className="flex-1">
            <label className="block text-xs font-bold uppercase text-ink-light mb-2">
              Compare
            </label>
            <div className="flex flex-wrap gap-1.5">
              {COMMODITIES.map((c) => {
                const active = compare.includes(c.ticker);
                return (
                  <button
                    key={c.ticker}
                    type="button"
                    onClick={() =>
                      setCompare((prev) =>
                        prev.includes(c.ticker)
                          ? prev.filter((t) => t !== c.ticker)
                          : [...prev, c.ticker]
                      )
                    }
                    title={c.label}
                    className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                      active
                        ? 'bg-green text-white border-green'
                        : 'border-rule text-ink-muted hover:bg-surface'
                    }`}
                  >
                    {c.ticker}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="md:w-44">
            <label className="block text-xs font-bold uppercase text-ink-light mb-2">
              Lookback
            </label>
            <div className="flex flex-wrap gap-1.5">
              {LOOKBACKS.map((l) => (
                <button
                  key={l.label}
                  type="button"
                  onClick={() => setLookback(l.label)}
                  className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                    lookback === l.label
                      ? 'bg-green text-white border-green'
                      : 'border-rule text-ink-muted hover:bg-surface'
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Rebased compare */}
      <Card className="mb-6">
        <h2 className="text-lg font-bold text-ink mb-4">Relative performance (rebased to 100)</h2>
        {compare.length === 0 ? (
          <div className="h-[320px] flex items-center justify-center text-ink-muted">
            Pick one or more commodities
          </div>
        ) : (
          <RebasedLineChart series={compareSeries} isLoading={compareLoading} />
        )}
      </Card>

      {/* Detail: candlestick + volume */}
      <Card className="mb-6">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
          <h2 className="text-lg font-bold text-ink">Detail</h2>
          <select
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            className="px-3 py-2 text-sm border border-rule rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-green"
          >
            {COMMODITIES.map((c) => (
              <option key={c.ticker} value={c.ticker}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <PriceChart
          key={focus}
          ticker={focus}
          isTickerSymbol
          displayName={LABEL[focus] ?? focus}
          title={LABEL[focus] ?? focus}
          showVolume
          showComparisonSelector={false}
          defaultRange={detailRange}
        />
      </Card>

      {/* ETF vs FRED spot */}
      <Card className="mb-6">
        <h2 className="text-lg font-bold text-ink mb-1">ETF vs FRED spot (rebased to 100)</h2>
        <p className="text-sm text-ink-muted mb-4 max-w-3xl">
          Tradable ETF against the underlying FRED spot price — the gap is the ETF&apos;s
          roll/contango drag and fees. (Gold/silver have no FRED spot, so their ETF is the
          only reference.)
        </p>
        {!spotCode ? (
          <div className="h-[280px] flex items-center justify-center text-center text-ink-muted px-6">
            No FRED spot for {LABEL[focus] ?? focus} — the ETF is the reference.
          </div>
        ) : (
          <RebasedLineChart
            series={spotSeries}
            height={280}
            isLoading={focusLoading || spotLoading}
          />
        )}
      </Card>

      {/* Universe table */}
      <Card>
        <h2 className="text-lg font-bold text-ink mb-4">Universe</h2>
        <div className="overflow-x-auto -mx-6 px-6">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {['Ticker', 'Commodity', 'Group', 'FRED spot'].map((h) => (
                  <th
                    key={h}
                    className="text-xs font-bold uppercase text-ink-light bg-surface-warm px-3 py-2 text-left border-b border-rule"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMMODITIES.map((c) => (
                <tr key={c.ticker} className="border-b border-rule-light hover:bg-surface">
                  <td className="px-3 py-2 font-medium text-ink">
                    <button
                      type="button"
                      onClick={() => setFocus(c.ticker)}
                      className="text-green hover:text-green-dark font-semibold"
                    >
                      {c.ticker}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-ink">{c.label}</td>
                  <td className="px-3 py-2 text-ink-muted">{c.group}</td>
                  <td className="px-3 py-2">
                    {c.fredSpot ? (
                      <a
                        href={`https://fred.stlouisfed.org/series/${c.fredSpot}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-green hover:text-green-dark"
                      >
                        {c.fredSpot} ↗
                      </a>
                    ) : (
                      <span className="text-ink-light">—</span>
                    )}
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
