'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ResearchAreaNav } from '../ResearchAreaNav';
import { MarkdownEditor } from '@/components/research/MarkdownEditor';
import {
  btnPrimary,
  ClaudeInstruction,
  ErrorPanel,
  fmtWhen,
  InlineError,
  inputCls,
  PageHeader,
} from '@/components/research/ResearchBits';
import {
  errDetail,
  isNotFound,
  useDeleteNote,
  useNote,
  useNotes,
  useResearchGuide,
  useSaveNote,
  type NoteEntry,
} from '@/hooks/useResearch';

// Free-form notes not tied to one stock — insights, theses, reading lists — as markdown
// files under notes/ in the research folder. The selected note lives in ?path= so it can
// be linked to.

function normalisePath(p: string): string {
  let s = p.trim().replace(/^\/+/, '').replace(/\s+/g, '-');
  if (s && !s.endsWith('.md')) s += '.md';
  return s;
}

function NotesInner() {
  const router = useRouter();
  const search = useSearchParams();
  const selected = search.get('path');
  const isNew = search.get('new') === '1';
  const list = useNotes();
  const note = useNote(selected && !isNew ? selected : null);
  const guide = useResearchGuide();
  const save = useSaveNote();
  const del = useDeleteNote();
  const [newPath, setNewPath] = useState('');

  const folders = useMemo(() => {
    const m = new Map<string, NoteEntry[]>();
    for (const n of list.data ?? []) {
      const i = n.path.lastIndexOf('/');
      const folder = i >= 0 ? n.path.slice(0, i) : '';
      if (!m.has(folder)) m.set(folder, []);
      m.get(folder)!.push(n);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [list.data]);

  const exists = !!selected && (list.data ?? []).some((n) => n.path === selected);

  function open(path: string, fresh = false) {
    const q = new URLSearchParams({ path });
    if (fresh) q.set('new', '1');
    router.replace(`/research/notes?${q.toString()}`, { scroll: false });
  }

  function create() {
    const p = normalisePath(newPath);
    if (!p) return;
    setNewPath('');
    const already = (list.data ?? []).some((n) => n.path === p);
    open(p, !already);
  }

  return (
    <div className="max-w-[1200px] mx-auto px-6 max-md:px-4 py-8 grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6">
      <aside className="space-y-4">
        <div className="rounded-xl border border-rule bg-white p-3 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">New note</div>
          <input
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            placeholder="insights/rate-cuts.md"
            className={`${inputCls} w-full font-mono text-xs`}
            onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
          />
          <button type="button" className={`${btnPrimary} w-full`} disabled={!normalisePath(newPath)} onClick={create}>
            Create
          </button>
          <p className="text-[11px] text-ink-muted m-0">Use slashes for folders.</p>
        </div>

        <div className="rounded-xl border border-rule bg-white p-3">
          {list.isLoading && <p className="text-sm text-ink-muted m-0">Loading notes…</p>}
          {list.isError && <p className="text-sm text-neg m-0">Could not load the notes list.</p>}
          {list.data && list.data.length === 0 && (
            <p className="text-sm text-ink-muted m-0">No notes yet. Create one above.</p>
          )}
          {folders.map(([folder, notes]) => (
            <div key={folder || '(root)'} className="mb-3 last:mb-0">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint mb-1">
                {folder || 'notes'}
              </div>
              <ul className="list-none m-0 p-0">
                {notes.map((n) => {
                  const nm = n.path.slice(folder ? folder.length + 1 : 0);
                  const active = n.path === selected;
                  return (
                    <li key={n.path}>
                      <button
                        type="button"
                        onClick={() => open(n.path)}
                        className={`w-full text-left px-2 py-1 rounded-md border-0 cursor-pointer text-sm truncate ${
                          active ? 'bg-green-soft text-green-text font-medium' : 'bg-transparent text-ink-light hover:bg-surface'
                        }`}
                        title={`${n.path} · updated ${fmtWhen(n.updated_at, true)}`}
                      >
                        {nm.replace(/\.md$/, '')}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </aside>

      <section className="space-y-4 min-w-0">
        {!selected ? (
          list.isError ? (
            <ErrorPanel title="Could not load notes." />
          ) : (
            <div className="rounded-xl border border-rule bg-white p-6 text-sm text-ink-light">
              Pick a note on the left, or create one. Notes are markdown files under{' '}
              <code className="font-mono">notes/</code> in the research folder — Claude can read and write them too.
            </div>
          )
        ) : (
          <div className="rounded-xl border border-rule bg-white p-5">
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <h2 className="text-base font-mono font-semibold text-ink m-0 break-all">{selected}</h2>
              {note.data && exists && (
                <span className="text-xs text-ink-muted">
                  updated {fmtWhen((list.data ?? []).find((n) => n.path === selected)?.updated_at, true)}
                </span>
              )}
            </div>
            {!isNew && note.isLoading && <p className="text-sm text-ink-muted m-0">Loading note…</p>}
            {!isNew && note.isError && !isNotFound(note.error) && (
              <InlineError>{errDetail(note.error, 'Could not load this note.')}</InlineError>
            )}
            {(isNew || note.data || isNotFound(note.error)) && (
              <MarkdownEditor
                key={selected + (isNew ? ':new' : '')}
                value={isNew || isNotFound(note.error) ? null : note.data?.text ?? ''}
                initialEditing={isNew}
                saving={save.isPending}
                error={save.isError ? errDetail(save.error, 'Could not save.') : del.isError ? errDetail(del.error) : null}
                emptyText={isNotFound(note.error) ? 'This note does not exist yet.' : 'This note is empty.'}
                startLabel="Write it"
                placeholder={`# ${selected.replace(/\.md$/, '').split('/').pop()}\n\n`}
                onSave={async (text) => {
                  const r = await save.mutateAsync({ path: selected, text });
                  if (isNew) open(r.saved || selected);
                }}
                onDelete={async () => {
                  await del.mutateAsync(selected);
                  router.replace('/research/notes', { scroll: false });
                }}
              />
            )}
          </div>
        )}

        <ClaudeInstruction
          root={guide.data?.root}
          blurb="Claude can keep notes here as well — they are plain markdown under notes/."
          instruction="Summarise what the DD reports rated 5–6 have in common and write it to notes/insights/what-the-best-ideas-share.md."
        />
      </section>
    </div>
  );
}

export default function NotesPage() {
  return (
    <div className="bg-surface min-h-[calc(100vh-4rem)] font-sans">
      <ResearchAreaNav />
      <div className="bg-white">
        <PageHeader title="Notes">
          Free-form research notes that are not about one stock — insights, theses, things to check.
        </PageHeader>
      </div>
      <Suspense fallback={<p className="text-sm text-ink-muted text-center py-8">Loading…</p>}>
        <NotesInner />
      </Suspense>
    </div>
  );
}
