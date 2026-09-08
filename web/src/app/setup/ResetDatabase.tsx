'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useResetDatabase, useResetLog, type SetupStatus } from '@/hooks/useSetup';

// Drop everything and start over.
//
// Separated from the build controls on purpose. Every other action on this page is
// additive and re-runnable; this one destroys hours of downloading and cannot be undone,
// so it does not sit next to buttons people press casually.
//
// The confirmation is typing the database name, not an "are you sure?" — the failure mode
// worth designing against is not a mis-click, it is doing this to the RIGHT button on the
// WRONG deployment. Typing the target makes that mistake impossible to make by accident,
// and it is the same check the API enforces.

export function ResetDatabase({ data }: { data?: SetupStatus }) {
  // One-way: opening the confirmation has no Cancel. A reset is not cancellable once it
  // starts — the schemas are already going — so a button that looks like it could stop one
  // would be a lie. Backing out is simply not typing the name; nothing happens until the
  // typed name matches.
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const reset = useResetDatabase();

  const dbName = data?.database?.name ?? '';
  const buildRunning = !!data?.build_status?.running;
  const matches = typed === dbName && dbName.length > 0;

  // Driven by the SERVER, not by whether this tab started the job: a reset survives a
  // refresh, and so should the log of it.
  // `justStarted` forces polling for the moment between spawning the job and the server
  // admitting it is running — without it the first poll never fires and the log stays
  // blank until something else re-primes the query.
  const [justStarted, setJustStarted] = useState(false);
  const log = useResetLog(200, justStarted);
  const lines = log.data?.lines ?? [];
  const jobRunning = !!log.data?.running;
  const hasRun = justStarted || !!log.data?.exists;

  useEffect(() => {
    if (!justStarted) return;
    if (jobRunning) { setJustStarted(false); return; }  // server took over
    const t = setTimeout(() => setJustStarted(false), 20000);  // don't poll forever
    return () => clearTimeout(t);
  }, [justStarted, jobRunning]);

  // When the job FINISHES, everything else on the page — sizes, table counts, per-dataset
  // state — still describes the database as it was before the wipe. Nothing refetches on
  // its own, so the numbers would sit there stale until a manual reload.
  const qc = useQueryClient();
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !jobRunning) qc.invalidateQueries();
    wasRunning.current = jobRunning;
  }, [jobRunning, qc]);

  return (
    <div className="mt-8 rounded border border-neg/40 bg-neg/5 p-5">
      <h2 className="text-base font-bold text-ink mb-1">Reset the database</h2>
      <p className="text-sm text-ink-muted max-w-2xl">
        Drops every table — the mirror, the derived tables and the <code>derived</code>{' '}
        schema — and recreates the empty schema. Rebuilding means downloading everything
        again, which takes hours. There is no undo.
      </p>

      {data && (
        <p className="text-xs mt-2 text-ink-muted">
          This would remove{' '}
          <span className="font-semibold text-neg">
            {data.summary.loaded_size} across {data.database.tables} tables
          </span>{' '}
          from <code className="text-ink">{data.database.name}</code> on{' '}
          <code className="text-ink">{data.database.host}</code>.
        </p>
      )}

      {/* A reset is not blocked by a build — it stops them. Say so, because the thing
          people fear here is leaving a half-written database behind. */}
      {buildRunning && (
        <p className="text-xs text-gold mt-3">
          A build is running. The reset will stop it first, then drop the database.
        </p>
      )}

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 px-3 py-1.5 text-sm rounded border border-neg/50 text-neg
                     hover:bg-neg/10 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Reset database…
        </button>
      ) : (
        <div className="mt-4">
          <label className="block text-xs text-ink-muted mb-1">
            {dbName ? (
              <>
                Type the database name —{' '}
                <code className="text-ink font-semibold select-all">{dbName}</code> —
                to confirm:
              </>
            ) : (
              'Waiting for database status… (cannot confirm until the name is known)'
            )}
          </label>
          <div className="flex gap-2 flex-wrap">
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={dbName}
              className="px-2 py-1.5 text-sm rounded border border-rule bg-white
                         font-mono w-56"
            />
            <button
              type="button"
              disabled={!matches || reset.isPending || jobRunning}
              onClick={() => { setJustStarted(true); reset.mutate(typed); }}
              className="px-3 py-1.5 text-sm rounded bg-neg text-white
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {reset.isPending ? 'Resetting…' : 'Reset'}
            </button>
          </div>
        </div>
      )}

      {reset.isError && (
        <p className="text-xs text-neg mt-3">
          {(reset.error as { response?: { data?: { detail?: string } } })?.response?.data
            ?.detail ?? 'Reset failed.'}
        </p>
      )}

      {/* The job reports itself. Showing its log beats a success message: stopping a
          build can take until its current step ends, and silence for a minute looks
          identical to a hang. */}
      {hasRun && (
        <div className="mt-4">
          <p className="text-xs text-ink-muted mb-1">
            {jobRunning
              ? 'Reset job running — stopping builds, then dropping the database…'
              : `Last reset${log.data?.run ? ` (${log.data.run})` : ''}`}
          </p>
          <pre className="text-[11px] leading-relaxed bg-ink/90 text-white/90 rounded p-3
                          max-h-56 overflow-auto whitespace-pre-wrap">
            {lines.length ? lines.join('\n') : 'starting…'}
          </pre>
        </div>
      )}
    </div>
  );
}
