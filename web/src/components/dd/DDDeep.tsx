'use client';

import { DDChartBlock } from './DDCharts';
import type {
  DDDeep,
  ReverseDcf,
  ExpectedReturn,
  KpiTrace,
  PeerComps,
  InsiderSignal,
  Falsification,
  DDSource,
} from '@/components/dd/types';

function SourceLink({ source }: { source?: DDSource }) {
  if (!source?.url && !source?.label) return null;
  if (!source.url) return <span className="text-ink-faint">{source.label}</span>;
  return (
    <a href={source.url} target="_blank" rel="noreferrer" className="text-green hover:text-green-dark break-words">
      {source.label ?? source.url}
    </a>
  );
}

function pct(v?: number | null): string {
  if (v == null) return '—';
  return `${(Math.abs(v) <= 3 ? v * 100 : v).toFixed(1)}%`;
}
function money(v?: number | null): string {
  if (v == null) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toLocaleString('en-US')}`;
}
function cell(v: unknown, kind?: string): string {
  if (v == null || (typeof v === 'number' && Number.isNaN(v))) return '—';
  if (typeof v !== 'number') return String(v);
  switch (kind) {
    case 'pct':
      return pct(v);
    case 'cap':
      return money(v);
    case 'ratio':
      return `${v.toFixed(1)}×`;
    case 'number':
      return v.toLocaleString('en-US');
    default:
      return String(v);
  }
}

// ---- reverse DCF + sensitivity grid ------------------------------------------------------

function ReverseDcfBlock({ rd, current }: { rd: ReverseDcf; current?: number }) {
  const s = rd.sensitivity;
  return (
    <div>
      {rd.summary && <p className="text-sm text-ink leading-relaxed mb-3">{rd.summary}</p>}
      <div className="flex flex-wrap gap-4 mb-4">
        {rd.fair_value != null && (
          <div className="rounded-lg border border-rule px-4 py-3 bg-surface">
            <div className="text-[0.65rem] uppercase tracking-wide text-ink-faint font-semibold">DCF fair value</div>
            <div className="text-xl font-bold text-ink tabular-nums">${rd.fair_value.toLocaleString('en-US')}</div>
            {current != null && (
              <div className={`text-[0.7rem] font-semibold ${rd.fair_value >= current ? 'text-green' : 'text-red-600'}`}>
                {rd.fair_value >= current ? '+' : ''}
                {(((rd.fair_value - current) / current) * 100).toFixed(0)}% vs ${current.toLocaleString('en-US')}
              </div>
            )}
          </div>
        )}
        {rd.implied_growth_pct != null && (
          <div className="rounded-lg border border-rule px-4 py-3 bg-surface">
            <div className="text-[0.65rem] uppercase tracking-wide text-ink-faint font-semibold">Price-implied growth</div>
            <div className="text-xl font-bold text-ink tabular-nums">{pct(rd.implied_growth_pct)}</div>
            <div className="text-[0.65rem] text-ink-muted">what today&apos;s price requires</div>
          </div>
        )}
      </div>
      {rd.assumptions && Object.keys(rd.assumptions).length > 0 && (
        <p className="text-xs text-ink-faint mb-3">
          Assumptions:{' '}
          {Object.entries(rd.assumptions)
            .map(([k, v]) => `${k.replace(/_/g, ' ')} ${typeof v === 'number' && Math.abs(v) < 1 ? pct(v) : v}`)
            .join(' · ')}
        </p>
      )}
      {s && s.values?.length > 0 && (
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse">
            <thead>
              <tr>
                <th className="px-2 py-1 text-left text-ink-faint font-semibold">fair value</th>
                {s.cols.map((c) => (
                  <th key={c} className="px-2.5 py-1 text-right text-ink-muted font-semibold">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.rows.map((rlabel, ri) => (
                <tr key={rlabel} className="border-t border-rule">
                  <td className="px-2 py-1 text-ink-muted font-semibold whitespace-nowrap">{rlabel}</td>
                  {s.cols.map((_, ci) => {
                    const v = s.values[ri]?.[ci];
                    const tone =
                      v != null && current != null
                        ? v >= current * 1.5
                          ? 'bg-green-soft text-green-text'
                          : v <= current
                            ? 'bg-red-soft text-red'
                            : ''
                        : '';
                    return (
                      <td key={ci} className={`px-2.5 py-1 text-right tabular-nums text-ink ${tone}`}>
                        {v == null ? '—' : `$${Math.round(v).toLocaleString('en-US')}`}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[0.65rem] text-ink-faint mt-1">
            Green ≥ +50% vs current; red ≤ current. Each cell = DCF fair value at that WACC × terminal-growth pair.
          </p>
        </div>
      )}
    </div>
  );
}

// ---- expected return / IRR ---------------------------------------------------------------

function ExpectedReturnBlock({ er }: { er: ExpectedReturn }) {
  return (
    <div>
      <div className="flex flex-wrap gap-4 mb-3">
        {er.ev_price_target != null && (
          <div className="rounded-lg border border-rule px-4 py-3 bg-surface">
            <div className="text-[0.65rem] uppercase tracking-wide text-ink-faint font-semibold">Prob-weighted target</div>
            <div className="text-xl font-bold text-ink tabular-nums">${er.ev_price_target.toLocaleString('en-US')}</div>
            {er.ev_return_pct != null && (
              <div className={`text-[0.7rem] font-semibold ${er.ev_return_pct >= 0 ? 'text-green' : 'text-red-600'}`}>
                {er.ev_return_pct >= 0 ? '+' : ''}
                {(er.ev_return_pct * 100).toFixed(0)}% expected
              </div>
            )}
          </div>
        )}
        {er.irr_pct != null && (
          <div className="rounded-lg border border-rule px-4 py-3 bg-surface">
            <div className="text-[0.65rem] uppercase tracking-wide text-ink-faint font-semibold">
              IRR{er.horizon_years ? ` (${er.horizon_years}y)` : ''}
            </div>
            <div className="text-xl font-bold text-ink tabular-nums">{pct(er.irr_pct)}</div>
            <div className="text-[0.65rem] text-ink-muted">annualized</div>
          </div>
        )}
      </div>
      {er.breakeven && (
        <p className="text-sm text-ink leading-relaxed">
          <strong className="font-semibold">Breakeven: </strong>
          {er.breakeven}
        </p>
      )}
      {er.note && <p className="text-xs text-ink-muted mt-1 leading-relaxed">{er.note}</p>}
    </div>
  );
}

// ---- KPI trace (the single leading indicator) --------------------------------------------

function KpiTraceBlock({ k }: { k: KpiTrace }) {
  const hasPts = (k.points ?? []).some((p) => p.value != null);
  return (
    <div>
      {k.thesis_signal && (
        <p className="text-sm text-ink leading-relaxed mb-3">
          <strong className="font-semibold">Thesis signal: </strong>
          {k.thesis_signal}
        </p>
      )}
      {hasPts && (
        <DDChartBlock
          chart={{
            id: 'kpi',
            type: 'multiline',
            title: k.name,
            yFormat: k.yFormat ?? 'percent',
            series: [{ label: k.name, points: k.points }],
          }}
        />
      )}
      {k.verdict && (
        <div className="mt-3 rounded-lg border border-rule bg-surface px-3 py-2 text-sm text-ink">
          <strong className="font-semibold">Read: </strong>
          {k.verdict}
        </div>
      )}
      {k.source && (
        <p className="text-xs mt-2">
          <SourceLink source={k.source} />
        </p>
      )}
    </div>
  );
}

// ---- peer comps --------------------------------------------------------------------------

function PeerCompsTable({ pc }: { pc: PeerComps }) {
  const cols = pc.columns ?? [];
  return (
    <div>
      {pc.note && <p className="text-xs text-ink-muted mb-2">{pc.note}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-rule">
              {cols.map((c) => (
                <th
                  key={c.id}
                  className={`px-2.5 py-1.5 text-ink-muted font-semibold ${c.kind && c.kind !== 'text' ? 'text-right' : 'text-left'}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(pc.rows ?? []).map((row, ri) => {
              const self = (row as { self?: boolean }).self;
              return (
                <tr key={ri} className={`border-b border-rule/60 ${self ? 'bg-green-soft/40 font-semibold' : ''}`}>
                  {cols.map((c) => (
                    <td
                      key={c.id}
                      className={`px-2.5 py-1.5 ${c.kind && c.kind !== 'text' ? 'text-right tabular-nums text-ink' : 'text-ink'}`}
                    >
                      {cell(row[c.id], c.kind)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- insider / institutional signal ------------------------------------------------------

function InsiderSignalBlock({ s }: { s: InsiderSignal }) {
  return (
    <div>
      {s.summary && <p className="text-sm text-ink leading-relaxed mb-2">{s.summary}</p>}
      <div className="flex flex-wrap gap-4">
        {s.insider_net_value != null && (
          <div className="rounded-lg border border-rule px-4 py-3 bg-surface">
            <div className="text-[0.65rem] uppercase tracking-wide text-ink-faint font-semibold">
              Insider net{s.window ? ` (${s.window})` : ''}
            </div>
            <div className={`text-xl font-bold tabular-nums ${s.insider_net_value >= 0 ? 'text-green' : 'text-red-600'}`}>
              {money(s.insider_net_value)}
            </div>
          </div>
        )}
        {s.institutional_trend && (
          <div className="rounded-lg border border-rule px-4 py-3 bg-surface">
            <div className="text-[0.65rem] uppercase tracking-wide text-ink-faint font-semibold">Institutional</div>
            <div className="text-sm font-semibold text-ink mt-1">{s.institutional_trend}</div>
          </div>
        )}
      </div>
      {s.source && (
        <p className="text-xs mt-2">
          <SourceLink source={s.source} />
        </p>
      )}
    </div>
  );
}

// ---- pre-registered falsification --------------------------------------------------------

function FalsificationBlock({ f }: { f: Falsification }) {
  return (
    <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
      {f.hypothesis && (
        <p className="text-sm text-ink mb-2">
          <strong className="font-semibold">Hypothesis: </strong>
          {f.hypothesis}
        </p>
      )}
      {f.kill_criteria && (
        <p className="text-sm text-orange-800">
          <strong className="font-semibold">Kills the thesis if: </strong>
          {f.kill_criteria}
        </p>
      )}
      <div className="text-xs text-ink-faint mt-2 flex flex-wrap gap-x-3">
        {f.check_by && <span>check by {f.check_by}</span>}
        {f.experiment_file && <span className="font-mono">{f.experiment_file}</span>}
      </div>
    </div>
  );
}

// ---- container ---------------------------------------------------------------------------

function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-bold uppercase tracking-wide text-ink-muted mb-2">{title}</h3>
      {children}
    </div>
  );
}

export function DDDeepBlock({ deep, current }: { deep: DDDeep; current?: number }) {
  return (
    <div className="space-y-6">
      {deep.reverse_dcf && (
        <Sub title="Reverse DCF & sensitivity">
          <ReverseDcfBlock rd={deep.reverse_dcf} current={current} />
        </Sub>
      )}
      {deep.expected_return && (
        <Sub title="Probability-weighted return">
          <ExpectedReturnBlock er={deep.expected_return} />
        </Sub>
      )}
      {deep.kpi_trace && (
        <Sub title="Leading KPI">
          <KpiTraceBlock k={deep.kpi_trace} />
        </Sub>
      )}
      {deep.peer_comps && (
        <Sub title="Peer comparison">
          <PeerCompsTable pc={deep.peer_comps} />
        </Sub>
      )}
      {deep.insider_signal && (
        <Sub title="Insider & institutional signal">
          <InsiderSignalBlock s={deep.insider_signal} />
        </Sub>
      )}
      {deep.falsification && (
        <Sub title="Pre-registered falsification">
          <FalsificationBlock f={deep.falsification} />
        </Sub>
      )}
    </div>
  );
}
