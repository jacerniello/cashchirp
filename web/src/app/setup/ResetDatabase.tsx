'use client';

import { useState } from 'react';
import { useResetDatabase, type SetupStatus } from '@/hooks/useSetup';

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
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const reset = useResetDatabase();

  const dbName = data?.database?.name ?? '';
  const running = !!data?.build_status?.running;
  const matches = typed === dbName && dbName.length > 0;

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

      {/* A reset during an ingest leaves a half-written database and a job writing into
          tables that no longer exist, so the API refuses it — say so before they try. */}
      {running && (
        <p className="text-xs text-gold mt-3">
          A build is running. Stop it first — resetting under a live ingest leaves a
          half-written database.
        </p>
      )}

      {!open ? (
        <button
          type="button"
          disabled={running}
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
              disabled={!matches || reset.isPending || running}
              onClick={() => reset.mutate(typed)}
              className="px-3 py-1.5 text-sm rounded bg-neg text-white
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {reset.isPending ? 'Resetting…' : 'Reset'}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setTyped(''); reset.reset(); }}
              className="px-3 py-1.5 text-sm rounded border border-rule text-ink-muted"
            >
              Cancel
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

      {/* Report what actually happened rather than claiming success: the before/after
          object counts come back from the API. */}
      {reset.isSuccess && reset.data && (
        <p className="text-xs text-pos mt-3">
          Reset {reset.data.after.database}: {reset.data.before.objects} objects (
          {reset.data.before.size}) removed, {reset.data.recreated_tables.length} empty
          tables recreated
          {reset.data.cleared_job_files > 0 &&
            `, ${reset.data.cleared_job_files} job files cleared`}
          .
        </p>
      )}
    </div>
  );
}
