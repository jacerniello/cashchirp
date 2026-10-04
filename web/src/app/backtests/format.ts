// Small formatters shared by the backtest pages. Returns are fractions (0.12 = 12%).

import type { BacktestListItem } from '@/hooks/useBacktests';

/** A report's headline number against its benchmark: CAGR for a portfolio run, mean
 *  forward return for a cohort run. */
export function headline(r: BacktestListItem) {
  const s = r.summary ?? {};
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
