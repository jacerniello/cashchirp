'use client';

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import {
  backtestFileUrl,
  metric,
  type GateRow,
  type SensitivityRow,
  type SignalRow,
  type StudyMetrics,
  type StudyReport,
} from '@/hooks/useBacktests';
import { num, pct, signClass, when } from '../format';

// Screen-study reports (gate-audit, signal-study, screen-comparison) written by
// `python -m core.backend.backtest.run --kind gate-audit|signal-study|compare`. Like the
// backtest page, everything shown is read from report.json — nothing is recomputed here.

type LabelSet = 'p' | 'a' | 'q12';
const LABEL_SETS: { key: LabelSet; label: string; hint: string }[] = [
  { key: 'p', label: 'Primary', hint: 'winner = top 20% of forward 24m return that date; loser = bottom 20% or stopped trading at a loss' },
  { key: 'a', label: 'Absolute', hint: 'winner = forward 24m ≥ +50%; loser = ≤ −30% or stopped trading at a loss' },
  { key: 'q12', label: '12-month', hint: 'top / bottom 20% of forward 12m return' },
];

const FILES: Record<StudyReport['kind'], string[]> = {
  'gate-audit': ['report.json', 'gates.csv', 'sensitivity.csv'],
  'signal-study': ['report.json', 'signals.csv', 'quintiles.csv'],
  'screen-comparison': ['report.json', 'comparison.csv'],
};

const TH = 'px-2 py-2 font-medium text-right whitespace-nowrap';
const TD = 'px-2 py-1.5 text-right tabular-nums whitespace-nowrap';

function edge(v: number | null) {
  return <span className={`font-semibold ${signClass(v)}`}>{v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(3)}</span>;
}

function LabelPicker({ value, onChange }: { value: LabelSet; onChange: (v: LabelSet) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-rule overflow-hidden text-xs" role="tablist">
      {LABEL_SETS.map((l) => (
        <button
          key={l.key}
          type="button"
          title={l.hint}
          onClick={() => onChange(l.key)}
          aria-pressed={value === l.key}
          className={`px-3 py-1.5 cursor-pointer border-0 ${value === l.key ? 'bg-ink text-white' : 'bg-white text-ink-light hover:text-ink'}`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

function Objective({ r }: { r: StudyReport }) {
  return (
    <div className="rounded-xl border border-rule bg-surface-warm px-5 py-4">
      <h2 className="text-sm font-bold text-ink mb-2">Objective &amp; protocol</h2>
      <ul className="list-disc pl-5 space-y-1 text-sm text-ink-light">
        {(r.objective ?? []).map((o, i) => <li key={i}>{o}</li>)}
      </ul>
    </div>
  );
}

/** The headline block for one kept set against its universe. */
function KeptVsUniverse({ m, u, ls }: { m: StudyMetrics; u?: StudyMetrics; ls: LabelSet }) {
  const g = (k: string) => metric(m, k);
  const base = u ?? m;
  return (
    <table className="w-full text-sm border-collapse">
      <tbody>
        {[
          ['Names kept per date', num(g('names_per_date'), 1), `of ${num(metric(m, 'n_univ') != null && metric(m, 'dates') ? (metric(m, 'n_univ')! / metric(m, 'dates')!) : null, 0)} in the universe`],
          ['Winner retention', pct(g(`${ls}_retention`)), 'share of the universe’s winners kept'],
          ['Loser removal', pct(g(`${ls}_removal`)), 'share of the universe’s losers removed'],
          ['Edge', null, 'winner retention − loser retention (0 = random)'],
          ['Winners among kept', pct(g(`${ls}_win_kept`)), `universe ${pct(metric(base, `${ls}_win_univ`))}`],
          ['Losers among kept', pct(g(`${ls}_lose_kept`)), `universe ${pct(metric(base, `${ls}_lose_univ`))}`],
          ['Doubled / busted among kept', `${pct(g('double_kept'))} / ${pct(g('bust_kept'))}`, `universe ${pct(metric(base, 'double_univ'))} / ${pct(metric(base, 'bust_univ'))}`],
          ['Median fwd 24m: kept vs removed', `${pct(g('median_24m_kept'), 1, true)} vs ${pct(g('median_24m_removed'), 1, true)}`, `mean ${pct(g('mean_24m_kept'), 1, true)} vs ${pct(g('mean_24m_removed'), 1, true)}`],
          ['Excess median by date', pct(g('excess_median_by_date'), 1, true), `beat the universe median in ${pct(g('dates_beating_universe'), 0)} of dates`],
        ].map(([k, v, sub]) => (
          <tr key={k as string} className="border-t border-rule-light">
            <td className="py-1.5 pr-3 text-ink-light">{k}</td>
            <td className="py-1.5 pr-3 text-right tabular-nums font-semibold text-ink">
              {k === 'Edge' ? edge(g(`${ls}_edge`)) : v}
            </td>
            <td className="py-1.5 text-xs text-ink-faint">{sub}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ----------------------------------------------------------------------------- gate audit

function GateAudit({ r, ls }: { r: StudyReport; ls: LabelSet }) {
  const periods = r.params.periods ?? [];
  const byGate = useMemo(() => {
    const m = new Map<string, Record<string, GateRow>>();
    for (const g of r.gates ?? []) {
      const e = m.get(g.gate) ?? {};
      e[g.period] = g;
      m.set(g.gate, e);
    }
    return [...m.entries()];
  }, [r.gates]);
  const sens = useMemo(() => {
    const m = new Map<string, SensitivityRow[]>();
    for (const s of r.sensitivity ?? []) m.set(s.gate, [...(m.get(s.gate) ?? []), s]);
    return m;
  }, [r.sensitivity]);
  const lw = ls === 'q12' ? 'p' : ls; // let-back-in sets carry primary and absolute rates

  return (
    <>
      <div className={`grid gap-6 ${periods.length > 1 ? 'md:grid-cols-2' : ''}`}>
        {periods.map((per) => r.full?.[per] && (
          <Card key={per}>
            <h3 className="text-sm font-bold text-ink mb-2">
              Full screen — <PeriodBadge p={per} />
            </h3>
            <KeptVsUniverse m={r.full[per]} u={r.full[per].universe as StudyMetrics | undefined} ls={ls} />
          </Card>
        ))}
      </div>

      <div className="rounded-xl border border-rule bg-white overflow-hidden">
        <div className="px-6 py-4 border-b border-rule">
          <h2 className="text-lg font-bold text-ink">Each gate</h2>
          <p className="text-xs text-ink-faint mt-1">
            <b>Alone</b>: the gate applied by itself to the universe — what it keeps vs removes.{' '}
            <b>Let back in</b>: names the full screen rejects only because of this gate (screen minus this
            gate, minus the screen) — if they are mostly winners the gate is hurting. Market cap is the
            universe band, not audited.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-ink-faint uppercase tracking-wide">
                <th className="px-4 py-2 font-medium text-left" rowSpan={2}>Gate</th>
                {periods.map((p) => (
                  <th key={p} colSpan={9} className="px-2 py-1 font-medium text-center border-l border-rule">
                    <PeriodBadge p={p} />
                  </th>
                ))}
              </tr>
              <tr className="text-ink-faint uppercase tracking-wide">
                {periods.map((p) => (
                  <Fragment key={p}>
                    <th className={`${TH} border-l border-rule`}>Kept</th>
                    <th className={TH}>Win ret.</th>
                    <th className={TH}>Lose rem.</th>
                    <th className={TH}>Edge</th>
                    <th className={TH}>Excess</th>
                    <th className={`${TH} border-l border-rule-light`}>Back in /date</th>
                    <th className={TH}>Win</th>
                    <th className={TH}>Lose</th>
                    <th className={TH}>Median</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {byGate.map(([gate, per]) => {
                const any = Object.values(per)[0];
                return (
                  <tr key={gate} className="border-t border-rule align-top">
                    <td className="px-4 py-1.5">
                      <div className="font-semibold text-ink">{gate}</div>
                      <div className="text-ink-faint">{any?.rule}</div>
                    </td>
                    {periods.map((p) => {
                      const g = per[p];
                      if (!g) return <td key={p} colSpan={9} className="border-l border-rule text-center text-ink-faint">—</td>;
                      const a = g.alone;
                      const b = g.let_back_in;
                      const dates = metric(a, 'dates') || 1;
                      const bw = lw === 'p' ? b.p_win : b.a_win;
                      const bl = lw === 'p' ? b.p_lose : b.a_lose;
                      const fw = lw === 'p' ? g.full_kept.p_win : g.full_kept.a_win;
                      const fl = lw === 'p' ? g.full_kept.p_lose : g.full_kept.a_lose;
                      return (
                        <Fragment key={p}>
                          <td className={`${TD} border-l border-rule`}>{pct(metric(a, 'share_kept'), 0)}</td>
                          <td className={TD}>{pct(metric(a, `${ls}_retention`), 0)}</td>
                          <td className={TD}>{pct(metric(a, `${ls}_removal`), 0)}</td>
                          <td className={TD}>{edge(metric(a, `${ls}_edge`))}</td>
                          <td className={`${TD} ${signClass(metric(a, 'excess_median_by_date'))}`}>{pct(metric(a, 'excess_median_by_date'), 1, true)}</td>
                          <td className={`${TD} border-l border-rule-light`}>{b.n ? num(b.n / dates, 1) : '0'}</td>
                          <td className={`${TD} ${bw != null && fw != null && bw > fw ? 'text-pos font-semibold' : ''}`} title={`full screen: ${pct(fw)}`}>{pct(bw, 0)}</td>
                          <td className={`${TD} ${bl != null && fl != null && bl > fl ? 'text-neg font-semibold' : ''}`} title={`full screen: ${pct(fl)}`}>{pct(bl, 0)}</td>
                          <td className={TD}>{pct(b.median_24m, 0, true)}</td>
                        </Fragment>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="px-6 py-3 text-[0.7rem] text-ink-faint border-t border-rule">
          “Back in” win / lose are highlighted when they are worse for the screen than its own kept set
          (green: the gate rejects more winners than the screen keeps; red: it is doing its job against
          losers). Hover for the full screen’s rate. 12-month labels are not computed for let-back-in sets;
          primary rates are shown.
        </p>
      </div>

      <div className="rounded-xl border border-rule bg-white overflow-hidden">
        <div className="px-6 py-4 border-b border-rule">
          <h2 className="text-lg font-bold text-ink">Threshold sensitivity</h2>
          <p className="text-xs text-ink-faint mt-1">
            Each gate on a grid of round thresholds declared before any result was seen. “—” = the gate
            removed. <b>In screen</b> = the full screen with only this threshold changed.
          </p>
        </div>
        {[...sens.entries()].map(([gate, rows]) => (
          <details key={gate} className="border-t border-rule">
            <summary className="px-6 py-2.5 cursor-pointer text-sm font-semibold text-ink">{gate}</summary>
            <div className="overflow-x-auto px-4 pb-4">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-ink-faint uppercase tracking-wide">
                    <th className="px-2 py-2 font-medium text-left">Period</th>
                    <th className={TH}>{rows[0]?.key}</th>
                    <th className={TH}>Alone kept</th>
                    <th className={TH}>Win ret.</th>
                    <th className={TH}>Lose rem.</th>
                    <th className={TH}>Edge</th>
                    <th className={`${TH} border-l border-rule-light`}>Screen /date</th>
                    <th className={TH}>Win kept</th>
                    <th className={TH}>Lose kept</th>
                    <th className={TH}>Median 24m</th>
                    <th className={TH}>Excess</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s, i) => (
                    <tr key={i} className={`border-t border-rule-light ${s.current ? 'bg-surface-warm font-semibold' : ''}`}>
                      <td className="px-2 py-1.5"><PeriodBadge p={s.period} /></td>
                      <td className={TD}>{s.value == null ? '—' : s.value}{s.current && ' ◂ current'}</td>
                      <td className={TD}>{pct(metric(s.alone, 'share_kept'), 0)}</td>
                      <td className={TD}>{pct(metric(s.alone, `${ls}_retention`), 0)}</td>
                      <td className={TD}>{pct(metric(s.alone, `${ls}_removal`), 0)}</td>
                      <td className={TD}>{edge(metric(s.alone, `${ls}_edge`))}</td>
                      <td className={`${TD} border-l border-rule-light`}>{num(metric(s.in_screen, 'names_per_date'), 1)}</td>
                      <td className={TD}>{pct(metric(s.in_screen, `${ls}_win_kept`))}</td>
                      <td className={TD}>{pct(metric(s.in_screen, `${ls}_lose_kept`))}</td>
                      <td className={TD}>{pct(metric(s.in_screen, 'median_24m_kept'), 1, true)}</td>
                      <td className={`${TD} ${signClass(metric(s.in_screen, 'excess_median_by_date'))}`}>{pct(metric(s.in_screen, 'excess_median_by_date'), 1, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>
    </>
  );
}

// ----------------------------------------------------------------------------- signals

function NetBars({ s, ls }: { s: SignalRow; ls: LabelSet }) {
  const vals = s.quintiles.map((q) => {
    const w = (q as unknown as Record<string, number | undefined>)[`${ls}_win`];
    const l = (q as unknown as Record<string, number | undefined>)[`${ls}_lose`];
    return w != null && l != null ? w - l : null;
  });
  const max = Math.max(0.05, ...vals.map((v) => Math.abs(v ?? 0)));
  return (
    <div className="flex items-center gap-0.5 h-6" title="winner rate − loser rate, quintile 1 (lowest value) → 5">
      {vals.map((v, i) => (
        <div key={i} className="w-3 h-6 relative">
          {v != null && (
            <div
              className={`absolute left-0 right-0 ${v >= 0 ? 'bg-pos bottom-1/2' : 'bg-neg top-1/2'}`}
              style={{ height: `${(Math.abs(v) / max) * 50}%` }}
            />
          )}
          <div className="absolute left-0 right-0 top-1/2 h-px bg-rule" />
        </div>
      ))}
    </div>
  );
}

function SignalStudy({ r, ls }: { r: StudyReport; ls: LabelSet }) {
  const [open, setOpen] = useState<string | null>(null);
  const [family, setFamily] = useState<string>('all');
  const sigs = r.signals ?? [];
  const families = useMemo(() => ['all', ...new Set(sigs.map((s) => s.family))], [sigs]);
  const shown = sigs.filter((s) => family === 'all' || s.family === family);
  return (
    <div className="rounded-xl border border-rule bg-white overflow-hidden">
      <div className="px-6 py-4 border-b border-rule flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink">Signals by quintile</h2>
          <p className="text-xs text-ink-faint mt-1 max-w-3xl">
            Quintiles are formed within each date over names with a value (Q1 = lowest). Bars: winner rate
            − loser rate per quintile. <b>Spread</b> compares the expected-good extreme with the
            expected-bad one; <b>Spearman</b> is the rank correlation of the bars with Q1→Q5 (±1 =
            perfectly monotonic); <b>years</b> = share of dates where the good extreme’s median beat the
            bad one’s. Click a row for its quintile table.
          </p>
        </div>
        <select
          value={family}
          onChange={(e) => setFamily(e.target.value)}
          className="rounded-md border border-rule bg-white px-2 py-1 text-xs text-ink"
        >
          {families.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-ink-faint uppercase tracking-wide">
              <th className="px-4 py-2 font-medium text-left">Signal</th>
              <th className="px-2 py-2 font-medium text-left">Family</th>
              <th className={TH}>Coverage</th>
              <th className="px-2 py-2 font-medium">Q1 → Q5</th>
              <th className={TH}>Spread</th>
              <th className={TH}>Spearman</th>
              <th className={TH}>Δ median</th>
              <th className={TH}>Years</th>
              <th className="px-2 py-2 font-medium text-left" />
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <Fragment key={s.signal}>
                <tr
                  className="border-t border-rule cursor-pointer hover:bg-surface-warm"
                  onClick={() => setOpen(open === s.signal ? null : s.signal)}
                  aria-expanded={open === s.signal}
                >
                  <td className="px-4 py-1.5">
                    <div className="font-semibold text-ink">{s.signal} <span className="font-normal text-ink-faint">{s.direction > 0 ? '↑ better' : '↓ better'}</span></div>
                    <div className="text-ink-faint">{s.description}</div>
                  </td>
                  <td className="px-2 py-1.5 text-ink-light">{s.family}</td>
                  <td className={TD}>{pct(s.coverage, 0)}</td>
                  <td className="px-2 py-1.5"><NetBars s={s} ls={ls} /></td>
                  <td className={TD}>{edge(s.spread_net ?? null)}</td>
                  <td className={TD}>{s.spearman_net == null ? '—' : s.spearman_net.toFixed(2)}</td>
                  <td className={`${TD} ${signClass(s.spread_median)}`}>{pct(s.spread_median, 1, true)}</td>
                  <td className={TD}>{pct(s.years_consistent, 0)}</td>
                  <td className="px-2 py-1.5 space-x-1 whitespace-nowrap">
                    {s.monotonic && <Badge variant={s.agrees_with_prior ? 'green' : 'orange'}>monotonic</Badge>}
                    {s.coverage != null && s.coverage < 0.6 && <Badge variant="gray">low coverage</Badge>}
                  </td>
                </tr>
                {open === s.signal && (
                  <tr className="bg-surface-warm">
                    <td colSpan={9} className="px-6 py-3">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="text-ink-faint uppercase tracking-wide">
                            <th className="py-1 pr-2 font-medium text-left">Quintile</th>
                            <th className={TH}>n</th>
                            <th className={TH}>Range</th>
                            <th className={TH}>Upper cut (median by date)</th>
                            <th className={TH}>Median 24m</th>
                            <th className={TH}>Mean 24m</th>
                            <th className={TH}>Winners</th>
                            <th className={TH}>Losers</th>
                            <th className={TH}>≥ +50%</th>
                            <th className={TH}>≤ −30%</th>
                            <th className={TH}>Doubled</th>
                            <th className={TH}>Busted</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...s.quintiles, ...(s.null?.n ? [{ ...s.null, quintile: 0 }] : [])].map((q) => (
                            <tr key={q.quintile} className="border-t border-rule-light">
                              <td className="py-1 pr-2">{q.quintile === 0 ? 'blank' : `Q${q.quintile}`}</td>
                              <td className={TD}>{num(q.n)}</td>
                              <td className={TD}>{q.lo != null && q.hi != null ? `${num(q.lo, 3)} … ${num(q.hi, 3)}` : '—'}</td>
                              <td className={TD}>{num(q.upper_breakpoint ?? null, 3)}</td>
                              <td className={`${TD} ${signClass(q.median_24m)}`}>{pct(q.median_24m, 1, true)}</td>
                              <td className={TD}>{pct(q.mean_24m, 1, true)}</td>
                              <td className={TD}>{pct(q.p_win)}</td>
                              <td className={TD}>{pct(q.p_lose)}</td>
                              <td className={TD}>{pct(q.a_win)}</td>
                              <td className={TD}>{pct(q.a_lose)}</td>
                              <td className={TD}>{pct(q.double)}</td>
                              <td className={TD}>{pct(q.bust)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- comparison

function Comparison({ r, ls }: { r: StudyReport; ls: LabelSet }) {
  const rows = r.comparison ?? [];
  const bts = r.backtests ?? [];
  return (
    <>
      <div className="rounded-xl border border-rule bg-white overflow-hidden">
        <div className="px-6 py-4 border-b border-rule">
          <h2 className="text-lg font-bold text-ink">Selection: winners kept, losers removed</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-ink-faint uppercase tracking-wide">
                <th className="px-4 py-2 font-medium text-left">Screen</th>
                <th className="px-2 py-2 font-medium text-left">Period</th>
                <th className={TH}>Names /date</th>
                <th className={TH}>Win ret.</th>
                <th className={TH}>Lose rem.</th>
                <th className={TH}>Edge</th>
                <th className={TH}>Win kept</th>
                <th className={TH}>Lose kept</th>
                <th className={TH}>Doubled</th>
                <th className={TH}>Busted</th>
                <th className={TH}>Median kept</th>
                <th className={TH}>Median univ.</th>
                <th className={TH}>Excess</th>
                <th className={TH}>Years beating</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m, i) => (
                <tr key={i} className="border-t border-rule">
                  <td className="px-4 py-1.5 font-semibold text-ink">{String(m.screen)}</td>
                  <td className="px-2 py-1.5"><PeriodBadge p={String(m.period)} /></td>
                  <td className={TD}>{num(metric(m, 'names_per_date'), 1)}</td>
                  <td className={TD}>{pct(metric(m, `${ls}_retention`))}</td>
                  <td className={TD}>{pct(metric(m, `${ls}_removal`))}</td>
                  <td className={TD}>{edge(metric(m, `${ls}_edge`))}</td>
                  <td className={TD}>{pct(metric(m, `${ls}_win_kept`))} <span className="text-ink-faint">/ {pct(metric(m, `${ls}_win_univ`), 0)}</span></td>
                  <td className={TD}>{pct(metric(m, `${ls}_lose_kept`))} <span className="text-ink-faint">/ {pct(metric(m, `${ls}_lose_univ`), 0)}</span></td>
                  <td className={TD}>{pct(metric(m, 'double_kept'))}</td>
                  <td className={TD}>{pct(metric(m, 'bust_kept'))}</td>
                  <td className={`${TD} ${signClass(metric(m, 'median_24m_kept'))}`}>{pct(metric(m, 'median_24m_kept'), 1, true)}</td>
                  <td className={TD}>{pct(metric(m, 'median_24m_univ'), 1, true)}</td>
                  <td className={`${TD} ${signClass(metric(m, 'excess_median_by_date'))}`}>{pct(metric(m, 'excess_median_by_date'), 1, true)}</td>
                  <td className={TD}>{pct(metric(m, 'dates_beating_universe'), 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-6 py-3 text-[0.7rem] text-ink-faint border-t border-rule">
          “Win kept / lose kept” show the kept set’s rate, then the universe’s. Excess = mean over dates
          of the kept median minus the universe median (forward 24m).
        </p>
      </div>

      {bts.length > 0 && (
        <div className="rounded-xl border border-rule bg-white overflow-hidden">
          <div className="px-6 py-4 border-b border-rule">
            <h2 className="text-lg font-bold text-ink">Backtests</h2>
            <p className="text-xs text-ink-faint mt-1">
              The ordinary backtest runner on each screen — portfolio (equal weight, yearly rebalance, 30 bps
              costs) and cohort (each name’s forward 24m). Each is saved as its own report.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-ink-faint uppercase tracking-wide">
                  <th className="px-4 py-2 font-medium text-left">Screen</th>
                  <th className="px-2 py-2 font-medium text-left">Range</th>
                  <th className="px-2 py-2 font-medium text-left">Kind</th>
                  <th className={TH}>Strategy</th>
                  <th className={TH}>SPY</th>
                  <th className={TH}>Universe</th>
                  <th className={TH}>Max DD</th>
                  <th className={TH}>Avg names</th>
                  <th className="px-4 py-2 font-medium text-left">Report</th>
                </tr>
              </thead>
              <tbody>
                {bts.map((b) => {
                  const s = b.summary;
                  const n = (k: string) => (typeof s[k] === 'number' ? (s[k] as number) : null);
                  const port = b.kind === 'portfolio';
                  return (
                    <tr key={b.report_id} className="border-t border-rule">
                      <td className="px-4 py-1.5 font-semibold text-ink">{b.screen}</td>
                      <td className="px-2 py-1.5 text-ink-light whitespace-nowrap">{b.range} {b.start.slice(0, 4)}–{b.end.slice(0, 4)}</td>
                      <td className="px-2 py-1.5"><Badge variant={port ? 'blue' : 'purple'}>{b.kind}</Badge></td>
                      <td className={`${TD} font-semibold ${signClass(port ? n('cagr') : n('median_return'))}`}>
                        {port ? `${pct(n('cagr'))} CAGR` : `${pct(n('median_return'), 1, true)} median`}
                      </td>
                      <td className={TD}>{port ? pct(n('bench_cagr')) : pct(n('bench_mean_return'), 1, true)}</td>
                      <td className={TD}>{port ? pct(n('universe_cagr')) : `${pct(n('universe_median_return'), 1, true)} median`}</td>
                      <td className={TD}>{port ? pct(n('max_drawdown')) : `halved ${pct(n('halve_rate'))}`}</td>
                      <td className={TD}>{num(n('avg_holdings'), 0)}</td>
                      <td className="px-4 py-1.5">
                        <Link href={`/backtests/${b.report_id}`} className="text-green no-underline">open</Link>
                        {b.serious_warnings > 0 && <span className="ml-2"><Badge variant="red">{b.serious_warnings} warn</Badge></span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function PeriodBadge({ p }: { p: string }) {
  return <Badge variant={p === 'holdout' ? 'orange' : p === 'discovery' ? 'blue' : 'gray'}>{p}</Badge>;
}

export function StudyReportView({ r }: { r: StudyReport }) {
  const [ls, setLs] = useState<LabelSet>('p');
  const serious = (r.warnings ?? []).filter((w) => w.level === 'warn');
  const title = { 'gate-audit': 'Gate audit', 'signal-study': 'Signal study', 'screen-comparison': 'Screen comparison' }[r.kind];
  return (
    <div className="bg-white min-h-[calc(100vh-4rem)] font-sans">
      <div className="max-w-[1400px] mx-auto px-6 py-8 space-y-6">
        <div>
          <Link href="/backtests" className="text-sm text-ink-faint no-underline hover:text-green">← All backtests</Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-[1.75rem] font-bold tracking-tight text-ink">{r.name}</h1>
            <Badge variant="green">{title}</Badge>
            {(r.params.periods ?? []).map((p) => <PeriodBadge key={p} p={p} />)}
          </div>
          <p className="mt-1 text-sm text-ink-light">
            {r.screens?.length ? r.screens.map((s) => s.title ?? s.id).join(' · ') : r.screen?.title ?? r.screen?.id}
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            Created {when(r.created_at)}
            {r.elapsed_seconds != null && ` in ${Math.round(r.elapsed_seconds)}s`} ·{' '}
            {FILES[r.kind].map((f, i) => (
              <span key={f}>
                {i > 0 && ' · '}
                <a href={backtestFileUrl(r.id, f)} className="text-green no-underline" download>{f}</a>
              </span>
            ))}
          </p>
        </div>

        {serious.length > 0 && (
          <div className="rounded-xl border border-neg bg-neg-soft px-5 py-4 text-sm text-ink">
            <ul className="list-disc pl-5 space-y-1">{serious.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
          </div>
        )}

        <Objective r={r} />

        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Labels</span>
          <LabelPicker value={ls} onChange={setLs} />
          <span className="text-xs text-ink-faint">{LABEL_SETS.find((l) => l.key === ls)?.hint}</span>
        </div>

        {r.kind === 'gate-audit' && <GateAudit r={r} ls={ls} />}
        {r.kind === 'signal-study' && <SignalStudy r={r} ls={ls} />}
        {r.kind === 'screen-comparison' && <Comparison r={r} ls={ls} />}

        <div className="grid md:grid-cols-2 gap-6">
          {(r.screens?.length ? r.screens : r.screen?.spec && Object.keys(r.screen.spec).length ? [r.screen] : []).map((s) => (
            <Card key={s.id}>
              <h2 className="text-sm font-bold text-ink mb-2">Screen: {s.title ?? s.id}</h2>
              {s.criteria.length > 0 && (
                <ul className="list-disc pl-5 space-y-1 text-sm text-ink-light">
                  {s.criteria.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              )}
              <details className="mt-3">
                <summary className="text-xs text-ink-faint cursor-pointer">Spec as run</summary>
                <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-surface p-3 text-[0.72rem] font-mono text-ink-light">
                  {JSON.stringify(s.spec, null, 2)}
                </pre>
              </details>
            </Card>
          ))}
          <Card>
            <h2 className="text-sm font-bold text-ink mb-2">Method</h2>
            <ul className="list-disc pl-5 space-y-1 text-xs text-ink-light">
              {(r.method ?? []).map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
