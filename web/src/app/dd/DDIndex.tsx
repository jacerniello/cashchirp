'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Spinner } from '@/components/Loading';
import { RatingBadge } from '@/components/dd/DDBlocks';
import { ratingMeta, TIER_META, TIER_ORDER, type DDSummary, type DDTier } from '@/components/dd/types';

async function fetchIndex(): Promise<DDSummary[]> {
  const res = await fetch('/api/dd', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load DD index: ${res.status}`);
  const data = (await res.json()) as { dd?: DDSummary[] };
  return data.dd ?? [];
}

function upside(v?: number | null): string {
  if (v == null) return '';
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(0)}% base`;
}

function DDCardRow({ d }: { d: DDSummary }) {
  return (
    <Link
      href={`/dd/${d.id}`}
      className="group flex items-start gap-4 rounded-lg border border-rule px-4 py-3 hover:border-green/50 hover:bg-green-soft/30 transition-colors no-underline"
    >
      <div className="shrink-0 pt-0.5">
        <RatingBadge score={d.score} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-bold text-ink group-hover:text-green-dark">{d.ticker}</span>
          <span className="text-sm text-ink-muted truncate">{d.company}</span>
          {d.upside_base_pct != null && (
            <span className={`ml-auto shrink-0 text-xs font-semibold tabular-nums ${d.upside_base_pct >= 0 ? 'text-green' : 'text-red-600'}`}>
              {upside(d.upside_base_pct)}
            </span>
          )}
        </div>
        <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">{d.one_liner ?? ratingMeta(d.score).label}</p>
        <div className="flex items-center gap-2 mt-1 text-[0.65rem] text-ink-faint">
          {d.sector && <span>{d.sector}</span>}
          {d.confidence && <span>· {d.confidence} confidence</span>}
          {d.group != null && <span>· batch {d.group}</span>}
        </div>
      </div>
    </Link>
  );
}

export function DDIndex() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dd-index'],
    queryFn: fetchIndex,
    staleTime: 60 * 1000,
  });

  const items = useMemo(() => data ?? [], [data]);

  // Group by tier (finalist / bench / cut) when tiers are present, else fall back to a
  // single ungrouped list. Within a tier, sort by rating then base-case upside.
  const tiers = useMemo(() => {
    const map = new Map<DDTier, DDSummary[]>();
    let anyTier = false;
    for (const d of items) {
      const t = (d.tier ?? 'cut') as DDTier;
      if (d.tier) anyTier = true;
      if (!map.has(t)) map.set(t, []);
      map.get(t)!.push(d);
    }
    if (!anyTier) return null;
    for (const rows of map.values()) {
      rows.sort(
        (a, b) => b.score - a.score || (b.upside_base_pct ?? -Infinity) - (a.upside_base_pct ?? -Infinity)
      );
    }
    return TIER_ORDER.filter((t) => map.has(t)).map((t) => ({ tier: t, rows: map.get(t)! }));
  }, [items]);

  return (
    <div className="max-w-[1100px] mx-auto py-10 px-5 md:py-12 md:px-6">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-ink tracking-tight">Due Diligence</h1>
        <p className="text-ink-muted mt-1 max-w-3xl">
          Deep, source-backed DD on the names your screen surfaced. Each report runs the full checklist —
          moat, financial quality, valuation &amp; priced-in expectations, analyst estimates, and
          catalysts — and lands a <strong className="text-ink">1–6 buy rating</strong>. Sorted best
          first.
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-ink-muted text-sm py-8">
          <Spinner /> Loading…
        </div>
      )}

      {error && (
        <Card>
          <EmptyState iconName="folder" title="Could not load DD reports" description={(error as Error).message} />
        </Card>
      )}

      {!isLoading && !error && items.length === 0 && (
        <Card>
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            No DD reports yet. They are generated into{' '}
            <code className="px-1 py-0.5 rounded bg-white/60 font-mono text-[0.9em]">research/dd/&lt;TICKER&gt;.json</code>{' '}
            — see <code className="font-mono text-[0.9em]">research/dd/README.md</code>.
          </div>
        </Card>
      )}

      <div className="space-y-8">
        {(tiers ?? []).map(({ tier, rows }) => {
          const meta = TIER_META[tier];
          return (
            <section key={tier}>
              <div className="flex items-baseline gap-2 mb-1">
                <h2 className="text-base font-bold text-ink">{meta.label}</h2>
                <span className="text-ink-faint text-sm">· {rows.length}</span>
              </div>
              <p className="text-xs text-ink-muted mb-3 max-w-3xl">{meta.blurb}</p>
              <div className={`grid gap-2 ${tier === 'cut' ? 'opacity-60' : ''}`}>
                {rows.map((d) => (
                  <DDCardRow key={d.id} d={d} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
