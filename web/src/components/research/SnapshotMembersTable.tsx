'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import {
  btnGhost,
  DocIndicators,
  InlineError,
  inputCls,
  RatingPill,
  SectionCard,
} from '@/components/research/ResearchBits';
import { ratingScore, toNum, type SnapshotMember } from '@/hooks/useResearch';
import { formatCurrency } from '@/lib/formatters';
import { tableStyles } from '@/lib/styles';

// The members table a snapshot shows — metrics plus research status (rating, docs), with
// selection, trim/restore (members are marked removed, never deleted, so a trim can be
// undone) and the caller's selection actions (e.g. start a report). Rows are keyed and
// selected by permaticker, never ticker.

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

interface Props {
  members: SnapshotMember[];
  /** Trim (`remove`) or `restore` the given permatickers. Resolve true on
   *  success so the selection can be cleared. */
  onBulk?: (kind: 'remove' | 'restore', ids: string[]) => Promise<boolean>;
  busy?: boolean;
  /** An error from the last bulk action, shown under the action bar. */
  error?: string | null;
  /** A line under the action bar. */
  notice?: ReactNode;
  emptyText?: string;
  /** Extra actions for the current selection (e.g. "Start a report"), shown in the action bar. */
  selectionActions?: (picked: SnapshotMember[]) => ReactNode;
}

export function SnapshotMembersTable({ members, onBulk, busy, error, notice, emptyText, selectionActions }: Props) {
  const [showRemoved, setShowRemoved] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'market_cap', desc: true });

  const keptCount = members.filter((m) => !m.removed).length;
  const removedCount = members.length - keptCount;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = members.filter((m) =>
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
  }, [members, showRemoved, q, sort]);

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
    if (!ids.length || !onBulk) return;
    if (await onBulk(kind, ids)) setSelected(new Set());
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

  const title = `Members — ${keptCount} kept${removedCount ? `, ${removedCount} trimmed` : ''}`;

  return (
    <SectionCard
      title={title}
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
        <button type="button" className={btnGhost} disabled={!pickedKept.length || busy}
                onClick={() => bulk('remove')}>
          Trim {pickedKept.length || ''}
        </button>
        {showRemoved && (
          <button type="button" className={btnGhost} disabled={!pickedRemoved.length || busy}
                  onClick={() => bulk('restore')}>
            Restore {pickedRemoved.length || ''}
          </button>
        )}
        {selectionActions && (
          <>
            <span className="w-px h-6 bg-rule mx-1" />
            {selectionActions(pickedMembers)}
          </>
        )}
      </div>
      {error && <div className="px-5 pt-3"><InlineError>{error}</InlineError></div>}
      {notice && <div className="px-5 pt-3 text-xs text-ink-muted">{notice}</div>}

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
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLS.length + 6} className="px-3 py-6 text-center text-sm text-ink-faint">
                  {members.length === 0 ? (emptyText ?? 'This snapshot has no members.') : 'No members match.'}
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
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
