'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ResearchAreaNav } from '../../ResearchAreaNav';
import { StockSearch } from '@/components/research/Pickers';
import {
  AddedByBadge,
  btnDanger,
  btnGhost,
  btnPrimary,
  ClaudeInstruction,
  ErrorPanel,
  fmtSignedPct,
  fmtWhen,
  InlineError,
  inputCls,
  RatingPill,
  SectionCard,
} from '@/components/research/ResearchBits';
import {
  errDetail,
  isNotFound,
  ratingScore,
  toNum,
  useDeleteGroup,
  useGroup,
  usePatchGroup,
  useResearchGuide,
  type GroupMember,
} from '@/hooks/useResearch';
import { tableStyles } from '@/lib/styles';

export default function GroupPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id ?? '');
  const router = useRouter();
  const { data: g, isLoading, isError, error } = useGroup(id);
  const guide = useResearchGuide();
  const patch = usePatchGroup();
  const del = useDeleteGroup();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (g && !editing) {
      setName(g.name ?? '');
      setDescription(g.description ?? '');
    }
  }, [g, editing]);

  const members: GroupMember[] = Array.isArray(g?.members) ? g.members : [];
  // Best-rated first; unrated stocks after, alphabetically.
  const sorted = [...members].sort((a, b) => {
    const ra = ratingScore(a.rating);
    const rb = ratingScore(b.rating);
    if (ra != null && rb != null && ra !== rb) return rb - ra;
    if (ra != null && rb == null) return -1;
    if (ra == null && rb != null) return 1;
    return String(a.ticker ?? '').localeCompare(String(b.ticker ?? ''));
  });

  async function saveMeta() {
    try {
      await patch.mutateAsync({ id, name: name.trim(), description });
      setEditing(false);
    } catch {
      /* shown below */
    }
  }

  async function onDelete() {
    if (!window.confirm(`Delete the group "${g?.name ?? id}"? Its stocks and their research are not affected.`)) return;
    try {
      await del.mutateAsync(id);
      router.push('/research/groups');
    } catch {
      /* shown below */
    }
  }

  function editNote(m: GroupMember) {
    const next = window.prompt(`Note for ${m.ticker ?? m.permaticker} in this group:`, m.note ?? '');
    if (next == null || next === (m.note ?? '')) return;
    patch.mutate({ id, add: [{ permaticker: m.permaticker, ticker: m.ticker, name: m.name, note: next }] });
  }

  return (
    <div className="bg-white min-h-[calc(100vh-4rem)] font-sans">
      <ResearchAreaNav />
      <div className="max-w-[1100px] mx-auto px-6 max-md:px-4 py-8 space-y-6">
        <Link href="/research/groups" className="text-xs text-ink-muted hover:text-green no-underline">← All groups</Link>

        {isLoading && <p className="text-sm text-ink-muted">Loading group…</p>}
        {isError && (
          <ErrorPanel title={isNotFound(error) ? `No group called “${id}”.` : 'Could not load this group.'}>
            <p className="m-0">
              {isNotFound(error)
                ? 'It may have been renamed or deleted (groups are files under groups/ in the research folder).'
                : errDetail(error, 'The research API did not answer. Check that the backend is running.')}
            </p>
          </ErrorPanel>
        )}

        {g && (
          <>
            <div className="space-y-2">
              {editing ? (
                <div className="space-y-2 max-w-2xl">
                  <input value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} w-full text-lg font-semibold`} />
                  <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
                            placeholder="What ties these stocks together?" className={`${inputCls} w-full`} />
                  <div className="flex gap-2">
                    <button type="button" className={btnPrimary} disabled={!name.trim() || patch.isPending} onClick={saveMeta}>
                      {patch.isPending ? 'Saving…' : 'Save'}
                    </button>
                    <button type="button" className={btnGhost} onClick={() => setEditing(false)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <h1 className="text-[1.75rem] font-bold tracking-tight text-ink m-0">{g.name}</h1>
                    <p className="text-sm text-ink-light mt-1 mb-0 whitespace-pre-line">
                      {g.description || <span className="text-ink-muted">No description.</span>}
                    </p>
                    <p className="text-xs text-ink-muted mt-2 mb-0 flex items-center gap-2 flex-wrap">
                      <span>Created by</span> <AddedByBadge by={g.created_by} />
                      {g.updated_at && <span>· updated {fmtWhen(g.updated_at, true)}</span>}
                      <span>· <code className="font-mono">groups/{g.id}.json</code></span>
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className={btnGhost} onClick={() => setEditing(true)} disabled={!!g.error}>Edit</button>
                    <button type="button" className={btnDanger} onClick={onDelete} disabled={del.isPending}>
                      {del.isPending ? 'Deleting…' : 'Delete group'}
                    </button>
                  </div>
                </div>
              )}
              {g.error && (
                <InlineError>
                  The group file is unreadable ({g.error}). Fix <code className="font-mono">groups/{g.id}.json</code> by hand
                  before editing it here.
                </InlineError>
              )}
              {patch.isError && <InlineError>{errDetail(patch.error, 'Could not update the group.')}</InlineError>}
              {del.isError && <InlineError>{errDetail(del.error, 'Could not delete the group.')}</InlineError>}
            </div>

            <SectionCard
              title={`Members (${members.length})`}
              actions={
                <StockSearch
                  exclude={new Set(members.map((m) => String(m.permaticker)))}
                  onPick={(s) => patch.mutate({ id, add: [s] })}
                />
              }
            >
              <div className={tableStyles.container}>
                <table className={tableStyles.table}>
                  <thead>
                    <tr>
                      <th className={tableStyles.th}>Rating</th>
                      <th className={tableStyles.th}>Ticker</th>
                      <th className={tableStyles.th}>Name</th>
                      <th className={tableStyles.thNum}>Base upside</th>
                      <th className={tableStyles.th}>Note</th>
                      <th className={tableStyles.th}>Added by</th>
                      <th className={tableStyles.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-3 py-6 text-center text-sm text-ink-faint">
                          No members yet. Add stocks with the search above, or from a snapshot.
                        </td>
                      </tr>
                    )}
                    {sorted.map((m) => {
                      const up = toNum(m.rating?.upside_base_pct);
                      return (
                        <tr key={m.permaticker} className={tableStyles.row}>
                          <td className={tableStyles.td}><RatingPill rating={m.rating} size="sm" /></td>
                          <td className={`${tableStyles.td} font-mono font-semibold`}>
                            <Link href={`/research/stocks/${m.permaticker}`} className="text-ink no-underline hover:text-green">
                              {m.ticker || `#${m.permaticker}`}
                            </Link>
                          </td>
                          <td className={`${tableStyles.td} max-w-[240px] truncate`}>{m.name || '—'}</td>
                          <td className={`${tableStyles.tdNum} ${up == null ? '' : up >= 0 ? 'text-pos' : 'text-neg'}`}>
                            {fmtSignedPct(up)}
                          </td>
                          <td className={`${tableStyles.td} whitespace-normal max-w-[320px] text-ink-light`}>
                            <button type="button" onClick={() => editNote(m)} title="Edit note"
                                    className="bg-transparent border-0 p-0 cursor-pointer text-left text-[13px] text-ink-light hover:text-ink">
                              {m.note || <span className="text-ink-muted">add note</span>}
                            </button>
                          </td>
                          <td className={tableStyles.td}>
                            <span title={m.added_at ? `added ${fmtWhen(m.added_at, true)}` : undefined}>
                              <AddedByBadge by={m.added_by} />
                            </span>
                          </td>
                          <td className={`${tableStyles.td} text-right`}>
                            <button
                              type="button"
                              disabled={patch.isPending}
                              onClick={() => patch.mutate({ id, remove: [String(m.permaticker)] })}
                              className="bg-transparent border-0 cursor-pointer text-xs text-ink-muted hover:text-neg"
                            >
                              remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </SectionCard>

            <ClaudeInstruction
              root={guide.data?.root}
              instruction={
                `Review group ${g.id} in groups/${g.id}.json: do a DD on any member without one, red-team the ones ` +
                `rated 5–6, and remove members that no longer fit "${g.name}" (say why in your summary).`
              }
            />
          </>
        )}
      </div>
    </div>
  );
}
