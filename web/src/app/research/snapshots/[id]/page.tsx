'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ResearchAreaNav } from '../../ResearchAreaNav';
import { AddToGroup } from '@/components/research/Pickers';
import {
  AddedByBadge,
  btnDanger,
  btnGhost,
  btnPrimary,
  ClaudeInstruction,
  DocIndicators,
  ErrorPanel,
  fmtWhen,
  GroupChips,
  InlineError,
  inputCls,
  RatingPill,
  SectionCard,
} from '@/components/research/ResearchBits';
import { SnapshotSourceDetail, sourceLabel } from '@/components/research/SnapshotSource';
import {
  errDetail,
  isNotFound,
  ratingScore,
  snapshotCsvUrl,
  toNum,
  useDeleteSnapshot,
  usePatchSnapshot,
  useResearchGuide,
  useSnapshot,
  type SnapshotMember,
} from '@/hooks/useResearch';
import { formatCurrency } from '@/lib/formatters';
import { tableStyles } from '@/lib/styles';

// One frozen screener result. Trimming marks members removed (undoable) rather than
// deleting them, so the record of what the screen originally caught survives.

type Fmt = 'cap' | 'ratio' | 'pct' | 'num';
interface Col {
  key: keyof SnapshotMember;
  label: string;
  fmt: Fmt;
}

const COLS: Col[] = [
  { key: 'market_cap', label: 'Mkt cap', fmt: 'cap' },
  { key: 'pe', label: 'P/E', fmt: 'ratio' },
  { key: 'ev_ebitda', label: 'EV/EBITDA', fmt: 'ratio' },
  { key: 'p_fcf', label: 'P/FCF', fmt: 'ratio' },
  { key: 'pb', label: 'P/B', fmt: 'ratio' },
  { key: 'roic', label: 'ROIC', fmt: 'pct' },
  { key: 'op_margin', label: 'Op mgn', fmt: 'pct' },
  { key: 'revenue_growth', label: 'Rev g', fmt: 'pct' },
  { key: 'net_cash_pct', label: 'Net cash', fmt: 'pct' },
  { key: 'debt_equity', label: 'D/E', fmt: 'ratio' },
  { key: 'altman_z', label: 'Z', fmt: 'num' },
  { key: 'pct_below_high', label: 'Off high', fmt: 'pct' },
];

function fmt(v: unknown, f: Fmt): string {
  const n = toNum(v);
  if (n == null) return '—';
  switch (f) {
    case 'cap': return formatCurrency(n);
    case 'pct': return `${(n * 100).toFixed(1)}%`;
    case 'ratio': return n.toFixed(1);
    default: return n.toFixed(2);
  }
}

type SortKey = keyof SnapshotMember | 'rating';

export default function SnapshotPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id ?? '');
  const router = useRouter();
  const { data: snap, isLoading, isError, error } = useSnapshot(id);
  const guide = useResearchGuide();
  const patch = usePatchSnapshot();
  const del = useDeleteSnapshot();

  const [showRemoved, setShowRemoved] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'market_cap', desc: true });
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
  const removedCount = all.length - keptCount;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = all.filter((m) =>
      (showRemoved || !m.removed) &&
      (!needle || `${m.ticker ?? ''} ${m.name ?? ''} ${m.sector ?? ''} ${m.industry ?? ''}`.toLowerCase().includes(needle)),
    );
    const val = (m: SnapshotMember): string | number | null => {
      if (sort.key === 'rating') return ratingScore(m.research?.rating);
      const v = m[sort.key];
      if (typeof v === 'string') return v.toLowerCase();
      return toNum(v);
    };
    return [...list].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const c = va < vb ? -1 : va > vb ? 1 : 0;
      return sort.desc ? -c : c;
    });
  }, [all, showRemoved, q, sort]);

  // Selection only ever refers to rows that are visible, so a bulk action never touches
  // something the user cannot see.
  const visibleIds = useMemo(() => new Set(rows.map((m) => String(m.permaticker))), [rows]);
  const picked = [...selected].filter((pt) => visibleIds.has(pt));
  const pickedMembers = rows.filter((m) => selected.has(String(m.permaticker)));
  const pickedKept = pickedMembers.filter((m) => !m.removed).map((m) => String(m.permaticker));
  const pickedRemoved = pickedMembers.filter((m) => m.removed).map((m) => String(m.permaticker));
  const allPicked = rows.length > 0 && picked.length === rows.length;

  function toggle(pt: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(pt)) n.delete(pt);
      else n.add(pt);
      return n;
    });
  }

  async function bulk(kind: 'remove' | 'restore') {
    const ids = kind === 'remove' ? pickedKept : pickedRemoved;
    if (!ids.length) return;
    try {
      await patch.mutateAsync({ id, [kind]: ids });
      setSelected(new Set());
    } catch {
      /* shown below */
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
      router.push('/research/snapshots');
    } catch {
      /* shown below */
    }
  }

  function sortHeader(key: SortKey, label: string, num = true) {
    const active = sort.key === key;
    return (
      <th key={String(key)} className={num ? tableStyles.thNum : tableStyles.th}>
        <button
          type="button"
          onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : num }))}
          className={`bg-transparent border-0 p-0 cursor-pointer uppercase tracking-[0.04em] text-[11px] font-semibold ${active ? 'text-ink' : 'text-ink-muted'} hover:text-ink`}
        >
          {label}{active ? (sort.desc ? ' ↓' : ' ↑') : ''}
        </button>
      </th>
    );
  }

  return (
    <div className="bg-white min-h-[calc(100vh-4rem)] font-sans">
      <ResearchAreaNav />
      <div className="max-w-[1400px] mx-auto px-6 max-md:px-4 py-8 space-y-6">
        <Link href="/research/snapshots" className="text-xs text-ink-muted hover:text-green no-underline">← All snapshots</Link>

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

            <SectionCard
              title={`Members — ${keptCount} kept${removedCount ? `, ${removedCount} trimmed` : ''}`}
              actions={
                <>
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter ticker / name / sector"
                         className={`${inputCls} w-56`} />
                  <label className="text-sm text-ink-light flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} />
                    Show trimmed
                  </label>
                </>
              }
            >
              {/* Bulk actions for the selection */}
              <div className="px-5 py-3 border-b border-rule-light flex items-center gap-3 flex-wrap bg-surface-warm">
                <span className="text-sm text-ink-light">
                  {picked.length ? <strong className="text-ink">{picked.length} selected</strong> : 'Select rows to act on them'}
                </span>
                <button type="button" className={btnGhost} disabled={!pickedKept.length || patch.isPending}
                        onClick={() => bulk('remove')}>
                  Trim {pickedKept.length || ''}
                </button>
                {showRemoved && (
                  <button type="button" className={btnGhost} disabled={!pickedRemoved.length || patch.isPending}
                          onClick={() => bulk('restore')}>
                    Restore {pickedRemoved.length || ''}
                  </button>
                )}
                <span className="w-px h-6 bg-rule mx-1" />
                <AddToGroup
                  disabled={!picked.length}
                  label={picked.length ? `Add ${picked.length} to group` : 'Add to group'}
                  members={pickedMembers.map((m) => ({ permaticker: String(m.permaticker), ticker: m.ticker, name: m.name }))}
                />
              </div>
              {patch.isError && <div className="px-5 pt-3"><InlineError>{errDetail(patch.error, 'Could not update the snapshot.')}</InlineError></div>}

              <div className={`${tableStyles.container} max-h-[70vh] overflow-y-auto`}>
                <table className={tableStyles.table}>
                  <thead className="sticky top-0 bg-white z-10">
                    <tr>
                      <th className={`${tableStyles.th} w-8`}>
                        <input
                          type="checkbox"
                          checked={allPicked}
                          onChange={() => setSelected(allPicked ? new Set() : new Set(rows.map((m) => String(m.permaticker))))}
                          aria-label="Select all visible"
                        />
                      </th>
                      {sortHeader('ticker', 'Ticker', false)}
                      {sortHeader('name', 'Name', false)}
                      {sortHeader('sector', 'Sector', false)}
                      {COLS.map((c) => sortHeader(c.key, c.label))}
                      {sortHeader('rating', 'Rating', false)}
                      <th className={tableStyles.th}>Docs</th>
                      <th className={tableStyles.th}>Groups</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={COLS.length + 7} className="px-3 py-6 text-center text-sm text-ink-faint">
                          {all.length === 0 ? 'This snapshot has no members.' : 'No members match.'}
                        </td>
                      </tr>
                    )}
                    {rows.map((m) => {
                      const pt = String(m.permaticker);
                      const r = m.research;
                      return (
                        <tr
                          key={pt}
                          onClick={() => toggle(pt)}
                          className={`${tableStyles.row} cursor-pointer ${m.removed ? 'opacity-45' : ''} ${selected.has(pt) ? '!bg-green-soft' : ''}`}
                        >
                          <td className={tableStyles.td}>
                            <input type="checkbox" checked={selected.has(pt)} onChange={() => toggle(pt)}
                                   onClick={(e) => e.stopPropagation()} aria-label={`Select ${m.ticker ?? pt}`} />
                          </td>
                          <td className={`${tableStyles.td} font-mono font-semibold`}>
                            <Link href={`/research/stocks/${pt}`} onClick={(e) => e.stopPropagation()}
                                  className={`no-underline hover:text-green ${m.removed ? 'text-ink-muted line-through' : 'text-ink'}`}>
                              {m.ticker || `#${pt}`}
                            </Link>
                          </td>
                          <td className={`${tableStyles.td} max-w-[220px] truncate`} title={m.name ?? undefined}>{m.name || '—'}</td>
                          <td className={`${tableStyles.td} text-ink-light max-w-[140px] truncate`} title={m.industry ?? undefined}>
                            {m.sector || '—'}
                          </td>
                          {COLS.map((c) => (
                            <td key={String(c.key)} className={tableStyles.tdNum}>{fmt(m[c.key], c.fmt)}</td>
                          ))}
                          <td className={tableStyles.td}>
                            {r?.rating ? <RatingPill rating={r.rating} size="sm" showLabel={false} /> : <span className="text-xs text-ink-muted">—</span>}
                          </td>
                          <td className={tableStyles.td}>
                            {r ? <DocIndicators notes={r.has_notes} dd={r.has_dd} redteam={r.has_redteam} /> : <span className="text-xs text-ink-muted">—</span>}
                          </td>
                          <td className={tableStyles.td}><GroupChips groups={r?.groups} max={2} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </SectionCard>

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
