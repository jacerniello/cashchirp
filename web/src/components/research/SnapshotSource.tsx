'use client';

import Link from 'next/link';
import { ALL_SCREEN_METRICS, MARKET_CAP_RANGES } from '@/app/screener/constants';
import type { SnapshotSource } from '@/hooks/useResearch';

// Where a snapshot came from, and the way back to it.
//
// A grid snapshot stores the screener's API params (the same object SaveScreen sends). The
// /screener page's URL is a near-copy of those params — see `urlQuery` in
// app/screener/page.tsx — so mapping back is mechanical: rename a handful of keys, and
// carry the metric bounds through as-is (the URL holds API units, not display units).

const METRIC_LABEL = new Map(ALL_SCREEN_METRICS.map((m) => [m.key, m]));
const RANGE_LABEL = new Map(MARKET_CAP_RANGES.map((r) => [r.key as string, r.label]));

export function gridParamsToQuery(params: Record<string, unknown> | undefined): string {
  const p = params ?? {};
  const q = new URLSearchParams();
  const str = (v: unknown) => (v == null || v === '' ? null : String(v));
  if (str(p.market_cap_range)) q.set('range', String(p.market_cap_range));
  if (str(p.sector)) q.set('sector', String(p.sector));
  if (str(p.industry)) q.set('industry', String(p.industry));
  if (str(p.exchange)) q.set('exchange', String(p.exchange));
  if (!p.exclude_commodities) q.set('excl_commod', '0');
  if (p.exclude_biotech) q.set('excl_biotech', '1');
  if (p.include_delisted) q.set('incl_delisted', '1');
  if (str(p.sort) && p.sort !== '-market_cap') q.set('sort', String(p.sort));
  for (const [k, v] of Object.entries(p)) {
    const m = k.match(/^(.*)_(min|max)$/);
    if (m && METRIC_LABEL.has(m[1]) && str(v) != null) q.set(k, String(v));
  }
  return q.toString();
}

/** Human-readable chips for a grid filter. */
export function gridParamChips(params: Record<string, unknown> | undefined): string[] {
  const p = params ?? {};
  const out: string[] = [];
  if (p.market_cap_range) out.push(RANGE_LABEL.get(String(p.market_cap_range)) ?? `Cap: ${p.market_cap_range}`);
  if (p.sector) out.push(`Sector: ${p.sector}`);
  if (p.industry) out.push(`Industry: ${p.industry}`);
  if (p.exchange) out.push(`Exchange: ${p.exchange}`);
  if (p.exclude_commodities) out.push('Excl. commodities');
  if (p.exclude_biotech) out.push('Excl. biotech');
  out.push(p.include_delisted ? 'Incl. delisted' : 'Active only');
  const bounds = new Map<string, { min?: unknown; max?: unknown }>();
  for (const [k, v] of Object.entries(p)) {
    const m = k.match(/^(.*)_(min|max)$/);
    if (!m || v == null || v === '') continue;
    const b = bounds.get(m[1]) ?? {};
    b[m[2] as 'min' | 'max'] = v;
    bounds.set(m[1], b);
  }
  for (const [key, b] of bounds) {
    const meta = METRIC_LABEL.get(key);
    const fmt = (v: unknown) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return String(v);
      return meta?.isPercent ? `${+(n * 100).toFixed(2)}%` : `${+n.toFixed(4)}`;
    };
    const label = meta?.label ?? key;
    if (b.min != null && b.max != null) out.push(`${label} ${fmt(b.min)} – ${fmt(b.max)}`);
    else if (b.min != null) out.push(`${label} ≥ ${fmt(b.min)}`);
    else out.push(`${label} ≤ ${fmt(b.max)}`);
  }
  return out;
}

export function sourceLabel(src: SnapshotSource | undefined): string {
  if (!src) return 'Unknown source';
  if (src.kind === 'screen') return `Saved screen: ${src.title || src.screen_id || '?'}`;
  if (src.kind === 'grid') return 'Screener filter';
  return 'Unknown source';
}

export function SnapshotSourceDetail({ source }: { source: SnapshotSource | undefined }) {
  if (!source) return <p className="text-sm text-ink-muted m-0">The snapshot does not record its source.</p>;
  if (source.kind === 'screen') {
    return (
      <div className="text-sm text-ink-light space-y-1">
        <div>
          Saved screen <strong className="text-ink">{source.title || source.screen_id}</strong>
          {source.screen_id && (
            <>
              {' '}(<code className="font-mono text-xs">config/screens/{source.screen_id}.yaml</code>)
            </>
          )}
        </div>
        {source.screen_id && (
          <Link href={`/screener/ideas/${encodeURIComponent(source.screen_id)}`} className="text-green text-sm">
            Run this screen live →
          </Link>
        )}
      </div>
    );
  }
  const chips = gridParamChips(source.params);
  const qs = gridParamsToQuery(source.params);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <span key={c} className="inline-flex rounded-md bg-surface px-2 py-0.5 text-xs text-ink-light">{c}</span>
        ))}
      </div>
      <Link href={qs ? `/screener?${qs}` : '/screener'} className="text-green text-sm">
        Open this filter in the screener (live numbers) →
      </Link>
    </div>
  );
}
