'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  useScreens, useSaveScreen, useDeleteScreen, fetchScreen,
} from '@/hooks/useSavedScreens';
import type { ScreenerParams } from '@/hooks/useScreener';

// Save the current filter as a named screen, and manage the ones already saved.
//
// It writes `config/screens/<id>.yaml` — the same format the idea board and the CLI
// read — so the filter you just built is immediately runnable instead of living only in
// this page's URL.

function slug(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
}

export function SaveScreen({ params }: { params: ScreenerParams }) {
  const { data } = useScreens();
  const save = useSaveScreen();
  const del = useDeleteScreen();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [result, setResult] = useState<{ id: string; unsupported: string[]; run: string; carried: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  // Which screen these filters came from, if any. Sent back on save so the parts the
  // grid cannot show (growth rules, exclusive bounds, on_null) are carried forward
  // instead of being silently deleted by an edit-and-save.
  const base = useSearchParams().get('from') || undefined;
  const [loading, setLoading] = useState<string | null>(null);
  const [lossy, setLossy] = useState<{ id: string; items: string[] } | null>(null);

  // Clicking a screen LOADS it into the grid: the server turns the spec back into filter
  // params and we push them as the URL, which is already this page's source of truth for
  // initial state. So the filter becomes shareable and bookmarkable for free.
  async function loadScreen(id: string) {
    setLoading(id); setErr(null); setLossy(null);
    try {
      const d = await fetchScreen(id);
      const qs = new URLSearchParams({ ...d.url_params, from: id }).toString();
      router.push(`/screener?${qs}`);
      // Constraints with no widget still apply when the screen is RUN — say so, or the
      // grid silently looks like the whole screen.
      if (d.lossy.length) setLossy({ id, items: d.lossy });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(null);
    }
  }

  const id = slug(name);

  async function onSave(overwrite = false) {
    setErr(null);
    try {
      const r = await save.mutateAsync({ id, title: name.trim(), description, params, overwrite, base });
      setResult({ id: r.saved, unsupported: r.unsupported, run: r.run, carried: r.carried ?? [] });
      setName(''); setDescription('');
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(detail || (e as Error).message);
    }
  }

  return (
    <div className="border border-rule rounded-xl bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-transparent border-0 cursor-pointer text-left"
      >
        <span className="text-sm font-semibold text-ink">
          Saved screens{data?.screens?.length ? ` (${data.screens.length})` : ''}
        </span>
        <span className="text-xs text-ink-muted">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-rule-light pt-3">
          {/* --- save the current filter --- */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-ink-light">
              Save the current filter
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name it — e.g. Cheap quality compounders"
              className="w-full text-sm border border-rule rounded-lg px-3 py-2 text-ink"
            />
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this screen looking for, and why? (optional)"
              className="w-full text-sm border border-rule rounded-lg px-3 py-2 text-ink"
            />
            {id && (
              <p className="text-xs text-ink-muted">
                Saves to <code className="font-mono">config/screens/{id}.yaml</code>
              </p>
            )}
            <button
              type="button"
              disabled={!id || save.isPending}
              onClick={() => onSave(false)}
              className="text-sm rounded-lg bg-green text-white px-4 py-2 border-0 cursor-pointer
                         disabled:opacity-40 disabled:cursor-not-allowed hover:bg-green-dark"
            >
              {save.isPending ? 'Saving…' : 'Save filter'}
            </button>

            {err && (
              <div className="text-xs text-neg bg-neg-soft rounded-lg px-3 py-2">
                {err}
                {err.includes('already exists') && (
                  <button
                    type="button"
                    onClick={() => onSave(true)}
                    className="ml-2 underline bg-transparent border-0 text-neg cursor-pointer"
                  >
                    overwrite
                  </button>
                )}
              </div>
            )}

            {result && (
              <div className="text-xs bg-green-soft text-green-text rounded-lg px-3 py-2 space-y-1">
                <div>
                  Saved <strong>{result.id}</strong>. Run it:{' '}
                  <code className="font-mono">{result.run}</code>
                </div>
                {/* A saved filter that silently lost a constraint is worse than a failed
                    save — the saved screen wouldn't be the one you looked at. */}
                {result.carried.length > 0 && (
                  <div>
                    Carried over from <strong>{base}</strong> (no widget for these, kept so
                    the edit didn&apos;t delete them): {result.carried.join('; ')}
                  </div>
                )}
                {result.unsupported.length > 0 && (
                  <div className="text-neg">
                    <strong>Not captured:</strong>
                    <ul className="list-disc ml-4">
                      {result.unsupported.map((u) => <li key={u}>{u}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* --- what's already saved --- */}
          {data?.screens?.length ? (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-ink-light">Saved</div>
              {data.screens.map((s) => (
                <div key={s.id} className="flex items-start gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => loadScreen(s.id)}
                    title="Load this screen into the filter"
                    className="flex-1 text-left bg-transparent border-0 cursor-pointer p-0 group"
                  >
                    <span className="text-ink group-hover:text-green transition-colors">
                      {s.title}
                    </span>
                    {loading === s.id && (
                      <span className="ml-2 text-xs text-ink-muted">loading…</span>
                    )}
                    {s.id === data.active && (
                      <span className="ml-2 text-[0.7rem] rounded bg-green-soft text-green-text px-1.5 py-0.5">
                        active
                      </span>
                    )}
                    <div className="font-mono text-[0.7rem] text-ink-muted">{s.id}.yaml</div>
                  </button>
                  {s.id !== data.active && (
                    <button
                      type="button"
                      onClick={() => del.mutate(s.id)}
                      className="text-xs text-ink-muted hover:text-neg bg-transparent border-0 cursor-pointer"
                    >
                      delete
                    </button>
                  )}
                </div>
              ))}
              {lossy && (
                <div className="text-xs bg-gold-soft text-ink-light rounded-lg px-3 py-2">
                  <strong>{lossy.id}</strong> loaded, but the grid has no widget for:
                  <ul className="list-disc ml-4 mt-1">
                    {lossy.items.map((x) => <li key={x}>{x}</li>)}
                  </ul>
                  These still apply when the screen is run from the CLI or as{' '}
                  <code className="font-mono">ACTIVE_SCREEN</code>.
                </div>
              )}
              <p className="text-xs text-ink-faint pt-1">
                Click a screen to load it into the filter. The{' '}
                <strong>active</strong> one drives <code className="font-mono">/ideas</code>.
                Change it with <code className="font-mono">ACTIVE_SCREEN</code> in{' '}
                <code className="font-mono">core/.env</code>.
              </p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
