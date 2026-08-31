'use client';

import Link from 'next/link';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import {
  RatingBadge,
  ThesisPoints,
  ChecklistTable,
  ExpectationsGap,
  ScenarioBars,
  CatalystList,
  SourceList,
} from '@/components/dd/DDBlocks';
import { DDChartBlock } from '@/components/dd/DDCharts';
import { DDDeepBlock } from '@/components/dd/DDDeep';
import { DDRedTeamBlock } from '@/components/dd/DDRedTeam';
import { ratingMeta, TIER_META, type DDReport } from '@/components/dd/types';

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <h2 className="text-lg font-bold text-ink mb-1">{title}</h2>
      {subtitle && <p className="text-xs text-ink-muted mb-4">{subtitle}</p>}
      {!subtitle && <div className="mb-4" />}
      {children}
    </Card>
  );
}

function Prose({ text }: { text?: string }) {
  if (!text) return null;
  return <p className="text-sm text-ink leading-relaxed whitespace-pre-line">{text}</p>;
}

export function DDReportView({
  report,
  showBackLink = true,
}: {
  report: DDReport;
  showBackLink?: boolean;
}) {
  const r = report;
  const meta = ratingMeta(r.rating?.score ?? 0);
  const price = r.price;
  const foot = [
    r.asof ? `as-of ${r.asof}` : null,
    r.generated_at ? `generated ${r.generated_at.slice(0, 10)}` : null,
    r.group != null ? `batch ${r.group}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="bg-surface min-h-screen">
      {/* Header */}
      <div className="bg-white border-b border-rule">
        <div className="max-w-[1000px] mx-auto px-5 md:px-6 py-6">
          {showBackLink && (
            <Link href="/dd" className="text-xs text-ink-muted hover:text-green">← All DD reports</Link>
          )}
          <div className="flex items-start justify-between gap-4 flex-wrap mt-3">
            <div className="flex items-start gap-4">
              <RatingBadge score={r.rating?.score ?? 0} size="lg" />
              <div>
                <h1 className="text-2xl font-bold text-ink tracking-tight">
                  {r.ticker} <span className="text-ink-light font-medium text-xl">{r.company}</span>
                </h1>
                <p className="text-sm font-semibold text-ink-light mt-0.5">{r.rating?.label ?? meta.label}</p>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  {r.tier && (
                    <span className={`inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-md ${TIER_META[r.tier].badge}`}>
                      {TIER_META[r.tier].label.replace(/s$/, '')}
                    </span>
                  )}
                  {r.sector && <Badge variant="green">{r.sector}</Badge>}
                  {r.industry && <Badge variant="gray">{r.industry}</Badge>}
                  {r.rating?.confidence && <Badge variant="blue">{r.rating.confidence} confidence</Badge>}
                  {r.permaticker != null && (
                    <Link
                      href={`/company/${Math.trunc(Number(r.permaticker))}`}
                      className="text-xs text-green hover:text-green-dark font-semibold"
                    >
                      Company page ↗
                    </Link>
                  )}
                </div>
              </div>
            </div>

            {/* Price / fair-value snapshot */}
            {price && (
              <div className="text-right">
                {price.current != null && (
                  <div className="text-2xl font-bold text-ink tabular-nums">
                    ${price.current.toLocaleString('en-US')}
                  </div>
                )}
                {price.fair_value_base != null && (
                  <div className="text-sm text-ink-muted">
                    base FV{' '}
                    <span className="font-semibold text-ink">${price.fair_value_base.toLocaleString('en-US')}</span>
                    {price.upside_base_pct != null && (
                      <span className={`ml-1 font-semibold ${price.upside_base_pct >= 0 ? 'text-green' : 'text-red-600'}`}>
                        ({price.upside_base_pct >= 0 ? '+' : ''}
                        {(price.upside_base_pct * 100).toFixed(0)}%)
                      </span>
                    )}
                  </div>
                )}
                {(price.fair_value_bear != null || price.fair_value_bull != null) && (
                  <div className="text-xs text-ink-faint mt-0.5">
                    bear ${price.fair_value_bear?.toLocaleString('en-US') ?? '—'} · bull $
                    {price.fair_value_bull?.toLocaleString('en-US') ?? '—'}
                  </div>
                )}
              </div>
            )}
          </div>
          {r.rating?.one_liner && (
            <div className="mt-4 rounded-lg border border-green/30 bg-green-soft px-4 py-3 text-sm text-green-text">
              <strong className="font-semibold">Rating {r.rating.score}/6: </strong>
              {r.rating.one_liner}
            </div>
          )}
          {foot && <div className="text-xs text-ink-faint mt-3">{foot}</div>}
        </div>
      </div>

      {/* Body */}
      <div className="max-w-[1000px] mx-auto px-5 md:px-6 py-6 space-y-6">
        {r.tldr && (
          <Card>
            <h2 className="text-lg font-bold text-ink mb-2">TL;DR</h2>
            <Prose text={r.tldr} />
          </Card>
        )}

        {/* Deep DD (round 2) — reverse-DCF, expected return, KPI trace, peers, insiders, falsification */}
        {r.deep && Object.keys(r.deep).length > 0 && (
          <Card className="border-l-4 border-l-green">
            <h2 className="text-lg font-bold text-ink mb-1">Deep DD</h2>
            <p className="text-xs text-ink-muted mb-4">
              Round-2 quantitative work — computed valuation, expected return, the one KPI that matters,
              peers, ownership signal, and the metric that would prove the thesis wrong.
            </p>
            <DDDeepBlock deep={r.deep} current={r.price?.current} />
          </Card>
        )}

        {/* Charts — graphs front and center */}
        {r.charts && r.charts.length > 0 && (
          <Section title="Charts" subtitle="Price &amp; catalysts · priced-in expectations · valuation vs history · estimates.">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {r.charts.map((c) => (
                <div key={c.id} className={c.type === 'price_catalysts' ? 'lg:col-span-2' : ''}>
                  <DDChartBlock chart={c} />
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Bull / Bear */}
        {(r.bull_case || r.bear_case) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {r.bull_case && (
              <Card>
                <h2 className="text-lg font-bold text-green-dark mb-3">Bull case</h2>
                <Prose text={r.bull_case} />
              </Card>
            )}
            {r.bear_case && (
              <Card>
                <h2 className="text-lg font-bold text-red-700 mb-3">Bear case</h2>
                <Prose text={r.bear_case} />
              </Card>
            )}
          </div>
        )}

        {r.thesis_points && r.thesis_points.length > 0 && (
          <Section title="Thesis points" subtitle="Each claim tagged by evidence quality and sourced.">
            <ThesisPoints points={r.thesis_points} />
          </Section>
        )}

        {r.expectations && (
          <Section title="Priced-in expectations vs reality" subtitle="What today's price bakes in, and where we / consensus differ.">
            <ExpectationsGap exp={r.expectations} />
          </Section>
        )}

        {r.scenarios && r.scenarios.length > 0 && (
          <Section title="Scenario fair value" subtitle="Bear / base / bull targets with explicit assumptions.">
            <ScenarioBars scenarios={r.scenarios} current={price?.current} />
          </Section>
        )}

        {r.analyst_estimates && (
          <Section title="Analyst estimates & consensus">
            <div className="flex flex-wrap gap-4 mb-3">
              {r.analyst_estimates.consensus_pt != null && (
                <div className="rounded-lg border border-rule px-4 py-3 bg-surface">
                  <div className="text-[0.65rem] uppercase tracking-wide text-ink-faint font-semibold">Consensus PT</div>
                  <div className="text-xl font-bold text-ink tabular-nums">
                    ${r.analyst_estimates.consensus_pt.toLocaleString('en-US')}
                  </div>
                </div>
              )}
              {r.analyst_estimates.rating_dist && (
                <div className="rounded-lg border border-rule px-4 py-3 bg-surface">
                  <div className="text-[0.65rem] uppercase tracking-wide text-ink-faint font-semibold">
                    Ratings{r.analyst_estimates.n_analysts ? ` (${r.analyst_estimates.n_analysts})` : ''}
                  </div>
                  <div className="text-sm font-semibold text-ink mt-1">{r.analyst_estimates.rating_dist}</div>
                </div>
              )}
            </div>
            {r.analyst_estimates.note && <Prose text={r.analyst_estimates.note} />}
            {r.analyst_estimates.source?.url && (
              <p className="text-xs mt-2">
                <a href={r.analyst_estimates.source.url} target="_blank" rel="noreferrer" className="text-green hover:text-green-dark">
                  {r.analyst_estimates.source.label ?? 'source'}
                </a>
              </p>
            )}
          </Section>
        )}

        {r.catalysts && r.catalysts.length > 0 && (
          <Section title="Catalysts" subtitle="Past price reactions and identifiable forward triggers.">
            <CatalystList catalysts={r.catalysts} />
          </Section>
        )}

        {r.checklist && r.checklist.length > 0 && (
          <Section title="DD checklist" subtitle="Full protocol — every item resolved with a finding and sources.">
            <ChecklistTable items={r.checklist} />
          </Section>
        )}

        {r.risks && r.risks.length > 0 && (
          <Section title="Key risks">
            <ul className="list-disc pl-5 space-y-1.5 text-sm text-ink">
              {r.risks.map((x, i) => (
                <li key={i} className="leading-relaxed">{x}</li>
              ))}
            </ul>
          </Section>
        )}

        {r.verdict && (
          <Card className="border-l-4 border-l-green">
            <h2 className="text-lg font-bold text-ink mb-3">Verdict</h2>
            <Prose text={r.verdict} />
          </Card>
        )}

        {/* Red-team / disconfirmation pass — the adversarial "try to kill it" review */}
        {r.red_team && (
          <Card className="border-l-4 border-l-red-500">
            <h2 className="text-lg font-bold text-ink mb-1">Red-team / bear assessment</h2>
            <p className="text-xs text-ink-muted mb-4">
              An adversarial pass whose only job was to disprove the bull thesis — load-bearing facts
              re-verified, the DCF inverted, the short case and base rate weighed.
            </p>
            <DDRedTeamBlock rt={r.red_team} />
          </Card>
        )}

        {/* Tempered conclusion — the balanced read after weighing bull and bear */}
        {r.tempered_conclusion && (
          <Card className="border-l-4 border-l-blue-500">
            <h2 className="text-lg font-bold text-ink mb-3">Tempered conclusion</h2>
            <Prose text={r.tempered_conclusion} />
          </Card>
        )}

        {r.data_gaps && r.data_gaps.length > 0 && (
          <Section title="Data gaps">
            <ul className="list-disc pl-5 space-y-1 text-sm text-ink-muted">
              {r.data_gaps.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </Section>
        )}

        {r.sources && r.sources.length > 0 && (
          <Section title="Sources">
            <SourceList sources={r.sources} />
          </Section>
        )}
      </div>
    </div>
  );
}
