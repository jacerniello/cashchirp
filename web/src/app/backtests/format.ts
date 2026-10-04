// Small formatters shared by the backtest pages. Returns are fractions (0.12 = 12%).

import { isStudyKind, type BacktestListItem } from '@/hooks/useBacktests';

/** A report's headline number against its benchmark: CAGR for a portfolio run, mean
 *  forward return for a cohort run. Study reports have no single return — see `studyLine`. */
export function headline(r: BacktestListItem) {
  const s = r.summary ?? {};
  if (isStudyKind(r.kind)) return { main: null, bench: null, label: '', dd: null };
  if (r.kind === 'cohort') {
    return {
      main: s.mean_return as number | null,
      bench: s.bench_mean_return as number | null,
      label: `mean ${r.params?.hold_months ?? '?'}m fwd`,
      dd: null,
    };
  }
  return {
    main: s.cagr as number | null,
    bench: s.bench_cagr as number | null,
    label: 'CAGR',
    dd: s.max_drawdown as number | null,
  };
}

export function pct(v: number | string | null | undefined, digits = 1, signed = false): string {
  if (v == null || v === '' || typeof v === 'string' || !Number.isFinite(v)) return '—';
  const s = (v * 100).toFixed(digits);
  return `${signed && v > 0 ? '+' : ''}${s}%`;
}

/** Tailwind text colour for a signed number (green up / red down / ink otherwise). */
export function signClass(v: number | string | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v) || v === 0) return 'text-ink';
  return v > 0 ? 'text-pos' : 'text-neg';
}

export function when(ts: string | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function num(v: number | string | null | undefined, digits = 0): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  return v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

/** One line summarising a study report for the list (gate-audit / signal-study / comparison). */
export function studyLine(r: BacktestListItem): string {
  const s = r.summary ?? {};
  const n = (k: string) => (typeof s[k] === 'number' ? (s[k] as number) : null);
  const ed = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(3)}`);
  if (r.kind === 'gate-audit') {
    const per = ['discovery', 'holdout'].filter((p) => n(`${p}_p_edge`) != null);
    return per.map((p) => `${p}: keeps ${pct(n(`${p}_p_retention`), 0)} of winners, removes `
      + `${pct(n(`${p}_p_removal`), 0)} of losers (edge ${ed(n(`${p}_p_edge`))})`).join(' · ');
  }
  if (r.kind === 'signal-study') {
    const top = Array.isArray(s.top) ? (s.top as unknown as string[]).slice(0, 3).join(', ') : '';
    return `${n('signals') ?? '?'} signals, ${n('monotonic') ?? 0} monotonic${top ? ` · strongest: ${top}` : ''}`;
  }
  if (r.kind === 'screen-comparison') {
    return Object.entries(s)
      .filter(([k, v]) => k.endsWith('|holdout|p_edge') && typeof v === 'number')
      .map(([k, v]) => `${k.split('|')[0]} holdout edge ${ed(v as number)}`).join(' · ');
  }
  return '';
}
