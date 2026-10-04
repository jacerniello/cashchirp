'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ScreenerAreaNav } from '@/components/nav/AreaSubNav';
import {
  AddedByBadge,
  btnDanger,
  btnGhost,
  btnPrimary,
  ClaudeInstruction,
  ErrorPanel,
  fmtWhen,
  InlineError,
  inputCls,
} from '@/components/research/ResearchBits';
import { SnapshotMembersTable } from '@/components/research/SnapshotMembersTable';
import { SnapshotSourceDetail, sourceLabel } from '@/components/research/SnapshotSource';
import {
  errDetail,
  isNotFound,
  snapshotCsvUrl,
  useDeleteSnapshot,
  usePatchSnapshot,
  useResearchGuide,
  useSnapshot,
} from '@/hooks/useResearch';

// One frozen screener result. Trimming marks members removed (undoable) rather than
// deleting them, so the record of what the screen originally caught survives. The members
// table is shared with a saved screen's live view (SnapshotMembersTable).

export default function SnapshotPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id ?? '');
  const router = useRouter();
  const { data: snap, isLoading, isError, error } = useSnapshot(id);
  const guide = useResearchGuide();
  const patch = usePatchSnapshot();
  const del = useDeleteSnapshot();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (snap && !editing) {
      setName(snap.name ?? '');
      setNote(snap.note ?? '');
    }
  }, [snap, editing]);

  const all = useMemo(() => (Array.isArray(snap?.members) ? snap.members : []), [snap]);
  const keptCount = all.filter((m) => !m.removed).length;

  async function bulk(kind: 'remove' | 'restore', ids: string[]): Promise<boolean> {
    try {
      await patch.mutateAsync({ id, [kind]: ids });
      return true;
    } catch {
      return false; // shown in the table
    }
  }

  async function saveMeta() {
    try {
      await patch.mutateAsync({ id, name: name.trim(), note });
      setEditing(false);
    } catch {
      /* shown below */
    }
  }

  async function onDelete() {
    if (!window.confirm(`Delete the snapshot "${snap?.name ?? id}"? Stock research and groups are not affected.`)) return;
    try {
      await del.mutateAsync(id);
      router.push('/screener/snapshots');
    } catch {
      /* shown below */
    }
  }

  return (
    <div className="bg-white min-h-[calc(100vh-4rem)] font-sans">
      <ScreenerAreaNav />
      <div className="max-w-[1400px] mx-auto px-6 max-md:px-4 py-8 space-y-6">
        <Link href="/screener/snapshots" className="text-xs text-ink-muted hover:text-green no-underline">← All snapshots</Link>

        {isLoading && <p className="text-sm text-ink-muted">Loading snapshot…</p>}
        {isError && (
          <ErrorPanel title={isNotFound(error) ? `No snapshot called “${id}”.` : 'Could not load this snapshot.'}>
            <p className="m-0">
              {isNotFound(error)
                ? 'It may have been deleted (snapshots are files under snapshots/ in the research folder).'
                : errDetail(error, 'The research API did not answer. Check that the backend is running.')}
            </p>
          </ErrorPanel>
        )}

        {snap && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
              <div className="space-y-2">
                {editing ? (
                  <div className="space-y-2">
                    <input value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} w-full text-lg font-semibold`} />
                    <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4}
                              placeholder="What were you looking for? What did you decide?" className={`${inputCls} w-full`} />
                    <div className="flex gap-2">
                      <button type="button" className={btnPrimary} disabled={patch.isPending} onClick={saveMeta}>
                        {patch.isPending ? 'Saving…' : 'Save'}
                      </button>
                      <button type="button" className={btnGhost} onClick={() => setEditing(false)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <h1 className="text-[1.75rem] font-bold tracking-tight text-ink m-0">{snap.name}</h1>
                    <p className="text-sm text-ink-light m-0 whitespace-pre-line">
                      {snap.note || <span className="text-ink-muted">No note.</span>}
                    </p>
                  </>
                )}
                <p className="text-xs text-ink-muted m-0 flex items-center gap-2 flex-wrap">
                  <span>{sourceLabel(snap.source)}</span>
                  <span>· data as of {fmtWhen(snap.asof)}</span>
                  <span>· created {fmtWhen(snap.created_at, true)} by</span>
                  <AddedByBadge by={snap.created_by} />
                  <span>· <code className="font-mono">snapshots/{snap.id}.json</code></span>
                </p>
                {snap.error && (
                  <InlineError>The snapshot file is unreadable ({snap.error}). Fix it by hand before editing it here.</InlineError>
                )}
                {!editing && (
                  <div className="flex gap-2 pt-1 flex-wrap">
                    <button type="button" className={btnGhost} onClick={() => setEditing(true)} disabled={!!snap.error}>
                      Edit name &amp; note
                    </button>
                    <a href={snapshotCsvUrl(snap.id)} className={`${btnGhost} no-underline`} download>
                      Download CSV ({keptCount})
                    </a>
                    <button type="button" className={btnDanger} onClick={onDelete} disabled={del.isPending}>
                      Delete snapshot
                    </button>
                  </div>
                )}
                {del.isError && <InlineError>{errDetail(del.error, 'Could not delete.')}</InlineError>}
              </div>
              <div className="rounded-xl border border-rule bg-white p-4 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Source</div>
                <SnapshotSourceDetail source={snap.source} />
              </div>
            </div>

            <SnapshotMembersTable
              members={all}
              onBulk={bulk}
              busy={patch.isPending}
              error={patch.isError ? errDetail(patch.error, 'Could not update the snapshot.') : null}
            />

            <ClaudeInstruction
              root={guide.data?.root}
              blurb="Trimmed members are kept in the file with removed: true; the instruction below tells Claude to skip them."
              instruction={
                `Do a full DD on every kept stock in snapshot ${snap.id} (snapshots/${snap.id}.json, skip members with ` +
                `removed: true), then red-team the ones rated 5–6.`
              }
            />
          </>
        )}
      </div>
    </div>
  );
}
