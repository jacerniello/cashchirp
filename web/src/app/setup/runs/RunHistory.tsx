'use client';

import { useState } from 'react';
import { Badge, type BadgeVariant } from '@/components/Badge';
import { useRunLog, useRuns, type JobRun, type Trigger } from '@/hooks/useJobs';

// Every process this app has started, whoever started it. The trigger column is the
// point: without it a scheduled 3am ingest and a button press look identical afterwards,
// and "why did SEP re-download last night?" has no answer.

const TRIGGER_STYLE: Record<Trigger, { variant: BadgeVariant; label: string }> = {
  scheduled: { variant: 'purple', label: 'Scheduled' },
  manual: { variant: 'blue', label: 'Manual' },
  cli: { variant: 'gray', label: 'CLI' },
};

const STATUS_STYLE: Record<string, BadgeVariant> = {
  running: 'yellow',
  ok: 'green',
  failed: 'red',
  stopped: 'orange',
  unknown: 'gray',
};

function duration(r: JobRun): string {
  if (r.status === 'running' && r.started_at) {
    const secs = (Date.now() - new Date(r.started_at).getTime()) / 1000;
    return `${Math.floor(secs / 60)}m ${Math.floor(secs % 60)}s…`;
  }
  if (r.seconds == null) return '—';
  if (r.seconds < 60) return `${r.seconds.toFixed(1)}s`;
  const m = Math.floor(r.seconds / 60);
  return m < 60 ? `${m}m ${Math.round(r.seconds % 60)}s` : `${(m / 60).toFixed(1)}h`;
}

function when(ts: string | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export function RunHistory() {
  const [trigger, setTrigger] = useState<Trigger | ''>('');
  const [openLog, setOpenLog] = useState<string | null>(null);
  const { data, isLoading, isError } = useRuns({ limit: 200, trigger });
  const logQ = useRunLog(openLog);

  if (isError) {
    return (
      <div className="max-w-[1100px] mx-auto px-6 py-10">
        <div className="rounded-xl border border-rule bg-white p-6 text-sm text-ink-light">
          Could not reach the setup API. Run history is only available where{' '}
          <code className="text-ink">SETUP_ENABLED</code> is on.
        </div>
      </div>
    );
  }

  const runs = data?.runs ?? [];
  const counts = runs.reduce<Record<string, number>>((acc, r) => {
    acc[r.trigger] = (acc[r.trigger] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-10 space-y-6">
      <div className="flex gap-2 flex-wrap items-center">
        {([['', 'All'], ['scheduled', 'Scheduled'], ['manual', 'Manual'], ['cli', 'CLI']] as
          [Trigger | '', string][]).map(([value, label]) => (
          <button
            key={value || 'all'}
            type="button"
            onClick={() => setTrigger(value)}
            className={`rounded-lg border px-3 py-1.5 text-sm cursor-pointer transition-colors
              ${trigger === value
                ? 'border-green bg-green-soft text-green-text font-medium'
                : 'border-rule bg-white text-ink-light hover:border-green'}`}
          >
            {label}
            {value && counts[value] ? ` (${counts[value]})` : ''}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-rule bg-white overflow-hidden">
        {isLoading && <p className="px-6 py-8 text-sm text-ink-muted">Loading…</p>}

        {!isLoading && runs.length === 0 && (
          <p className="px-6 py-8 text-sm text-ink-muted">
            Nothing has run yet{trigger ? ` with trigger “${trigger}”` : ''}. Runs appear
            here the moment one starts, whether you clicked it or a schedule fired it.
          </p>
        )}

        {runs.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-6 py-2 font-medium">Job</th>
                  <th className="px-3 py-2 font-medium">Trigger</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Started</th>
                  <th className="px-3 py-2 font-medium">Took</th>
                  <th className="px-3 py-2 font-medium text-right">Rows</th>
                  <th className="px-6 py-2 font-medium text-right">Log</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const t = TRIGGER_STYLE[r.trigger] ?? TRIGGER_STYLE.cli;
                  return (
                    <tr key={r.id} className="border-t border-rule align-middle">
                      <td className="px-6 py-3">
                        <div className="font-medium text-ink">{r.label ?? r.key}</div>
                        <div className="text-xs text-ink-muted">
                          {r.key}{r.mode ? ` · ${r.mode}` : ''}
                        </div>
                      </td>
                      <td className="px-3 py-3"><Badge variant={t.variant}>{t.label}</Badge></td>
                      <td className="px-3 py-3">
                        <Badge variant={STATUS_STYLE[r.status] ?? 'gray'}>{r.status}</Badge>
                      </td>
                      <td className="px-3 py-3 text-ink-light text-xs">{when(r.started_at)}</td>
                      <td className="px-3 py-3 text-ink-light">{duration(r)}</td>
                      <td className="px-3 py-3 text-right text-ink-light tabular-nums">
                        {r.rows?.toLocaleString() ?? '—'}
                      </td>
                      <td className="px-6 py-3 text-right">
                        {r.log ? (
                          <button
                            type="button"
                            onClick={() => setOpenLog(openLog === r.log ? null : r.log)}
                            className="rounded-md border border-rule bg-white px-2.5 py-1 text-xs
                                       text-ink-light cursor-pointer hover:border-green hover:text-green"
                          >
                            {openLog === r.log ? 'Hide' : 'View'}
                          </button>
                        ) : (
                          <span className="text-xs text-ink-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openLog && (
        <div className="rounded-xl border border-rule bg-white overflow-hidden">
          <div className="px-6 py-3 border-b border-rule flex items-center justify-between gap-3">
            <span className="text-xs font-mono text-ink-light">{openLog}</span>
            {logQ.data?.archived && <Badge variant="gray">archived</Badge>}
          </div>
          <div className="p-4">
            {/* Same log surface as Ingest and Derived — one directory, one reader, one
                look. A second style for the same files would imply a second system. */}
            <pre className="max-h-96 overflow-auto rounded-lg bg-ink text-white/85
                            text-[0.72rem] leading-relaxed font-mono p-3 whitespace-pre-wrap">
              {logQ.isLoading
                ? 'Loading…'
                : logQ.isError
                  ? 'That log is no longer on disk — runs stay plain for 5 runs, then archive, then expire after 30 days.'
                  : (logQ.data?.lines ?? []).join('\n') || '(empty)'}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
