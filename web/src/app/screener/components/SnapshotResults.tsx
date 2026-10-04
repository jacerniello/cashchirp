'use client';

import Link from 'next/link';
import { useState } from 'react';
import { errDetail, useCreateSnapshot } from '@/hooks/useResearch';
import type { ScreenerParams } from '@/hooks/useScreener';

// Freeze what the grid matches right now — every matching row, not just this page — as a
// research snapshot you can trim, group and hand to Claude. Lives beside SaveScreen: a saved
// screen keeps the *filter*, a snapshot keeps the *result*.

export function SnapshotResults({ params }: { params: ScreenerParams }) {
  const create = useCreateSnapshot();
  const [name, setName] = useState('');
  const [result, setResult] = useState<{ id: string; count: number } | null>(null);

  async function onSnapshot() {
    setResult(null);
    try {
      // page / per_page are dropped server-side too; strip them here so the stored
      // params read as the filter and nothing else.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { page, per_page, ...filter } = params;
      const r = await create.mutateAsync({ name: name.trim() || undefined, params: filter as Record<string, unknown> });
      setResult({ id: r.id, count: r.count });
      setName('');
    } catch {
      /* shown below */
    }
  }

  return (
    <div className="border border-rule rounded-xl bg-white px-4 py-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-ink mr-1">Snapshot results</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (optional)"
          className="flex-1 min-w-[180px] max-w-sm text-sm border border-rule rounded-lg px-3 py-1.5 text-ink"
          onKeyDown={(e) => { if (e.key === 'Enter') void onSnapshot(); }}
        />
        <button
          type="button"
          onClick={onSnapshot}
          disabled={create.isPending}
          className="text-sm rounded-lg bg-green text-white px-4 py-1.5 border-0 cursor-pointer
                     disabled:opacity-40 disabled:cursor-not-allowed hover:bg-green-dark"
        >
          {create.isPending ? 'Snapshotting…' : 'Snapshot'}
        </button>
        <span className="text-xs text-ink-muted">Freezes every match for research — trim, group, hand to Claude.</span>
      </div>
      {create.isError && (
        <div className="text-xs text-neg bg-neg-soft rounded-lg px-3 py-2">
          {errDetail(create.error, 'Could not create the snapshot.')}
        </div>
      )}
      {result && (
        <div className="text-xs bg-green-soft text-green-text rounded-lg px-3 py-2">
          Snapshotted {result.count.toLocaleString()} stock{result.count === 1 ? '' : 's'}.{' '}
          <Link href={`/research/snapshots/${encodeURIComponent(result.id)}`} className="font-semibold text-green-text">
            Open snapshot →
          </Link>
        </div>
      )}
    </div>
  );
}

/** One-click snapshot of a saved screen (config/screens/<id>.yaml), for the Ideas pages. */
export function SnapshotScreenButton({ screenId }: { screenId: string }) {
  const create = useCreateSnapshot();
  const [result, setResult] = useState<{ id: string; count: number } | null>(null);

  async function onClick() {
    setResult(null);
    try {
      const r = await create.mutateAsync({ screen_id: screenId });
      setResult({ id: r.id, count: r.count });
    } catch {
      /* shown below */
    }
  }

  if (result) {
    return (
      <Link href={`/research/snapshots/${encodeURIComponent(result.id)}`}
            className="text-sm font-medium text-green hover:text-green-dark">
        Snapshotted {result.count.toLocaleString()} — open →
      </Link>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={create.isPending}
        className="text-sm rounded-lg bg-white text-ink-light px-3 py-1.5 border border-rule cursor-pointer
                   hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed"
        title="Freeze every stock this screen finds now as a research snapshot"
      >
        {create.isPending ? 'Snapshotting…' : 'Snapshot this screen'}
      </button>
      {create.isError && (
        <span className="text-xs text-neg">{errDetail(create.error, 'Could not snapshot.')}</span>
      )}
    </span>
  );
}
