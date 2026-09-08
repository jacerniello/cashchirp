'use client';

import { Fragment, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useBuildLog, useDatasetJob, useDatasetLog, useSetup, useStartBuild, useStopBuild,
  type DatasetStatus, type LogRun,
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

/** What a row is DOING beats what it holds: a running job shows as running, even though
 *  its table still reads "loaded" from the last build. Reporting only the data state
 *  would leave a row that is actively rebuilding looking idle. */
/** Choose which past run to read. Logs are one file per run, so history is browsable —
 *  "what happened last time this failed?" shouldn't mean scrolling past everything that
 *  ran after it. Selecting an older run stops the polling: a finished run can't change. */
function RunPicker({
  runs, value, onChange,
}: {
  runs: LogRun[]; value: string | null; onChange: (v: string | null) => void;
}) {
  if (runs.length < 2) return null;
  return (
    <select
      value={value ?? runs[0].name}
      onChange={(e) => onChange(e.target.value === runs[0].name ? null : e.target.value)}
      className="text-xs border border-rule rounded px-2 py-1 bg-white text-ink max-w-[22rem]"
    >
      {runs.map((r, i) => (
        <option key={r.name} value={r.name}>
          {new Date(r.at).toLocaleString(undefined, {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
            second: '2-digit',
          })}
          {i === 0 ? ' · latest' : ''}
          {r.archived ? ' · archived' : ''}
          {` · ${r.bytes > 1024 ? `${(r.bytes / 1024).toFixed(0)} KB` : `${r.bytes} B`}`}
        </option>
      ))}
    </select>
  );
}

function StateLabel({ d }: { d: DatasetStatus }) {
  const j = d.job;
  if (j.running) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-green whitespace-nowrap">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full
                           bg-green opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-green" />
        </span>
        running{j.frac != null ? ` ${(j.frac * 100).toFixed(0)}%` : ''}
      </span>
    );
  }
  // A job that ended badly is worth surfacing on the row, not only in the log.
  if (j.phase === 'interrupted') {
    return <span className="text-xs text-gold" title="Stopped before finishing — run it again to resume">stopped</span>;
  }
  if (j.status === 'FAIL' || j.phase === 'failed') {
    return <span className="text-xs text-neg" title="Last run failed — see its log">failed</span>;
  }
  const m = d.state === 'loaded' ? ['text-pos', 'loaded']
    : d.state === 'missing' ? ['text-neg', 'missing']
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
  // Log visibility follows what's RUNNING by default: if something is going, you want to
  // see it without hunting for a toggle. `undefined` means "follow"; anything else is an
  // explicit choice you made, which sticks until the next run starts.
  const [logOverride, setLogOverride] = useState<boolean | undefined>(undefined);
  const [openOverride, setOpenOverride] = useState<string | null | undefined>(undefined);
  // null = follow the latest run; a name pins that historical run.
  const [buildRun, setBuildRun] = useState<string | null>(null);
  const [dsRun, setDsRun] = useState<string | null>(null);
  const job = useDatasetJob();
  // A pending expensive action, held until confirmed. Only ingest needs this: derive is
  // minutes, free and safe to re-run, so a confirmation there would be noise that trains
  // you to click through the one that matters.
  const [confirming, setConfirming] = useState<
    { title: string; lines: string[]; go: () => Promise<unknown> } | null
  >(null);

  const b = data?.build_status;
  // A full build walks every phase, so it is "running" for BOTH pages even while it is
  // busy elsewhere — and no page may offer a competing start while it does. But the
  // progress shown is only *this* kind's business when the build has reached this kind.
  const buildRunning = !!b?.running;
  const buildHere = buildRunning && KIND_PHASES[kind].includes(b!.phase ?? '');
  const showLog = logOverride ?? buildRunning;
  // Set the instant a job is spawned. `buildRunning` comes from status fetched BEFORE the
  // click, so without this the log query never starts polling and stays blank until
  // something else re-primes it — which in practice meant a manual refresh.
  const [justStarted, setJustStarted] = useState(false);
  const log = useBuildLog(showLog || buildRunning || justStarted, buildRunning,
                          buildRun, 300, justStarted);

  useEffect(() => {
    if (!justStarted) return;
    if (buildRunning) { setJustStarted(false); return; }   // status caught up
    const t = setTimeout(() => setJustStarted(false), 20000);
    return () => clearTimeout(t);
  }, [justStarted, buildRunning]);

  const act = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      setLogOverride(undefined); setOpenOverride(undefined);
      setBuildRun(null); setDsRun(null);   // a new run is the one you want to watch
      setJustStarted(true);
    }
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
  // A per-dataset job that's running opens its own log automatically.
  const runningRow = rows.find((r) => r.job.running);
  // This page is "busy" if the full build is here, or any of ITS datasets is running.
  const running = buildHere || !!runningRow;
  const openLog = openOverride === undefined ? (runningRow?.key ?? null) : openOverride;
  const openRow = rows.find((d) => d.key === openLog);
  const dsLog = useDatasetLog(openLog, !!openRow?.job.running, dsRun, 200, justStarted);

  /** No confirmation left to give: `update` is an incremental sync and `missing` touches
   *  nothing already loaded, so neither is expensive. Re-downloading everything is no
   *  longer a button here — resetting the database achieves it, and more honestly: an
   *  empty table has no watermark, so the next run full-backfills it. One destructive
   *  control beats two that overlap. */
  const guard = (mode: 'update' | 'missing' | 'full') => {
    act(() => start.mutateAsync({ kind, mode }));
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

              {buildRunning ? (
                <div className="mt-4">
                  <div className="h-2 rounded-full bg-rule-light overflow-hidden">
                    <div className="h-full bg-green rounded-full transition-all"
                         style={{ width: `${b.progress_pct}%` }} />
                  </div>
                  <p className="text-sm text-ink-light mt-2">
                    {b.steps_total === 0
                      ? 'Starting — preflight checks first.'
                      : <>
                          {b.progress_pct}% · {b.steps_done}/{b.steps_total} steps · {b.phase}
                          {!buildHere && ' — currently working on another phase'}
                        </>}
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
                  </div>
                  <p className="text-xs text-ink-faint max-w-2xl">
                    {kind === 'ingest' ? (
                      <>
                        <strong className="text-ink-light">Fetch new data</strong> pulls only
                        rows added or changed since the last run — minutes, and what you want
                        almost always. To pull everything from scratch, reset the database
                        first — an empty table has no watermark to sync from, so the next run
                        full-backfills it anyway.
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
                          <tr className={j.running ? 'bg-green-soft/40' : undefined}>
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
                            <td className="py-2 pr-3"><StateLabel d={d} /></td>
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
                                    setOpenOverride(undefined);
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
                                  onClick={() => { setDsRun(null); setOpenOverride(open ? null : d.key); }}
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
                                    go: () => { setOpenOverride(undefined);
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
                                {!!dsLog.data?.runs?.length && (
                                  <div className="flex items-center gap-2 mb-2">
                                    <span className="text-xs text-ink-muted">Run:</span>
                                    <RunPicker runs={dsLog.data.runs} value={dsRun}
                                               onChange={setDsRun} />
                                    {dsRun && (
                                      <span className="text-xs text-ink-faint">
                                        earlier run — not live
                                      </span>
                                    )}
                                  </div>
                                )}
                                <pre className="max-h-64 overflow-auto rounded-lg bg-ink text-white/85
                                                text-[0.7rem] leading-relaxed font-mono p-3 whitespace-pre-wrap">
                                  {dsLog.isLoading && !dsLog.data ? 'Loading…'
                                    : !dsLog.data?.exists ? 'No log yet — run it to create one.'
                                    : dsLog.data.lines.join('\n')
                                      || (j.running ? 'Starting…' : '(empty)')}
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
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={() => setLogOverride(!showLog)}
                  className="text-sm font-semibold text-ink uppercase tracking-wide bg-transparent
                             border-0 cursor-pointer p-0"
                >
                  {showLog ? '▾' : '▸'} Build log{running && !showLog ? ' (live)' : ''}
                </button>
                {showLog && log.data?.runs?.length ? (
                  <RunPicker runs={log.data.runs} value={buildRun} onChange={setBuildRun} />
                ) : null}
              </div>
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
                      : running ? 'Starting… the first output appears in a second or two.'
                      : '(log is empty)'}
                  </pre>
                  <p className="text-xs text-ink-faint mt-2">
                    <code className="font-mono">{log.data?.path ?? b.log}</code>
                    {buildRun
                      ? ' · viewing an earlier run (not live)'
                      : running && ' · refreshing every 2s'}
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
