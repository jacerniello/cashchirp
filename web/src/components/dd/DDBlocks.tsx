'use client';

import { useMemo } from 'react';
import {
  ratingMeta,
  type DDChecklistItem,
  type DDScenario,
  type DDExpectations,
  type DDThesisPoint,
  type DDCatalyst,
  type DDSource,
  type ChecklistStatus,
} from '@/components/dd/types';

// ---- rating badge ------------------------------------------------------------------------

export function RatingBadge({
  score,
  label,
  size = 'md',
}: {
  score: number;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const meta = ratingMeta(score);
  const dims = size === 'lg' ? 'text-2xl w-12 h-12' : size === 'sm' ? 'text-sm w-7 h-7' : 'text-lg w-9 h-9';
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`inline-flex items-center justify-center rounded-lg font-bold ${meta.badge} ${dims}`}>
        {score}
      </span>
      {label !== undefined && (
        <span className="text-xs font-semibold text-ink-light">{label || meta.label}</span>
      )}
    </span>
  );
}

// ---- thesis points -----------------------------------------------------------------------

const CONF_BADGE: Record<string, string> = {
  verified: 'bg-green-soft text-green-text',
  reported: 'bg-blue-soft text-blue-text',
  uncertain: 'bg-orange-100 text-orange-700',
};

function SourceLink({ source }: { source?: DDSource }) {
  if (!source?.url && !source?.label) return null;
  if (!source.url) return <span className="text-ink-faint">{source.label}</span>;
  return (
    <a href={source.url} target="_blank" rel="noreferrer" className="text-green hover:text-green-dark break-words">
      {source.label ?? source.url}
    </a>
  );
}

export function ThesisPoints({ points }: { points?: DDThesisPoint[] }) {
  if (!points?.length) return null;
  return (
    <ul className="space-y-3">
      {points.map((p, i) => (
        <li key={i} className="border-l-2 border-rule pl-3">
          <div className="flex items-start gap-2">
            <span className="text-sm text-ink font-medium flex-1">{p.claim}</span>
            {p.confidence && (
              <span className={`shrink-0 px-1.5 py-0.5 rounded text-[0.65rem] font-semibold ${CONF_BADGE[p.confidence] ?? 'bg-surface text-ink-faint'}`}>
                {p.confidence}
              </span>
            )}
          </div>
          {p.evidence && <p className="text-xs text-ink-muted mt-1 leading-relaxed">{p.evidence}</p>}
          {p.source && (
            <p className="text-xs mt-1">
              <SourceLink source={p.source} />
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

// ---- checklist ---------------------------------------------------------------------------

const STATUS_META: Record<ChecklistStatus, { dot: string; label: string }> = {
  pass: { dot: 'bg-green-500', label: 'Pass' },
  warn: { dot: 'bg-amber-500', label: 'Watch' },
  fail: { dot: 'bg-red-500', label: 'Fail' },
  na: { dot: 'bg-slate-300', label: 'N/A' },
};

export function ChecklistTable({ items }: { items?: DDChecklistItem[] }) {
  // Group by section, preserving first-seen order.
  const groups = useMemo(() => {
    const out: { section: string; rows: DDChecklistItem[] }[] = [];
    for (const it of items ?? []) {
      let g = out.find((x) => x.section === it.section);
      if (!g) {
        g = { section: it.section, rows: [] };
        out.push(g);
      }
      g.rows.push(it);
    }
    return out;
  }, [items]);

  const counts = useMemo(() => {
    const c: Record<ChecklistStatus, number> = { pass: 0, warn: 0, fail: 0, na: 0 };
    for (const it of items ?? []) c[it.status] = (c[it.status] ?? 0) + 1;
    return c;
  }, [items]);

  if (!items?.length) return null;

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4 text-xs">
        {(Object.keys(STATUS_META) as ChecklistStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`inline-block w-2.5 h-2.5 rounded-full ${STATUS_META[s].dot}`} />
            <span className="text-ink-muted">
              {STATUS_META[s].label}: <strong className="text-ink">{counts[s]}</strong>
            </span>
          </span>
        ))}
      </div>
      <div className="space-y-5">
        {groups.map((g) => (
          <div key={g.section}>
            <h4 className="text-xs font-bold uppercase tracking-wide text-ink-muted mb-2">{g.section}</h4>
            <ul className="space-y-2">
              {g.rows.map((it, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span
                    className={`inline-block w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${STATUS_META[it.status]?.dot ?? 'bg-slate-300'}`}
                    title={STATUS_META[it.status]?.label}
                  />
                  <div className="flex-1">
                    <span className="text-sm font-medium text-ink">{it.item}</span>
                    {it.finding && <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">{it.finding}</p>}
                    {it.sources && it.sources.length > 0 && (
                      <p className="text-xs mt-0.5 space-x-2">
                        {it.sources.map((s, si) => (
                          <SourceLink key={si} source={s} />
                        ))}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- expectations gap (priced-in vs reality) ---------------------------------------------

function pct(v?: number): string {
  if (v == null) return '—';
  return `${(Math.abs(v) <= 3 ? v * 100 : v).toFixed(1)}%`;
}

export function ExpectationsGap({ exp }: { exp?: DDExpectations }) {
  if (!exp) return null;
  const implied = exp.implied_growth_pct;
  const reference = exp.reference_growth_pct;
  const hasGap = implied != null && reference != null;
  const cheap = hasGap && reference! > implied!;
  return (
    <div>
      {exp.summary && <p className="text-sm text-ink leading-relaxed mb-3">{exp.summary}</p>}
      {hasGap && (
        <div className="flex flex-wrap gap-4">
          <div className="rounded-lg border border-rule px-4 py-3 bg-surface">
            <div className="text-[0.65rem] uppercase tracking-wide text-ink-faint font-semibold">Price implies</div>
            <div className="text-xl font-bold text-ink tabular-nums">{pct(implied)}</div>
            <div className="text-[0.65rem] text-ink-muted">growth baked into today&apos;s price</div>
          </div>
          <div className="rounded-lg border border-rule px-4 py-3 bg-surface">
            <div className="text-[0.65rem] uppercase tracking-wide text-ink-faint font-semibold">Reality / consensus</div>
            <div className="text-xl font-bold text-ink tabular-nums">{pct(reference)}</div>
            <div className="text-[0.65rem] text-ink-muted">our / consensus estimate</div>
          </div>
          <div className={`rounded-lg px-4 py-3 ${cheap ? 'border border-green/30 bg-green-soft' : 'border border-orange-200 bg-orange-50'}`}>
            <div className="text-[0.65rem] uppercase tracking-wide font-semibold text-ink-faint">Gap</div>
            <div className={`text-xl font-bold tabular-nums ${cheap ? 'text-green-text' : 'text-orange-700'}`}>
              {pct((reference ?? 0) - (implied ?? 0))}
            </div>
            <div className="text-[0.65rem] text-ink-muted">{cheap ? 'expectations look too low' : 'expectations look full'}</div>
          </div>
        </div>
      )}
      {exp.method && <p className="text-xs text-ink-faint mt-3">Method: {exp.method}</p>}
    </div>
  );
}

// ---- scenarios (bear / base / bull fair-value bars) --------------------------------------

const SCENARIO_TONE: Record<string, string> = {
  bear: 'bg-red-400',
  base: 'bg-slate-500',
  bull: 'bg-green-500',
};

export function ScenarioBars({
  scenarios,
  current,
}: {
  scenarios?: DDScenario[];
  current?: number;
}) {
  if (!scenarios?.length) return null;
  const targets = scenarios.map((s) => s.price_target ?? 0).filter((v) => v > 0);
  const max = Math.max(current ?? 0, ...targets, 1);
  return (
    <div className="space-y-3">
      {scenarios.map((s) => {
        const tone = SCENARIO_TONE[s.name.toLowerCase()] ?? 'bg-slate-500';
        const w = ((s.price_target ?? 0) / max) * 100;
        const ret = s.return_pct;
        return (
          <div key={s.name}>
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="font-semibold text-ink">
                {s.name}
                {s.prob != null && <span className="text-ink-faint font-normal"> · {(s.prob * 100).toFixed(0)}% prob</span>}
              </span>
              <span className="tabular-nums text-ink">
                ${s.price_target?.toLocaleString('en-US')}
                {ret != null && (
                  <span className={ret >= 0 ? 'text-green ml-2' : 'text-red-600 ml-2'}>
                    {ret >= 0 ? '+' : ''}
                    {(ret * 100).toFixed(0)}%
                  </span>
                )}
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-surface overflow-hidden">
              <div className={`h-full rounded-full ${tone}`} style={{ width: `${w}%` }} />
            </div>
            {s.assumptions && <p className="text-xs text-ink-muted mt-1 leading-relaxed">{s.assumptions}</p>}
          </div>
        );
      })}
      {current != null && (
        <p className="text-xs text-ink-faint pt-1">Current price: ${current.toLocaleString('en-US')}</p>
      )}
    </div>
  );
}

// ---- catalysts ---------------------------------------------------------------------------

export function CatalystList({ catalysts }: { catalysts?: DDCatalyst[] }) {
  if (!catalysts?.length) return null;
  const past = catalysts.filter((c) => c.direction !== 'forward');
  const forward = catalysts.filter((c) => c.direction === 'forward');
  return (
    <div className="space-y-5">
      {forward.length > 0 && (
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wide text-ink-muted mb-2">Forward catalysts</h4>
          <ul className="space-y-2">
            {forward.map((c, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="shrink-0 text-xs font-mono text-ink-faint mt-0.5 w-16">{c.date}</span>
                <div className="flex-1">
                  <span className="text-sm font-medium text-ink">{c.title}</span>
                  {c.note && <p className="text-xs text-ink-muted mt-0.5">{c.note}</p>}
                  {c.source && (
                    <p className="text-xs mt-0.5">
                      <SourceLink source={c.source} />
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {past.length > 0 && (
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wide text-ink-muted mb-2">Past price reactions</h4>
          <ul className="space-y-2">
            {past.map((c, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="shrink-0 text-xs font-mono text-ink-faint mt-0.5 w-16">{c.date}</span>
                <div className="flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-ink">{c.title}</span>
                    {c.price_reaction_pct != null && (
                      <span className={`text-xs font-semibold tabular-nums ${c.price_reaction_pct >= 0 ? 'text-green' : 'text-red-600'}`}>
                        {c.price_reaction_pct >= 0 ? '+' : ''}
                        {(c.price_reaction_pct * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                  {c.note && <p className="text-xs text-ink-muted mt-0.5">{c.note}</p>}
                  {c.source && (
                    <p className="text-xs mt-0.5">
                      <SourceLink source={c.source} />
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---- source list -------------------------------------------------------------------------

export function SourceList({ sources }: { sources?: DDSource[] }) {
  if (!sources?.length) return null;
  return (
    <ul className="list-disc pl-5 space-y-1 text-xs">
      {sources.map((s, i) => (
        <li key={i}>
          <SourceLink source={s} />
          {s.accessed && <span className="text-ink-faint"> · accessed {s.accessed}</span>}
        </li>
      ))}
    </ul>
  );
}
