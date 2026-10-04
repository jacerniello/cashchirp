'use client';

import { useEffect, useState } from 'react';
import { Markdown } from './Markdown';
import { btnDanger, btnGhost, btnPrimary, InlineError } from './ResearchBits';
import { segItem } from '@/lib/styles';

// A markdown document you can read, edit, preview and save. The file on disk may be edited
// by an AI at the same time, so the editor never silently overwrites: when the server copy
// changes while you have unsaved edits, it says so and lets you choose.

export function MarkdownEditor({
  value,
  onSave,
  onDelete,
  saving = false,
  error,
  emptyText = 'Nothing written yet.',
  startLabel = 'Start writing',
  placeholder = '# Thesis\n\n- …',
  minRows = 16,
  initialEditing = false,
}: {
  /** The saved text; null when the document does not exist yet. */
  value: string | null | undefined;
  onSave: (text: string) => Promise<unknown>;
  onDelete?: () => Promise<unknown>;
  saving?: boolean;
  error?: string | null;
  emptyText?: string;
  startLabel?: string;
  placeholder?: string;
  minRows?: number;
  /** Open straight into the editor (e.g. a note that is being created). */
  initialEditing?: boolean;
}) {
  const saved = value ?? '';
  const [editing, setEditing] = useState(initialEditing);
  const [preview, setPreview] = useState(false);
  const [draft, setDraft] = useState(saved);
  const [base, setBase] = useState(saved);
  const dirty = editing && draft !== base;
  const serverMoved = editing && saved !== base;

  // Follow the server copy while not editing, so an AI's edit shows up on refetch.
  useEffect(() => {
    if (!editing) {
      setDraft(saved);
      setBase(saved);
    }
  }, [saved, editing]);

  function start() {
    setDraft(saved);
    setBase(saved);
    setPreview(false);
    setEditing(true);
  }

  async function save() {
    try {
      await onSave(draft);
      setBase(draft);
      setEditing(false);
    } catch {
      /* error is shown via the `error` prop */
    }
  }

  if (!editing) {
    return (
      <div className="space-y-3">
        {saved.trim() ? (
          <Markdown text={saved} />
        ) : (
          <p className="text-sm text-ink-muted m-0">{emptyText}</p>
        )}
        <div className="flex items-center gap-2">
          <button type="button" className={saved.trim() ? btnGhost : btnPrimary} onClick={start}>
            {saved.trim() ? 'Edit' : startLabel}
          </button>
          {onDelete && value != null && (
            <button
              type="button"
              className={btnDanger}
              onClick={() => {
                if (window.confirm('Delete this document? The file is removed from the research folder.')) {
                  void onDelete().catch(() => {});
                }
              }}
            >
              Delete
            </button>
          )}
        </div>
        {error && <InlineError>{error}</InlineError>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="inline-flex gap-1">
          <button type="button" className={segItem(!preview)} onClick={() => setPreview(false)}>Write</button>
          <button type="button" className={segItem(preview)} onClick={() => setPreview(true)}>Preview</button>
        </div>
        <span className="text-xs text-ink-muted">Markdown · {dirty ? 'unsaved changes' : 'no changes'}</span>
      </div>
      {serverMoved && (
        <div className="text-xs bg-gold-soft text-ink-light rounded-lg px-3 py-2 flex items-center gap-2 flex-wrap">
          The file changed on the server while you were editing (an AI or another tab wrote to it).
          Saving will overwrite that version.
          <button type="button" className="underline bg-transparent border-0 cursor-pointer text-ink p-0"
                  onClick={() => { setDraft(saved); setBase(saved); }}>
            Discard mine and load theirs
          </button>
        </div>
      )}
      {preview ? (
        <div className="min-h-[200px] rounded-lg border border-rule-light p-4">
          {draft.trim() ? <Markdown text={draft} /> : <p className="text-sm text-ink-muted m-0">Nothing to preview.</p>}
        </div>
      ) : (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={minRows}
          placeholder={placeholder}
          spellCheck
          className="w-full text-sm font-mono border border-rule rounded-lg px-3 py-2 text-ink bg-white leading-relaxed focus:outline-none focus:border-green"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
              e.preventDefault();
              void save();
            }
          }}
        />
      )}
      <div className="flex items-center gap-2">
        <button type="button" className={btnPrimary} disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className={btnGhost}
          onClick={() => {
            if (!dirty || window.confirm('Discard your unsaved changes?')) setEditing(false);
          }}
        >
          Cancel
        </button>
        <span className="text-xs text-ink-muted">⌘S to save</span>
      </div>
      {error && <InlineError>{error}</InlineError>}
    </div>
  );
}
