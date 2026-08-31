'use client';

import { Fragment, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useBuildLog, useDatasetJob, useDatasetLog, useSetup, useStartBuild, useStopBuild,
  type DatasetStatus,
} from '@/hooks/useSetup';
import { Card } from '@/components/Card';

// The run-and-monitor surface for ONE kind of work. Ingest and derive get their own page
// because they are different decisions — one spends hours pulling bytes from providers,
// the other recomputes locally in minutes. Putting them on one screen invites running the
// expensive one by reflex.
//
// The build itself is a detached process, so this page is a remote control: closing the
// tab, or restarting the API, leaves a running build alone.

const KIND_PHASES: Record<'ingest' | 'derive', string[]> = {
  ingest: ['schema', 'sharadar', 'fred', 'finra', 'sec'],
  derive: ['derived'],
};

function StateLabel({ state }: { state: DatasetStatus['state'] }) {
  const m = state === 'loaded' ? ['text-pos', 'loaded']
    : state === 'missing' ? ['text-neg', 'missing']
    : ['text-ink-muted', 'n/a'];
  return <span className={`text-xs ${m[0]}`}>{m[1]}</span>;
}

export function BuildRunner({
  kind, title, blurb, cost,
}: {
  kind: 'ingest' | 'derive';
  title: string;
  blurb: string;
  cost: string;
}) {
  const { data, isLoading, error } = useSetup();
  const start = useStartBuild();
  const stop = useStopBuild();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [openLog, setOpenLog] = useState<string | null>(null);
  const job = useDatasetJob();
  // A pending expensive action, held until confirmed. Only ingest needs this: derive is
  // minutes, free and safe to re-run, so a confirmation there would be noise that trains
  // you to click through the one that matters.
  const [confirming, setConfirming] = useState<
    { title: string; lines: string[]; go: () => Promise<unknown> } | null
  >(null);

  const b = data?.build_status;
  const running = !!b?.running;
  const log = useBuildLog(showLog || running, running);
  const openRow = (data?.datasets ?? []).find((d) => d.key === openLog);
  const dsLog = useDatasetLog(openLog, !!openRow?.job.running);

  // While a build runs we can't tell from the state file WHICH kind it is, so any run
  // blocks any other. Saying so is better than a Stop button that appears to belong to
  // this page when it might be stopping the other one.
  const mine = data?.build?.steps?.some((s) => KIND_PHASES[kind].includes(s.phase));

  const act = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try { await fn(); setShowLog(true); }
    catch (e) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(d || (e as Error).message);
      // A 409 means our status was stale — refetch so the view flips to "running" and
      // actually offers the Stop button the error tells you to use.
      qc.invalidateQueries({ queryKey: ['setup-status'] });
    }
  };

  const rows = (data?.datasets ?? []).filter((d) => KIND_PHASES[kind].includes(d.phase));

  const missingCount = rows.filter((r) => r.state === 'missing').length;

  /** Confirm only the genuinely expensive action. `update` is an incremental sync and
   *  `missing` touches nothing already loaded; only `full` re-downloads, so only `full`
   *  earns a prompt. Confirming the cheap ones too would just train you to click through
   *  the one that matters. */
  const guard = (mode: 'update' | 'missing' | 'full') => {
    const go = () => start.mutateAsync({ kind, mode });
    if (kind !== 'ingest' || mode !== 'full') { act(go); return; }
    setConfirming({
      title: 'Re-download every table from scratch?',
      lines: [
        `All ${rows.length} datasets, about ${data!.work.ingest.expected_size}, pulled again `
          + 'in full — not just the rows that changed.',
        'Hours of downloading.',
        'You almost certainly want "Fetch new data" instead, unless you suspect the local '
          + 'copy is wrong rather than merely out of date.',
        'It runs detached and is resumable — you can stop it at any time.',
      ],
      go,
    });
  };
  const loaded = rows.filter((r) => r.state === 'loaded').length;
  const measurable = rows.filter((r) => r.state !== 'unknown').length;

  return (
    <div className="max-w-[1000px] mx-auto py-10 px-6 space-y-5">
      {error && (
        <Card><div className="p-5 text-sm text-ink-light">
          Can&apos;t reach the API — start the backend with <code className="font-mono">./dev.sh</code>.
        </div></Card>
      )}
      {isLoading && !data && <p className="text-sm text-ink-muted">Checking…</p>}

      {data && b && (
        <>
          <Card>
            <div className="p-5">
              <h2 className="text-base font-semibold text-ink">{title}</h2>
              <p className="text-sm text-ink-light mt-1">{blurb}</p>
              <p className="text-xs text-ink-muted mt-2">{cost}</p>

              <div className="mt-4 flex items-center gap-3 flex-wrap">
                <span className="text-sm text-ink">
                  <strong className="tnum">{loaded}/{measurable}</strong> loaded
                </span>
                <span className="text-xs text-ink-muted">
                  ~{data.work[kind].expected_size}
                </span>
              </div>

              {running ? (
                <div className="mt-4">
                  <div className="h-2 rounded-full bg-rule-light overflow-hidden">
                    <div className="h-full bg-green rounded-full transition-all"
                         style={{ width: `${b.progress_pct}%` }} />
                  </div>
                  <p className="text-sm text-ink-light mt-2">
                    {b.progress_pct}% · {b.steps_done}/{b.steps_total} steps · {b.phase}
                    {mine ? '' : ' (another build is running)'}
                  </p>
                  <button
                    type="button"
                    onClick={() => act(() => stop.mutateAsync())}
                    disabled={stop.isPending || b.stopping}
                    className="mt-3 rounded-lg border border-neg/40 bg-white text-neg px-4 py-2
                               text-sm font-medium cursor-pointer hover:border-neg disabled:opacity-40"
                  >
                    {b.stopping ? 'Stopping…' : 'Stop'}
                  </button>
                  <p className="text-xs text-ink-faint mt-2">
                    Stops at the next step boundary — the in-flight step is abandoned and
                    re-runs. Runs detached, so you can close this tab.
                  </p>
                </div>
              ) : (
                <div className="mt-4 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => guard('update')}
                      disabled={start.isPending}
                      className="rounded-lg bg-green text-white px-4 py-2 text-sm font-medium
                                 border-0 cursor-pointer hover:bg-green-dark disabled:opacity-40"
                    >
                      {kind === 'ingest' ? 'Fetch new data' : 'Rebuild'}
                    </button>
                    {missingCount > 0 && (
                      <button
                        type="button"
                        onClick={() => guard('missing')}
                        disabled={start.isPending}
                        className="rounded-lg border border-rule bg-white text-ink px-4 py-2
                                   text-sm font-medium cursor-pointer hover:border-green
                                   hover:text-green disabled:opacity-40"
                      >
                        Load the {missingCount} missing
                      </button>
                    )}
                    {kind === 'ingest' && (
                      <button
                        type="button"
                        onClick={() => guard('full')}
                        disabled={start.isPending}
                        className="rounded-lg border border-neg/40 bg-white text-neg px-4 py-2
                                   text-sm font-medium cursor-pointer hover:border-neg
                                   disabled:opacity-40"
                      >
                        Re-download everything
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-ink-faint max-w-2xl">
                    {kind === 'ingest' ? (
                      <>
                        <strong className="text-ink-light">Fetch new data</strong> pulls only
                        rows added or changed since the last run — minutes, and what you want
                        almost always.{' '}
                        <strong className="text-ink-light">Re-download everything</strong>{' '}
                        discards that shortcut and pulls each table&apos;s full export again:
                        hours, for when you suspect the local copy is wrong rather than
                        merely stale.
                      </>
                    ) : (
                      <>Derived tables have no incremental path — each rebuild recomputes
                      from scratch, which is why it is safe to run whenever. Each builds into
                      a new table and swaps it in, so the live one is never half-written.</>
                    )}
                  </p>
                </div>
              )}

              {confirming && (
                <div className="mt-4 rounded-lg border border-gold bg-gold-soft p-4">
                  <div className="text-sm font-semibold text-ink">{confirming.title}</div>
                  <ul className="mt-2 space-y-1">
                    {confirming.lines.map((l) => (
                      <li key={l} className="text-sm text-ink-light flex gap-2">
                        <span className="text-ink-muted">•</span><span>{l}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => { const g = confirming.go; setConfirming(null); act(g); }}
                      className="rounded-lg bg-green text-white px-4 py-2 text-sm font-medium
                                 border-0 cursor-pointer hover:bg-green-dark"
                    >
                      Yes, start it
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(null)}
                      className="rounded-lg border border-rule bg-white text-ink px-4 py-2
                                 text-sm font-medium cursor-pointer hover:border-ink-muted"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {err && (
                <div className="mt-3 text-xs text-neg bg-neg-soft rounded-lg px-3 py-2">{err}</div>
              )}
            </div>
          </Card>

          {/* --- what this step covers --- */}
          <Card>
            <div className="p-5">
              <h3 className="text-sm font-semibold text-ink uppercase tracking-wide mb-3">
                Steps
              </h3>
              <p className="text-xs text-ink-faint mb-3">
                Each runs as its own process, with its own log — so one table can be pulled,
                watched or stopped without touching the rest.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-ink-muted border-b border-rule">
                      <th className="py-2 pr-3 font-medium">Dataset</th>
                      <th className="py-2 pr-3 font-medium">From</th>
                      <th className="py-2 pr-3 font-medium">State</th>
                      <th className="py-2 pr-3 font-medium text-right">Rows</th>
                      <th className="py-2 pr-3 font-medium text-right">Size</th>
                      <th className="py-2 pr-3 font-medium">Last run</th>
                      <th className="py-2 font-medium text-right">Run</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule-light">
                    {rows.map((d) => {
                      const j = d.job;
                      const open = openLog === d.key;
                      return (
                        <Fragment key={d.key}>
                          <tr>
                            <td className="py-2 pr-3 text-ink">
                              {d.label}
                              {j.running && j.detail && (
                                <div className="text-xs text-ink-faint truncate max-w-[18rem]">
                                  {j.frac != null ? `${(j.frac * 100).toFixed(0)}% · ` : ''}
                                  {j.detail}
                                </div>
                              )}
                            </td>
                            <td className="py-2 pr-3 text-ink-faint">{d.source.short}</td>
                            <td className="py-2 pr-3"><StateLabel state={d.state} /></td>
                            <td className="py-2 pr-3 text-right tnum text-ink-light">
                              {d.rows ? d.rows.toLocaleString() : '—'}
                            </td>
                            <td className="py-2 pr-3 text-right tnum text-ink-muted">
                              {d.expected_size}
                            </td>
                            <td className="py-2 pr-3 text-xs text-ink-muted whitespace-nowrap">
                              {d.last_run?.at ? (
                                <span title={`${d.last_run.status} · from ${d.last_run.source}`}>
                                  {new Date(d.last_run.at).toLocaleString(undefined, {
                                    year: 'numeric', month: 'short', day: 'numeric',
                                    hour: '2-digit', minute: '2-digit',
                                  })}
                                </span>
                              ) : '—'}
                            </td>
                            <td className="py-2 text-right whitespace-nowrap">
                              {j.running ? (
                                <button
                                  type="button"
                                  onClick={() => act(() => job.stop.mutateAsync(d.key))}
                                  className="text-xs text-neg hover:underline bg-transparent border-0 cursor-pointer"
                                >
                                  stop
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenLog(d.key);
                                    act(() => job.run.mutateAsync({ key: d.key, mode: 'update' }));
                                  }}
                                  disabled={running}
                                  title={running ? 'A full build is running' : 'Run just this one'}
                                  className="text-xs text-green hover:underline bg-transparent border-0
                                             cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  update
                                </button>
                              )}
                              {(j.has_log || j.running) && (
                                <button
                                  type="button"
                                  onClick={() => setOpenLog(open ? null : d.key)}
                                  className="ml-3 text-xs text-ink-muted hover:text-green bg-transparent
                                             border-0 cursor-pointer"
                                >
                                  {open ? 'hide log' : 'log'}
                                </button>
                              )}
                              {!j.running && kind === 'ingest' && (
                                <button
                                  type="button"
                                  title="Re-download this table's full export"
                                  onClick={() => setConfirming({
                                    title: `Re-download ${d.label} from scratch?`,
                                    lines: [
                                      `About ${d.expected_size} from ${d.source.provider}, `
                                        + 'pulled again in full rather than just new rows.',
                                      'Runs as its own process — stop it any time.',
                                    ],
                                    go: () => { setOpenLog(d.key);
                                      return job.run.mutateAsync({ key: d.key, mode: 'full' }); },
                                  })}
                                  className="ml-3 text-xs text-ink-muted hover:text-neg bg-transparent
                                             border-0 cursor-pointer"
                                >
                                  re-download
                                </button>
                              )}
                            </td>
                          </tr>
                          {open && (
                            <tr>
                              <td colSpan={7} className="pb-3">
                                <pre className="max-h-64 overflow-auto rounded-lg bg-ink text-white/85
                                                text-[0.7rem] leading-relaxed font-mono p-3 whitespace-pre-wrap">
                                  {dsLog.isLoading && !dsLog.data ? 'Loading…'
                                    : !dsLog.data?.exists ? 'No log yet — run it to create one.'
                                    : dsLog.data.lines.join('\n') || '(empty)'}
                                </pre>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>

          {/* --- log --- */}
          <Card>
            <div className="p-5">
              <button
                type="button"
                onClick={() => setShowLog((v) => !v)}
                className="text-sm font-semibold text-ink uppercase tracking-wide bg-transparent
                           border-0 cursor-pointer p-0"
              >
                {showLog ? '▾' : '▸'} Build log{running && !showLog ? ' (live)' : ''}
              </button>
              {showLog && (
                <>
                  <pre
                    ref={(el) => { if (el && running) el.scrollTop = el.scrollHeight; }}
                    className="mt-3 max-h-96 overflow-auto rounded-lg bg-ink text-white/85
                               text-[0.72rem] leading-relaxed font-mono p-3 whitespace-pre-wrap"
                  >
                    {log.isLoading && !log.data ? 'Loading…'
                      : !log.data?.exists ? 'No build has run yet — the log appears once you start one.'
                      : log.data.lines.length ? log.data.lines.join('\n')
                      : '(log is empty)'}
                  </pre>
                  <p className="text-xs text-ink-faint mt-2">
                    <code className="font-mono">{b.log}</code>
                    {running && ' · refreshing every 2s'}
                  </p>
                </>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
