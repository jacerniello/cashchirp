'use client';

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { MultiLineChart, type MultiLineSeries } from '@/components/charts/MultiLineChart';
import {
  backtestFileUrl,
  errorText,
  isStudyReport,
  useBacktest,
  type BacktestPeriod,
  type BacktestReport,
  type SeriesPoint,
} from '@/hooks/useBacktests';
import { num, pct, signClass, when } from '../format';
import { PeriodBars } from './PeriodBars';
import { StudyReportView } from './StudyReport';

// One saved backtest report. Everything shown comes from report.json in the report's
// folder — nothing is recomputed here, so the page and the file can never disagree.

const STRAT = '#111111';
const BENCH = '#94a3b8';
const UNIV = '#3b82f6';

function drawdown(points: SeriesPoint[]): SeriesPoint[] {
  let peak = -Infinity;
  return points.map((p) => {
    peak = Math.max(peak, p.value);
    return { date: p.date, value: peak > 0 ? p.value / peak - 1 : 0 };
  });
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <Card variant="stat">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{label}</div>
      <div className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? 'text-ink'}`}>{value}</div>
      {sub && <div className="text-xs text-ink-faint mt-0.5">{sub}</div>}
    </Card>
  );
}

function Tiles({ r }: { r: BacktestReport }) {
  const s = r.summary;
  const b = r.params.benchmark;
  const n = (k: string) => s[k] as number | null | undefined;
  if (r.kind === 'cohort') {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Tile label={`Mean ${r.params.hold_months}m return`} value={pct(n('mean_return'))}
              tone={signClass(n('mean_return'))}
              sub={`${b} ${pct(n('bench_mean_return'))} · universe ${pct(n('universe_mean_return'))}`} />
        <Tile label="Median return" value={pct(n('median_return'))} tone={signClass(n('median_return'))}
              sub={`universe ${pct(n('universe_median_return'))}`} />
        <Tile label="Double rate (≥ +100%)" value={pct(n('double_rate'))}
              sub={`universe ${pct(n('universe_double_rate'))}`} />
        <Tile label="Halve rate (≤ −50%)" value={pct(n('halve_rate'))}
              sub={`universe ${pct(n('universe_halve_rate'))}`} />
        <Tile label={`Names beating ${b}`} value={pct(n('beat_bench_rate'))} />
        <Tile label="Positive" value={pct(n('pos_rate'))} />
        <Tile label="Observations" value={num(n('observations'))}
              sub={`${num(n('cohorts'))} cohorts · ${num(n('unique_names'))} names`} />
        <Tile label="Avg names / cohort" value={num(n('avg_holdings'), 1)} />
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Tile label="CAGR" value={pct(n('cagr'))} tone={signClass(n('cagr'))}
            sub={`${b} ${pct(n('bench_cagr'))} · universe ${pct(n('universe_cagr'))}`} />
      <Tile label={`Excess vs ${b}`} value={pct(n('excess_cagr'), 1, true)} tone={signClass(n('excess_cagr'))}
            sub={`vs universe ${pct(n('excess_cagr_vs_universe'), 1, true)} / yr`} />
      <Tile label="Total return" value={pct(n('total_return'), 0)}
            sub={`${b} ${pct(n('bench_total_return'), 0)}`} />
      <Tile label="Max drawdown" value={pct(n('max_drawdown'))} tone="text-neg"
            sub={`${b} ${pct(n('bench_max_drawdown'))} (monthly marks)`} />
      <Tile label="Volatility" value={pct(n('volatility'))} sub={`${b} ${pct(n('bench_volatility'))}`} />
      <Tile label={`Periods beating ${b}`} value={pct(n('hit_rate'), 0)}
            sub={`vs universe ${pct(n('hit_rate_vs_universe'), 0)}`} />
      <Tile label="Avg holdings" value={num(n('avg_holdings'), 1)}
            sub={`${num(n('unique_names'))} names over the run`} />
      <Tile label="Periods" value={num(n('periods'))}
            sub={`${num(n('cash_periods'))} in cash · turnover ${pct(n('avg_turnover'), 0)}`} />
    </div>
  );
}

function PeriodRow({ p, kind, benchmark }: { p: BacktestPeriod; kind: string; benchmark: string }) {
  const [open, setOpen] = useState(false);
  const sorted = useMemo(
    () => [...p.holdings].sort((a, b) => (b.ret ?? -Infinity) - (a.ret ?? -Infinity)),
    [p.holdings]
  );
  return (
    <>
      <tr className="border-t border-rule align-middle">
        <td className="px-6 py-2.5 whitespace-nowrap text-ink">
          {p.start} → {p.end}
          {p.partial && <span className="ml-2"><Badge variant="gray">partial</Badge></span>}
          {p.cash && <span className="ml-2"><Badge variant="orange">cash</Badge></span>}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums text-ink-light">{num(p.n_universe)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-ink-light">{num(p.n_passed)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-ink">{num(p.n_held)}</td>
        <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${signClass(p.ret_net)}`}>
          {pct(p.ret_net, 1, true)}
          {kind === 'portfolio' && p.turnover != null && (
            <div className="text-[0.7rem] font-normal text-ink-faint">turnover {pct(p.turnover, 0)}</div>
          )}
          {kind === 'cohort' && (
            <div className="text-[0.7rem] font-normal text-ink-faint">median {pct(p.median_ret, 1, true)}</div>
          )}
        </td>
        <td className={`px-3 py-2.5 text-right tabular-nums ${signClass(p.bench_ret)}`}>{pct(p.bench_ret, 1, true)}</td>
        <td className={`px-3 py-2.5 text-right tabular-nums ${signClass(p.universe_ret)}`}>{pct(p.universe_ret, 1, true)}</td>
        <td className="px-6 py-2.5 text-right">
          {p.holdings.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen(!open)}
              className="rounded-md border border-rule bg-white px-2.5 py-1 text-xs text-ink-light cursor-pointer
                         hover:border-green hover:text-green"
              aria-expanded={open}
            >
              {open ? 'Hide' : `${p.holdings.length} names`}
            </button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="bg-surface-warm">
          <td colSpan={8} className="px-6 py-3">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left uppercase tracking-wide text-ink-faint">
                  <th className="py-1 pr-3 font-medium">Ticker</th>
                  <th className="py-1 pr-3 font-medium">Name</th>
                  <th className="py-1 pr-3 font-medium">Sector</th>
                  <th className="py-1 pr-3 font-medium text-right">Mkt cap at entry</th>
                  <th className="py-1 pr-3 font-medium text-right">Entry</th>
                  <th className="py-1 pr-3 font-medium text-right">Exit</th>
                  <th className="py-1 font-medium text-right">Return</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((h) => (
                  <tr key={h.permaticker} className="border-t border-rule-light">
                    <td className="py-1 pr-3">
                      <Link href={`/company/${h.permaticker}`} className="font-semibold text-green no-underline">
                        {h.ticker ?? h.permaticker}
                      </Link>
                    </td>
                    <td className="py-1 pr-3 text-ink-light">{h.name ?? '—'}</td>
                    <td className="py-1 pr-3 text-ink-faint">{h.sector ?? '—'}</td>
                    <td className="py-1 pr-3 text-right tabular-nums text-ink-light">
                      {h.marketcap != null ? `$${(h.marketcap / 1e9).toFixed(2)}B` : '—'}
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums text-ink-light">{num(h.entry_px, 2)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums text-ink-light">
                      {num(h.exit_px, 2)}
                      {h.stopped_trading && (
                        <span className="ml-1.5" title={`Last traded ${h.exit_date} — valued at its final print`}>
                          <Badge variant="orange">stopped {h.exit_date}</Badge>
                        </span>
                      )}
                    </td>
                    <td className={`py-1 text-right tabular-nums font-semibold ${signClass(h.ret)}`}>
                      {pct(h.ret, 1, true)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[0.7rem] text-ink-faint">
              Prices are dividend-adjusted closes ({benchmark} and the universe use the same series), so
              entry/exit may differ from the quoted prices of the day.
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

export default function BacktestReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: r, isLoading, isError, error } = useBacktest(id);

  if (isLoading) {
    return <div className="max-w-[1200px] mx-auto px-6 py-16 text-sm text-ink-faint">Loading report…</div>;
  }
  if (isError || !r) {
    return (
      <div className="max-w-[1200px] mx-auto px-6 py-16 space-y-3">
        <div className="rounded-xl border border-rule bg-white p-6 text-sm text-ink-light">
          Could not load backtest <code className="text-ink">{id}</code>: {errorText(error)}
        </div>
        <Link href="/backtests" className="text-sm text-green no-underline">← All backtests</Link>
      </div>
    );
  }
  return isStudyReport(r) ? <StudyReportView r={r} /> : <BacktestView r={r} />;
}

function BacktestView({ r }: { r: BacktestReport }) {
  const lines = useMemo<MultiLineSeries[]>(() => {
    if (r.kind !== 'portfolio') return [];
    return [
      { label: 'Strategy (net)', points: r.series.strategy, color: STRAT },
      { label: r.params.benchmark, points: r.series.benchmark, color: BENCH },
      { label: 'Universe (EW, at rebalances)', points: r.series.universe, color: UNIV },
    ];
  }, [r]);
  const dd = useMemo<MultiLineSeries[]>(() => {
    if (r.kind !== 'portfolio') return [];
    return [
      { label: 'Strategy', points: drawdown(r.series.strategy), color: STRAT },
      { label: r.params.benchmark, points: drawdown(r.series.benchmark), color: BENCH },
    ];
  }, [r]);

  const serious = r.warnings.filter((w) => w.level === 'warn');
  const info = r.warnings.filter((w) => w.level !== 'warn');
  const s = r.summary;

  return (
    <div className="bg-white min-h-[calc(100vh-4rem)] font-sans">
      <div className="max-w-[1200px] mx-auto px-6 py-8 space-y-6">
        <div>
          <Link href="/backtests" className="text-sm text-ink-faint no-underline hover:text-green">← All backtests</Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-[1.75rem] font-bold tracking-tight text-ink">{r.name}</h1>
            <Badge variant={r.kind === 'portfolio' ? 'blue' : 'purple'}>{r.kind}</Badge>
            {serious.length > 0 && <Badge variant="red">{serious.length} sanity warning{serious.length > 1 ? 's' : ''}</Badge>}
          </div>
          <p className="mt-1 text-sm text-ink-light">
            {r.screen.title ?? r.screen.id} · {String(s.start ?? r.params.start)} → {String(s.end ?? r.params.end)} ·
            rebalanced every {r.params.rebalance_months} months
            {r.kind === 'cohort' ? ` · ${r.params.hold_months}-month forward window` : ` · ${r.params.cost_bps} bps costs`} ·
            vs {r.params.benchmark}
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            Created {when(r.created_at)}
            {r.elapsed_seconds != null && ` in ${Math.round(r.elapsed_seconds)}s`} ·{' '}
            {['report.json', 'periods.csv', 'holdings.csv'].map((f, i) => (
              <span key={f}>
                {i > 0 && ' · '}
                <a href={backtestFileUrl(r.id, f)} className="text-green no-underline" download>{f}</a>
              </span>
            ))}
          </p>
        </div>

        {serious.length > 0 && (
          <div className="rounded-xl border border-neg bg-neg-soft px-5 py-4">
            <h2 className="text-sm font-bold text-neg mb-2">
              Sanity checks failed — verify before trusting these numbers
            </h2>
            <ul className="list-disc pl-5 space-y-1 text-sm text-ink">
              {serious.map((w, i) => <li key={i}>{w.message}</li>)}
            </ul>
          </div>
        )}

        <Tiles r={r} />

        {r.kind === 'portfolio' ? (
          <>
            <Card>
              <MultiLineChart
                title="Growth of $1 — strategy vs benchmark"
                series={lines}
                height={360}
                yFormat={(v) => `$${v.toFixed(2)}`}
              />
            </Card>
            <div className="grid md:grid-cols-2 gap-6">
              <Card>
                <MultiLineChart
                  title="Drawdown (monthly marks)"
                  series={dd}
                  height={260}
                  yFormat={(v) => `${(v * 100).toFixed(0)}%`}
                />
              </Card>
              <Card>
                <h4 className="text-sm font-semibold text-ink mb-2">Return by period (net)</h4>
                <PeriodBars periods={r.periods} benchmark={r.params.benchmark} height={260} />
              </Card>
            </div>
          </>
        ) : (
          <Card>
            <h4 className="text-sm font-semibold text-ink mb-2">
              Mean {r.params.hold_months}-month forward return by cohort start
            </h4>
            <PeriodBars periods={r.periods} benchmark={r.params.benchmark} height={320} />
          </Card>
        )}

        <div className="rounded-xl border border-rule bg-white overflow-hidden">
          <div className="px-6 py-4 border-b border-rule">
            <h2 className="text-lg font-bold text-ink">{r.kind === 'cohort' ? 'Cohorts' : 'Periods'}</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-6 py-2 font-medium">{r.kind === 'cohort' ? 'Window' : 'Period'}</th>
                  <th className="px-3 py-2 font-medium text-right">Universe</th>
                  <th className="px-3 py-2 font-medium text-right">Passed</th>
                  <th className="px-3 py-2 font-medium text-right">Held</th>
                  <th className="px-3 py-2 font-medium text-right">{r.kind === 'cohort' ? 'Mean' : 'Return (net)'}</th>
                  <th className="px-3 py-2 font-medium text-right">{r.params.benchmark}</th>
                  <th className="px-3 py-2 font-medium text-right">Universe EW</th>
                  <th className="px-6 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {r.periods.map((p) => (
                  <PeriodRow key={p.start} p={p} kind={r.kind} benchmark={r.params.benchmark} />
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {info.length > 0 && (
          <div className="rounded-xl border border-rule bg-surface-warm px-5 py-4">
            <h2 className="text-sm font-bold text-ink mb-2">Notes ({info.length})</h2>
            <ul className="list-disc pl-5 space-y-1 text-sm text-ink-light">
              {info.map((w, i) => <li key={i}>{w.message}</li>)}
            </ul>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <h2 className="text-sm font-bold text-ink mb-2">Screen: {r.screen.title ?? r.screen.id}</h2>
            {r.screen.description && <p className="text-sm text-ink-light mb-3">{r.screen.description}</p>}
            {r.screen.criteria.length > 0 ? (
              <ul className="list-disc pl-5 space-y-1 text-sm text-ink-light">
                {r.screen.criteria.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            ) : (
              <p className="text-sm text-ink-faint">No criteria text in the spec.</p>
            )}
            <details className="mt-3">
              <summary className="text-xs text-ink-faint cursor-pointer">Spec as run (copied into the report)</summary>
              <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-surface p-3 text-[0.72rem] font-mono text-ink-light">
                {JSON.stringify(r.screen.spec, null, 2)}
              </pre>
            </details>
          </Card>
          <Card>
            <h2 className="text-sm font-bold text-ink mb-2">Parameters</h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {Object.entries(r.params).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-ink-faint">{k}</dt>
                  <dd className="text-ink font-mono text-xs self-center">{v == null ? '—' : String(v)}</dd>
                </div>
              ))}
            </dl>
            {r.method && r.method.length > 0 && (
              <>
                <h3 className="text-sm font-bold text-ink mt-4 mb-2">Method</h3>
                <ul className="list-disc pl-5 space-y-1 text-xs text-ink-light">
                  {r.method.map((m, i) => <li key={i}>{m}</li>)}
                </ul>
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
