'use client';

import { tableStyles } from '@/lib/styles';

// A saved screen's spec (config/screens/<id>.yaml, as GET /screener/screens/{id} returns
// it) rendered readably: universe rules, gates, growth rules. Values are shown as written
// in the file — the spec does not say which numbers are fractions, so nothing is guessed.
// Anything the renderer does not know is shown as raw JSON rather than dropped, so the page
// never implies a screen is narrower than it is.

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

function num(v: unknown): string {
  if (typeof v !== 'number') return String(v);
  if (Math.abs(v) >= 1e6) {
    return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(v);
  }
  return String(v);
}

function value(v: unknown): string {
  if (Array.isArray(v)) return v.map(value).join(', ');
  if (isObj(v)) return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return num(v);
}

const BOUNDS: [string, string][] = [['min', '≥'], ['gt', '>'], ['max', '≤'], ['lt', '<']];

function gateText(g: unknown): string {
  if (!isObj(g)) return value(g);
  const parts = BOUNDS.filter(([k]) => g[k] != null).map(([k, op]) => `${op} ${num(g[k])}`);
  const rest = Object.keys(g).filter((k) => !BOUNDS.some(([b]) => b === k) && k !== 'on_null');
  for (const k of rest) parts.push(`${k}: ${value(g[k])}`);
  return parts.join(' and ') || '—';
}

function nullText(g: unknown): string {
  if (!isObj(g) || g.on_null == null || g.on_null === 'drop') return 'fails';
  if (g.on_null === 'keep') return 'passes';
  return `treated as ${num(g.on_null)}`;
}

const label = (k: string) => k.replace(/_/g, ' ');

const KNOWN = new Set(['id', 'title', 'description', 'criteria', 'universe', 'gates', 'growth']);

export function ScreenSpec({ spec }: { spec: Obj }) {
  const universe = isObj(spec.universe) ? spec.universe : null;
  const gates = isObj(spec.gates) ? spec.gates : null;
  const growth = Array.isArray(spec.growth) ? spec.growth : null;
  const other = Object.keys(spec).filter((k) => !KNOWN.has(k));
  const h3 = 'text-xs font-semibold uppercase tracking-wide text-ink-faint m-0 mb-2';

  return (
    <div className="space-y-5">
      {universe && Object.keys(universe).length > 0 && (
        <div>
          <h3 className={h3}>Universe</h3>
          <ul className="list-none m-0 p-0 space-y-1">
            {Object.entries(universe).map(([k, v]) => (
              <li key={k} className="text-sm text-ink-light">
                <span className="text-ink font-medium">{label(k)}</span>: {value(v)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {gates && Object.keys(gates).length > 0 && (
        <div>
          <h3 className={h3}>Gates — a stock must pass every one</h3>
          <div className={tableStyles.container}>
            <table className={tableStyles.table}>
              <thead>
                <tr>
                  <th className={tableStyles.th}>Metric</th>
                  <th className={tableStyles.th}>Condition</th>
                  <th className={tableStyles.th}>If blank</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(gates).map(([k, g]) => (
                  <tr key={k} className={tableStyles.row}>
                    <td className={`${tableStyles.td} font-mono`}>{k}</td>
                    <td className={`${tableStyles.td} tabular-nums`}>{gateText(g)}</td>
                    <td className={`${tableStyles.td} text-ink-light`}>{nullText(g)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {growth && growth.length > 0 && (
        <div>
          <h3 className={h3}>Growth rules</h3>
          <ul className="list-none m-0 p-0 space-y-1">
            {growth.map((r, i) => (
              <li key={i} className="text-sm text-ink-light">
                {isObj(r) && r.cagr != null ? (
                  <>
                    <span className="font-mono text-ink">{String(r.cagr)}</span> ≥ {num(r.min_cagr)}
                    {r.level != null && r.level_5y_ago != null && (
                      <> — or a recovery: <span className="font-mono">{String(r.level_5y_ago)}</span> ≤ 0 and{' '}
                        <span className="font-mono">{String(r.level)}</span> &gt; 0</>
                    )}
                  </>
                ) : (
                  <code className="font-mono text-xs">{JSON.stringify(r)}</code>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {other.length > 0 && (
        <div>
          <h3 className={h3}>Other settings</h3>
          <pre className="text-xs font-mono bg-surface rounded-lg p-3 m-0 whitespace-pre-wrap">
            {JSON.stringify(Object.fromEntries(other.map((k) => [k, spec[k]])), null, 2)}
          </pre>
        </div>
      )}

      {!universe && !gates && !growth && other.length === 0 && (
        <p className="text-sm text-ink-muted m-0">This screen sets no gates — it passes the whole universe.</p>
      )}
    </div>
  );
}
