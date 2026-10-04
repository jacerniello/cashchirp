'use client';

import { useEffect, useMemo, useState } from 'react';
import { MarkdownEditor } from './MarkdownEditor';
import { btnPrimary, fmtWhen, InlineError, inputCls, SectionCard } from './ResearchBits';
import {
  errDetail,
  isNotFound,
  useDeleteReportNote,
  useReportNote,
  useReportNotes,
  useSaveReportNote,
  type NoteEntry,
} from '@/hooks/useResearch';

// A report's own notes — thesis work, logs, experiment write-ups — as Markdown files under
// reports/<id>/notes/. The open note is kept in ?note= so it can be linked to; other files
// in that folder (data, scripts) stay on disk but are not listed here.

function normalisePath(p: string): string {
  let s = p.trim().replace(/^\/+/, '').replace(/\s+/g, '-');
  if (s && !s.endsWith('.md')) s += '.md';
  return s;
}

function setNoteParam(path: string | null) {
  const url = new URL(window.location.href);
  if (path) url.searchParams.set('note', path);
  else url.searchParams.delete('note');
  window.history.replaceState(null, '', url.toString());
}

export function ReportNotes({ reportId, disabled }: { reportId: string; disabled?: boolean }) {
  const list = useReportNotes(reportId);
  const [selected, setSelected] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [newPath, setNewPath] = useState('');
  const note = useReportNote(reportId, selected && !isNew ? selected : null);
  const save = useSaveReportNote(reportId);
  const del = useDeleteReportNote(reportId);

  // ?note= deep-links a note.
  useEffect(() => {
    const p = new URL(window.location.href).searchParams.get('note');
    if (p) setSelected(p);
  }, []);

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

  const entry = (list.data ?? []).find((n) => n.path === selected);

  function open(path: string | null, fresh = false) {
    setSelected(path);
    setIsNew(fresh);
    setNoteParam(path);
  }

  function create() {
    const p = normalisePath(newPath);
    if (!p) return;
    setNewPath('');
    open(p, !(list.data ?? []).some((n) => n.path === p));
  }

  return (
    <SectionCard title={`Notes${list.data ? ` (${list.data.length})` : ''}`}>
      <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-0 md:divide-x divide-rule-light">
        <aside className="p-4 space-y-4">
          <div className="space-y-2">
            <input
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              placeholder="thesis/what-would-change.md"
              className={`${inputCls} w-full font-mono text-xs`}
              disabled={disabled}
              onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
            />
            <button type="button" className={`${btnPrimary} w-full`} disabled={disabled || !normalisePath(newPath)} onClick={create}>
              New note
            </button>
          </div>
          <div>
            {list.isLoading && <p className="text-sm text-ink-muted m-0">Loading notes…</p>}
            {list.isError && <p className="text-sm text-neg m-0">Could not load this report&apos;s notes.</p>}
            {list.data && list.data.length === 0 && (
              <p className="text-sm text-ink-muted m-0">No notes in this report yet.</p>
            )}
            {folders.map(([folder, notes]) => (
              <div key={folder || '(root)'} className="mb-3 last:mb-0">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint mb-1">
                  {folder || 'notes'}
                </div>
                <ul className="list-none m-0 p-0">
                  {notes.map((n) => {
                    const nm = n.path.slice(folder ? folder.length + 1 : 0);
                    return (
                      <li key={n.path}>
                        <button
                          type="button"
                          onClick={() => open(n.path)}
                          className={`w-full text-left px-2 py-1 rounded-md border-0 cursor-pointer text-sm truncate ${
                            n.path === selected ? 'bg-green-soft text-green-text font-medium' : 'bg-transparent text-ink-light hover:bg-surface'
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

        <section className="p-5 min-w-0">
          {!selected ? (
            <p className="text-sm text-ink-light m-0">
              Pick a note, or create one. Notes are Markdown files under{' '}
              <code className="font-mono">reports/{reportId}/notes/</code> — Claude reads and writes them too.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                <h3 className="text-base font-mono font-semibold text-ink m-0 break-all">{selected}</h3>
                <span className="flex items-center gap-3">
                  {entry && <span className="text-xs text-ink-muted">updated {fmtWhen(entry.updated_at, true)}</span>}
                  <button type="button" onClick={() => open(null)}
                          className="bg-transparent border-0 cursor-pointer text-xs text-ink-muted hover:text-ink">
                    close
                  </button>
                </span>
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
                    open(null);
                  }}
                />
              )}
            </>
          )}
        </section>
      </div>
    </SectionCard>
  );
}
