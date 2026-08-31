'use client';

import { useState } from 'react';
import { useStartBuild, useStopBuild, type SetupStatus } from '@/hooks/useSetup';

// Start / stop / resume a build from the browser.
//
// The build runs as a DETACHED process, not inside the request — a multi-hour ingest
// can't live in an HTTP handler. So closing this tab, or restarting the API, leaves a
// running build alone; this page is a remote control, not the thing doing the work.
//
// Ingest and derive are deliberately separate buttons. They are not the same decision:
// ingest spends hours and a paid subscription pulling bytes from providers; derive
// recomputes locally in minutes for free and is safe to re-run whenever. One button for
// both would make the cheap, safe operation feel as dangerous as the expensive one.

function Btn({
  onClick, disabled, tone = 'primary', children, sub,
}: {
  onClick: () => void; disabled?: boolean;
  tone?: 'primary' | 'ghost' | 'danger'; children: React.ReactNode; sub?: string;
}) {
  const cls =
    tone === 'primary' ? 'bg-green text-white border-green hover:bg-green-dark'
    : tone === 'danger' ? 'bg-white text-neg border-neg/40 hover:border-neg'
    : 'bg-white text-ink border-rule hover:border-green hover:text-green';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border px-4 py-2.5 text-sm font-medium cursor-pointer
                  transition-colors text-left disabled:opacity-40
                  disabled:cursor-not-allowed ${cls}`}
    >
      <div>{children}</div>
      {sub && <div className="text-xs font-normal opacity-70 mt-0.5">{sub}</div>}
    </button>
  );
}

export function BuildControls({ data }: { data: SetupStatus }) {
  const start = useStartBuild();
  const stop = useStopBuild();
  const [err, setErr] = useState<string | null>(null);
  const b = data.build_status;

  const run = async (kind: 'all' | 'ingest' | 'derive', force = false) => {
    setErr(null);
    try { await start.mutateAsync({ kind, force }); }
    catch (e) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(d || (e as Error).message);
    }
  };
  const onStop = async () => {
    setErr(null);
    try { await stop.mutateAsync(); }
    catch (e) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(d || (e as Error).message);
    }
  };

  return (
    <div className="p-5 border-t border-rule-light">
      <h2 className="text-sm font-semibold text-ink uppercase tracking-wide mb-1">
        {b.running ? 'Build running' : b.can_resume ? 'Build incomplete' : 'Build'}
      </h2>

      {b.running ? (
        <>
          <p className="text-sm text-ink-light mb-3">
            {b.progress_pct}% · {b.steps_done}/{b.steps_total} steps
            {b.phase ? ` · ${b.phase}` : ''}. It runs detached — you can close this tab.
          </p>
          <div className="h-2 rounded-full bg-rule-light overflow-hidden mb-3">
            <div className="h-full bg-green rounded-full transition-all"
                 style={{ width: `${b.progress_pct}%` }} />
          </div>
          <Btn onClick={onStop} tone="danger" disabled={stop.isPending || b.stopping}
               sub="Stops at the next step boundary; the in-flight step re-runs.">
            {b.stopping ? 'Stopping…' : 'Stop'}
          </Btn>
        </>
      ) : (
        <>
          <p className="text-sm text-ink-light mb-3">
            {b.can_resume
              ? 'A previous build stopped before finishing. Starting again resumes it — '
                + 'steps that already loaded are skipped.'
              : 'Ingest downloads from the providers; derive recomputes locally from what '
                + 'you already have. They are separate on purpose.'}
          </p>
          <div className="grid grid-cols-3 max-[720px]:grid-cols-1 gap-3">
            <Btn onClick={() => run('all')} disabled={start.isPending}
                 sub={b.can_resume ? 'Resumes where it stopped' : 'Everything, in order'}>
              {b.can_resume ? 'Resume build' : 'Build everything'}
            </Btn>
            <Btn onClick={() => run('ingest')} tone="ghost" disabled={start.isPending}
                 sub={`${data.work.ingest.loaded}/${data.work.ingest.datasets} loaded · `
                      + `~${data.work.ingest.expected_size} · hours, uses your subscription`}>
              Run ingest
            </Btn>
            <Btn onClick={() => run('derive', true)} tone="ghost" disabled={start.isPending}
                 sub={`${data.work.derive.loaded}/${data.work.derive.datasets} built · `
                      + `~${data.work.derive.expected_size} · minutes, free, safe to re-run`}>
              Rebuild derived
            </Btn>
          </div>
        </>
      )}

      {err && (
        <div className="mt-3 text-xs text-neg bg-neg-soft rounded-lg px-3 py-2">{err}</div>
      )}
      <p className="text-xs text-ink-faint mt-3">
        Log: <code className="font-mono">{b.log}</code>
      </p>
    </div>
  );
}
