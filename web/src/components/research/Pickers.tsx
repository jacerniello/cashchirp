'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import {
  errDetail,
  useCreateGroup,
  useGroups,
  usePatchGroup,
  type MemberInput,
} from '@/hooks/useResearch';
import { btnPrimary, inputCls, InlineError } from './ResearchBits';

// Two pickers the research pages share: find a stock by ticker/name (resolving to its
// permaticker), and add stocks to a group — an existing one, or one created on the spot.

export interface PickedStock {
  permaticker: string;
  ticker: string;
  name: string;
}

interface SearchHit {
  permaticker?: string | number | null;
  ticker?: string;
  name?: string;
  exchange?: string;
  category?: string;
}

export function StockSearch({
  onPick,
  placeholder = 'Add a stock — ticker or name',
  exclude,
}: {
  onPick: (s: PickedStock) => void;
  placeholder?: string;
  /** Permatickers already present, shown as such rather than offered again. */
  exclude?: Set<string>;
}) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const { data, isFetching, isError } = useQuery({
    queryKey: ['research-stock-search', debounced],
    queryFn: async (): Promise<SearchHit[]> =>
      (await api.get('/search/', { params: { type: 'stock', q: debounced, limit: 10 } })).data?.results ?? [],
    enabled: debounced.length >= 1,
    retry: false,
    staleTime: 60_000,
  });
  const hits = (data ?? []).filter((h) => h.permaticker != null && h.permaticker !== '');

  return (
    <div ref={box} className="relative w-full max-w-sm">
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className={`${inputCls} w-full`}
      />
      {open && debounced && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-rule bg-white shadow-md max-h-72 overflow-y-auto">
          {isError ? (
            <p className="px-3 py-2 text-xs text-neg m-0">Search failed — is the backend running?</p>
          ) : isFetching && !hits.length ? (
            <p className="px-3 py-2 text-xs text-ink-muted m-0">Searching…</p>
          ) : !hits.length ? (
            <p className="px-3 py-2 text-xs text-ink-muted m-0">No matches.</p>
          ) : (
            hits.map((h) => {
              const pt = String(h.permaticker);
              const already = exclude?.has(pt);
              return (
                <button
                  key={pt}
                  type="button"
                  disabled={already}
                  onClick={() => {
                    onPick({ permaticker: pt, ticker: h.ticker ?? '', name: h.name ?? '' });
                    setQ('');
                    setOpen(false);
                  }}
                  className="w-full text-left flex items-baseline gap-2 px-3 py-1.5 bg-white border-0 cursor-pointer hover:bg-green-soft disabled:opacity-50 disabled:cursor-default"
                >
                  <span className="font-mono text-xs font-semibold text-ink w-14 shrink-0">{h.ticker}</span>
                  <span className="text-xs text-ink-light truncate flex-1">{h.name}</span>
                  <span className="text-[10px] text-ink-muted shrink-0">
                    {already ? 'added' : h.category === 'ETF' ? 'ETF' : h.exchange}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

const NEW = '__new__';

/** Add `members` to a group. Choosing "New group…" creates it first, then adds. */
export function AddToGroup({
  members,
  disabled,
  label = 'Add to group',
  exclude,
  onDone,
}: {
  members: MemberInput[];
  disabled?: boolean;
  label?: string;
  /** Group ids to leave out of the list (e.g. ones the stock is already in). */
  exclude?: Set<string>;
  onDone?: (groupId: string, groupName: string) => void;
}) {
  const groups = useGroups();
  const create = useCreateGroup();
  const patch = usePatchGroup();
  const [choice, setChoice] = useState('');
  const [newName, setNewName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const busy = create.isPending || patch.isPending;
  const options = (groups.data ?? []).filter((g) => !g.error && !exclude?.has(g.id));

  async function go() {
    setErr(null);
    setDone(null);
    try {
      let id = choice;
      let name = options.find((g) => g.id === choice)?.name ?? choice;
      if (choice === NEW) {
        const g = await create.mutateAsync({ name: newName.trim() });
        id = g.id;
        name = g.name;
      }
      await patch.mutateAsync({ id, add: members });
      setDone(`Added ${members.length === 1 ? '1 stock' : `${members.length} stocks`} to ${name}.`);
      setChoice('');
      setNewName('');
      onDone?.(id, name);
    } catch (e) {
      setErr(errDetail(e, 'Could not add to the group.'));
    }
  }

  const ready = !!choice && (choice !== NEW || !!newName.trim()) && members.length > 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          disabled={disabled || busy}
          className={inputCls}
        >
          <option value="">{groups.isError ? 'Groups unavailable' : 'Choose a group…'}</option>
          {options.map((g) => (
            <option key={g.id} value={g.id}>{g.name} ({g.members?.length ?? 0})</option>
          ))}
          <option value={NEW}>+ New group…</option>
        </select>
        {choice === NEW && (
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New group name"
            className={inputCls}
            onKeyDown={(e) => { if (e.key === 'Enter' && ready) void go(); }}
          />
        )}
        <button type="button" className={btnPrimary} disabled={disabled || busy || !ready} onClick={go}>
          {busy ? 'Adding…' : label}
        </button>
      </div>
      {err && <InlineError>{err}</InlineError>}
      {done && <p className="text-xs text-green-text m-0">{done}</p>}
    </div>
  );
}
