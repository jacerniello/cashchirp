'use client';

import type { RedTeam, RedCheck, DDSource } from '@/components/dd/types';

const VERDICT_STYLE: Record<string, string> = {
  SURVIVES: 'bg-green-600 text-white',
  CONDITIONAL: 'bg-orange-100 text-orange-700 border border-orange-300',
  FAILS: 'bg-red-soft text-red border border-red-300',
};

const CHECK_STYLE: Record<string, { dot: string; label: string }> = {
  DAMAGING: { dot: 'bg-red-500', label: 'Damaging' },
  NEUTRAL: { dot: 'bg-slate-400', label: 'Neutral' },
  'REFUTES-BEAR': { dot: 'bg-green-500', label: 'Refutes bear' },
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

function CheckRow({ c }: { c: RedCheck }) {
  const s = CHECK_STYLE[c.verdict] ?? { dot: 'bg-slate-400', label: c.verdict };
  return (
    <li className="flex items-start gap-2.5">
      <span className={`inline-block w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${s.dot}`} title={s.label} />
      <div className="flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-semibold text-ink">{c.fact}</span>
          <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-ink-faint">{s.label}</span>
        </div>
        <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">{c.finding}</p>
        {c.source && (
          <p className="text-xs mt-0.5">
            <SourceLink source={c.source} />
          </p>
        )}
      </div>
    </li>
  );
}

export function DDRedTeamBlock({ rt }: { rt: RedTeam }) {
  const vstyle = VERDICT_STYLE[rt.verdict] ?? 'bg-surface text-ink';
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className={`inline-flex items-center px-3 py-1 rounded-md text-sm font-bold ${vstyle}`}>
          {rt.verdict}
        </span>
        {rt.reviewed_price != null && (
          <span className="text-xs text-ink-faint">reviewed at ${rt.reviewed_price.toLocaleString('en-US')}</span>
        )}
      </div>

      {rt.summary && <p className="text-sm text-ink leading-relaxed">{rt.summary}</p>}

      {rt.short_thesis && (
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wide text-ink-muted mb-1">The short thesis</h4>
          <p className="text-sm text-ink-light leading-relaxed">{rt.short_thesis}</p>
        </div>
      )}

      {rt.most_damaging && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <span className="text-xs font-bold uppercase tracking-wide text-red-700">Most damaging finding</span>
          <p className="text-sm text-ink mt-0.5 leading-relaxed">{rt.most_damaging}</p>
        </div>
      )}

      {rt.checks && rt.checks.length > 0 && (
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wide text-ink-muted mb-2">Load-bearing facts, attacked</h4>
          <ul className="space-y-2">
            {rt.checks.map((c, i) => (
              <CheckRow key={i} c={c} />
            ))}
          </ul>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        {rt.inverted_dcf && (
          <div className="rounded-lg border border-rule bg-surface px-3 py-2">
            <div className="text-[0.65rem] uppercase tracking-wide text-ink-faint font-semibold">Inverted DCF (bearish)</div>
            <p className="text-sm text-ink mt-0.5 leading-relaxed">{rt.inverted_dcf}</p>
          </div>
        )}
        {rt.base_rate && (
          <div className="rounded-lg border border-rule bg-surface px-3 py-2">
            <div className="text-[0.65rem] uppercase tracking-wide text-ink-faint font-semibold">Outside view (base rate)</div>
            <p className="text-sm text-ink mt-0.5 leading-relaxed">{rt.base_rate}</p>
          </div>
        )}
        {rt.institutional && (
          <div className="rounded-lg border border-rule bg-surface px-3 py-2">
            <div className="text-[0.65rem] uppercase tracking-wide text-ink-faint font-semibold">Smart-money read</div>
            <p className="text-sm text-ink mt-0.5 leading-relaxed">{rt.institutional}</p>
          </div>
        )}
      </div>

      {rt.recommendation && (
        <div className="rounded-lg border border-red/30 bg-red-soft px-3 py-2">
          <span className="text-xs font-bold uppercase tracking-wide text-red">Red-team recommendation</span>
          <p className="text-sm text-ink mt-0.5 leading-relaxed">{rt.recommendation}</p>
        </div>
      )}

      {rt.memo_file && (
        <p className="text-xs text-ink-faint">
          Full memo: <span className="font-mono">{rt.memo_file}</span>
        </p>
      )}
    </div>
  );
}
