'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useBuildLog, useSetup, useStartBuild, useStopBuild, type DatasetStatus,
} from '@/hooks/useSetup';
import { Card } from '@/components/Card';

// The run-and-monitor surface for ONE kind of work. Ingest and derive get their own page
// because they are different decisions — one spends hours and a paid subscription pulling
// bytes from providers, the other recomputes locally in minutes for free. Putting them on
// one screen invites running the expensive one by reflex.
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

  const b = data?.build_status;
  const running = !!b?.running;
  const log = useBuildLog(showLog || running, running);

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
                <div className="mt-4 flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => act(() => start.mutateAsync({ kind }))}
                    disabled={start.isPending}
                    className="rounded-lg bg-green text-white px-4 py-2 text-sm font-medium
                               border-0 cursor-pointer hover:bg-green-dark disabled:opacity-40"
                  >
                    {b.can_resume ? 'Resume' : 'Run'}
                  </button>
                  <button
                    type="button"
                    onClick={() => act(() => start.mutateAsync({ kind, force: true }))}
                    disabled={start.isPending}
                    className="rounded-lg border border-rule bg-white text-ink px-4 py-2
                               text-sm font-medium cursor-pointer hover:border-green
                               hover:text-green disabled:opacity-40"
                  >
                    Force rebuild
                  </button>
                  <span className="text-xs text-ink-faint">
                    {b.can_resume
                      ? 'A previous build stopped early — Run picks up where it left off.'
                      : 'Run skips anything already loaded; Force redoes it.'}
                  </span>
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
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-ink-muted border-b border-rule">
                      <th className="py-2 pr-3 font-medium">Dataset</th>
                      <th className="py-2 pr-3 font-medium">From</th>
                      <th className="py-2 pr-3 font-medium">State</th>
                      <th className="py-2 pr-3 font-medium text-right">Rows</th>
                      <th className="py-2 font-medium text-right">Size</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule-light">
                    {rows.map((d) => (
                      <tr key={d.key}>
                        <td className="py-2 pr-3 text-ink">{d.label}</td>
                        <td className="py-2 pr-3 text-ink-faint">{d.source.short}</td>
                        <td className="py-2 pr-3"><StateLabel state={d.state} /></td>
                        <td className="py-2 pr-3 text-right tnum text-ink-light">
                          {d.rows ? d.rows.toLocaleString() : '—'}
                        </td>
                        <td className="py-2 text-right tnum text-ink-muted">{d.expected_size}</td>
                      </tr>
                    ))}
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
