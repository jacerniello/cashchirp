'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { normalizeDD } from '@/components/dd/types';
import { redTeamVerdict, RedTeamVerdictBadge } from '@/components/dd/DDRedTeam';
import { btnGhost, fmtSignedPct, fmtWhen, RatingPill } from './ResearchBits';
import { useResearchStock, type StockDetail } from '@/hooks/useResearch';

// Per-stock research pieces shared by the full research page and the company page's
// Research tab.

interface CompanyProfileResponse {
  profile?: { ticker?: string; name?: string };
}

/** Ticker and name for a stock: research meta first, then the DD file, then the company
 *  profile from the database (fetched only when the research files do not know). */
export function useStockIdentity(pt: string, stock: StockDetail | undefined, stockFailed = false) {
  const dd = stock?.dd as { ticker?: unknown; company?: unknown } | null | undefined;
  const metaTicker = stock?.meta?.ticker || (typeof dd?.ticker === 'string' ? dd.ticker : undefined);
  const metaName = stock?.meta?.name || (typeof dd?.company === 'string' ? dd.company : undefined);
  const need = !!pt && (stockFailed || (!!stock && (!metaTicker || !metaName)));
  // Same key and shape as the company page's own query, so the two share a cache entry.
  const company = useQuery({
    queryKey: ['company', pt],
    queryFn: async (): Promise<CompanyProfileResponse> => (await api.get(`/company/${pt}`)).data,
    enabled: need,
    retry: false,
    staleTime: 10 * 60 * 1000,
  });
  return {
    ticker: metaTicker || company.data?.profile?.ticker || null,
    name: metaName || company.data?.profile?.name || null,
  };
}

/** The headline of a DD: rating, one-liner, price vs base fair value, red-team verdict. */
export function RatingSummary({
  dd,
  redteam,
  updated,
}: {
  dd: unknown;
  redteam?: string | null;
  updated?: string | null;
}) {
  const r = useMemo(() => normalizeDD(dd), [dd]);
  const verdict = redTeamVerdict(redteam);
  const price = r.price;
  const rating = {
    score: r.rating.score || null,
    label: r.rating.label,
    confidence: r.rating.confidence,
    one_liner: r.rating.one_liner,
  };
  return (
    <div className="rounded-xl border border-rule bg-white p-4 flex items-start gap-4 flex-wrap">
      <RatingPill rating={rating} size="lg" showLabel={false} />
      <div className="flex-1 min-w-[220px]">
        <div className="text-sm font-semibold text-ink">
          {rating.score ? `${rating.score}/6 · ${r.rating.label || ''}` : 'Unrated DD'}
          {r.rating.confidence && (
            <span className="ml-2 text-xs font-normal text-ink-faint">{r.rating.confidence} confidence</span>
          )}
        </div>
        {r.rating.one_liner && <p className="text-sm text-ink-light mt-1 mb-0">{r.rating.one_liner}</p>}
        <div className="text-xs text-ink-faint mt-1.5">
          {r.asof ? `as of ${r.asof}` : updated ? `updated ${fmtWhen(updated)}` : ''}
        </div>
      </div>
      {price && (price.current != null || price.fair_value_base != null) && (
        <div className="text-right text-sm">
          {price.current != null && (
            <div className="font-bold text-ink tabular-nums">${price.current.toLocaleString('en-US')}</div>
          )}
          {price.fair_value_base != null && (
            <div className="text-xs text-ink-muted tabular-nums">
              base FV ${price.fair_value_base.toLocaleString('en-US')}
              {price.upside_base_pct != null && (
                <span className={`ml-1 font-semibold ${price.upside_base_pct >= 0 ? 'text-pos' : 'text-neg'}`}>
                  ({fmtSignedPct(price.upside_base_pct)})
                </span>
              )}
            </div>
          )}
        </div>
      )}
      {verdict && (
        <div className="flex flex-col items-end gap-1">
          <span className="text-[10px] uppercase tracking-wide text-ink-faint font-semibold">Red team</span>
          <RedTeamVerdictBadge verdict={verdict} />
        </div>
      )}
    </div>
  );
}

/** The company page's Research tab: a lightweight digest that links to the full page. */
export function CompanyResearchTab({ pt }: { pt: string }) {
  const { data, isLoading, isError } = useResearchStock(pt);
  const href = `/research/stocks/${pt}`;

  if (isLoading) return <p className="text-sm text-ink-muted">Loading research…</p>;
  if (isError || !data) {
    return (
      <div className="rounded-xl border border-rule bg-white p-6 text-sm text-ink-light">
        Could not load research for this stock. Check that the backend is running.
      </div>
    );
  }

  const notesIn = data.notes_in ?? [];
  // Every report the stock is in: those that analysed it (newest first), then those still pending.
  const reports = [
    ...(data.analyses ?? []).map((a) => ({ id: a.report_id, name: a.report_name })),
    ...(data.pending_reports ?? []).map((r) => ({ id: r.id, name: r.name })),
  ];

  return (
    <div className="space-y-4">
      {data.dd ? (
        <RatingSummary dd={data.dd} redteam={data.redteam} updated={data.dd_updated} />
      ) : data.dd_error ? (
        <div className="rounded-xl border border-rule bg-gold-soft p-4 text-sm text-ink-light">
          This stock&apos;s latest dd.json is unreadable ({data.dd_error}).
        </div>
      ) : null}

      <div className="rounded-xl border border-rule bg-white p-5">
        <h2 className="text-lg font-bold text-ink m-0 mb-1">Notes</h2>
        <p className="text-xs text-ink-muted mt-0 mb-3">Notes on a stock belong to a report.</p>
        {notesIn.length ? (
          <ul className="list-none m-0 p-0 divide-y divide-rule-light">
            {notesIn.map((n) => (
              <li key={n.report_id} className="py-2 flex items-center justify-between gap-3">
                <Link href={`/research/reports/${encodeURIComponent(n.report_id)}/stocks/${pt}?tab=notes`}
                      className="text-sm text-ink no-underline hover:text-green">
                  {n.report_name || n.report_id}
                </Link>
                <span className="text-xs text-ink-muted tabular-nums">updated {fmtWhen(n.updated_at, true)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted m-0">No notes on this stock in any report yet.</p>
        )}
      </div>

      <div className="rounded-xl border border-rule bg-white p-5 flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Reports</div>
          {reports.length ? (
            <span className="inline-flex flex-wrap gap-x-3 gap-y-1">
              {reports.slice(0, 6).map((r) => (
                <Link key={r.id} href={`/research/reports/${encodeURIComponent(r.id)}`}
                      className="text-sm text-ink no-underline hover:text-green">
                  {r.name || r.id}
                </Link>
              ))}
              {reports.length > 6 && <span className="text-xs text-ink-muted">+{reports.length - 6}</span>}
            </span>
          ) : (
            <span className="text-xs text-ink-muted">Not in any report yet.</span>
          )}
          {data.snapshots.length > 0 && (
            <div className="text-xs text-ink-muted">
              In {data.snapshots.length} snapshot{data.snapshots.length === 1 ? '' : 's'}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-ink-muted">
            {data.dd
              ? `Latest DD ${fmtWhen(data.latest?.asof || data.latest?.created_at)}${data.latest?.report_name ? ` (${data.latest.report_name})` : ''}`
              : 'No DD'}{' '}
            · {data.redteam ? 'red-teamed' : 'no red team'}
          </span>
          <Link href={href} className={`${btnGhost} no-underline`}>Open full research →</Link>
        </div>
      </div>
    </div>
  );
}
