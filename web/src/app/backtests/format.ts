// Small formatters shared by the backtest pages. Returns are fractions (0.12 = 12%).

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
