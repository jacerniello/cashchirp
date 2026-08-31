'use client';

import Link from 'next/link';
import { useIdeas, type IdeaCompany } from '@/hooks/useIdeas';
import { LiveResults } from '../filter/components/LiveResults';
import { Card, Spinner } from '../filter/components/shared';
import { formatMarketCap, formatRatio, formatPercent } from '../filter/utils';
import { ScreenerAreaNav } from '@/components/nav/AreaSubNav';

// Idea board — the ACTIVE screen (ACTIVE_SCREEN -> config/screens/<id>.yaml) run live on
// the snapshot, annotated with the user's own notes from research/watchlist/annotations.json.
// The title and description come from the screen spec, so this page describes whatever
// filter you have active rather than naming one. Reuses the screener's LiveResults grid.
export default function IdeasPage() {
  const { data, isLoading, error } = useIdeas();
  const ideas = (data?.results ?? []).filter((c) => c.thesis);
  const flagged = (data?.results ?? []).filter((c) => c.caution);

  return (
    <div className="bg-white min-h-[calc(100vh-200px)] font-sans">
      <ScreenerAreaNav />
      {/* Header */}
      <div className="py-16 px-8 pb-12 text-center border-b border-rule">
        <h1 className="font-sans text-[2.5rem] font-bold tracking-tight text-ink mb-3">
          {data?.screen?.title || 'Ideas'}
        </h1>
        <p className="text-lg text-ink-light max-w-2xl mx-auto">
          {data?.screen?.description
            || 'Everything your active screen surfaces, run live on the latest snapshot.'}
        </p>
        <p className="text-sm text-ink-muted max-w-2xl mx-auto mt-3">
          Candidates to research, not recommendations.
          {data?.screen?.id && (
            <>
              {' '}Screen{' '}
              <code className="font-mono text-[0.9em]">{data.screen.id}</code> — edit it in{' '}
              <code className="font-mono text-[0.9em]">config/screens/</code>.
            </>
          )}
        </p>
        {data?.asof && (
          <p className="text-xs text-ink-muted mt-4">Numbers as of {data.asof}</p>
        )}
      </div>

      <div className="max-w-[1400px] mx-auto py-12 px-6 space-y-6">
        {/* How the list was built */}
        {data?.criteria && (
          <Card>
            <div className="p-5">
              <h2 className="text-sm font-semibold text-ink mb-3 uppercase tracking-wide">
                How this list was built
              </h2>
              <ul className="space-y-1.5">
                {data.criteria.map((c) => (
                  <li key={c} className="flex items-start gap-2 text-sm text-ink-light">
                    <span className="mt-0.5 text-green">•</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        )}

        {/* Results table — the screener grid, reused verbatim */}
        <div>
          <Card className="mb-4">
            <div className="flex items-center justify-between gap-4 p-4">
              <div className="text-sm text-ink-muted">
                <span className="font-semibold text-ink">{data?.total ?? 0}</span> survivors
                {data && (
                  <span className="text-ink-muted">
                    {' '}· <span className="text-green font-medium">{data.ideas}</span> with a thesis
                    {' '}· <span className="text-amber-600 font-medium">{data.flagged}</span> flagged
                  </span>
                )}
              </div>
              <Link href="/filter" className="text-sm font-medium text-green hover:text-green-dark">
                Screen further →
              </Link>
            </div>
          </Card>

          <Card>
            {isLoading ? (
              <Spinner className="h-5 w-5 text-green" />
            ) : error ? (
              <div className="text-center py-12">
                <p className="text-ink-light">Error loading ideas. Please try again.</p>
              </div>
            ) : (
              <LiveResults
                results={data?.results || []}
                page={1}
                totalPages={1}
                onPageChange={() => {}}
              />
            )}
          </Card>
        </div>

        {/* Bull-thesis cards: the overhang (why it's unloved) → the double mechanism */}
        {ideas.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-ink mb-3 uppercase tracking-wide">
              The case, name by name
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              {ideas.map((c) => (
                <ThesisCard key={c.permaticker ?? c.ticker} company={c} />
              ))}
            </div>
          </div>
        )}

        {/* Flagged: caught by the screen, but I'd be wary — labelled, not hidden. */}
        {flagged.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-ink mb-1 uppercase tracking-wide">
              Flagged — screen further
            </h2>
            <p className="text-sm text-ink-muted mb-3">
              These pass the mechanical filter but look like value traps or are otherwise
              compromised. Shown for completeness, not as ideas.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {flagged.map((c) => (
                <CautionCard key={c.permaticker ?? c.ticker} company={c} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CardHead({ company }: { company: IdeaCompany }) {
  const permaticker = company.permaticker ?? company.cik;
  const href = permaticker ? `/company/${permaticker}` : '#';
  return (
    <>
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <Link href={href} className="font-semibold text-green hover:text-green-dark">
          {company.ticker?.toUpperCase()} ·{' '}
          <span className="text-ink font-medium">{company.name}</span>
        </Link>
        <span className="text-xs text-ink-muted whitespace-nowrap">
          {formatMarketCap(company.market_cap)}
        </span>
      </div>
      {company.industry && (
        <div className="text-[11px] text-ink-muted mb-3">{company.industry}</div>
      )}
      {/* Compact metric strip — the quality + cheapness at a glance */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-light mb-3 font-mono">
        <span>P/E {formatRatio(company.pe_ratio)}</span>
        <span>EV/EBITDA {formatRatio(company.ev_ebitda)}</span>
        <span>ROIC {formatPercent(company.roic)}</span>
        <span>Net M {formatPercent(company.profit_margin)}</span>
        <span>Off high {formatPercent(company.pct_below_high)}</span>
      </div>
    </>
  );
}

function ThesisCard({ company }: { company: IdeaCompany }) {
  return (
    <Card>
      <div className="p-5">
        <CardHead company={company} />
        <p className="text-sm text-ink-light mb-2">
          <span className="font-semibold text-ink">Why it&apos;s unloved: </span>
          {company.why_unloved}
        </p>
        <p className="text-sm text-ink-light">
          <span className="font-semibold text-ink">The thesis: </span>
          {company.thesis}
        </p>
      </div>
    </Card>
  );
}

function CautionCard({ company }: { company: IdeaCompany }) {
  return (
    <div className="bg-amber-50/50 rounded-xl border border-amber-200 shadow-sm">
      <div className="p-5">
        <CardHead company={company} />
        <p className="text-sm text-ink-light">
          <span className="font-semibold text-amber-700">⚑ Flag: </span>
          {company.caution}
        </p>
      </div>
    </div>
  );
}
