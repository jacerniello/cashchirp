'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

interface Watermark {
  table: string;
  watermark: string | null;
  last_run: string | null;
  rows_loaded: number | null;
}

interface WatermarksResponse {
  watermarks: Watermark[];
  running: string[];
}

interface RewindResult {
  to: string;
  changed: { table: string; was: string | null }[];
  skipped: string[];
}

function errDetail(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? fallback;
}

export function WatermarkManager() {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [to, setTo] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['setup-watermarks'],
    queryFn: async (): Promise<WatermarksResponse> => (await api.get('/setup/watermarks')).data,
    refetchInterval: 10000,
    retry: false,
  });

  const rewind = useMutation({
    mutationFn: async (): Promise<RewindResult> =>
      (await api.post('/setup/watermarks/rewind', { tables: [...picked], to })).data,
    onSuccess: () => {
      setPicked(new Set());
      qc.invalidateQueries({ queryKey: ['setup-watermarks'] });
    },
  });

  if (isError) {
    return (
      <div className="max-w-[900px] mx-auto px-6 py-10">
        <div className="rounded-xl border border-rule bg-white p-6 text-sm text-ink-light">
          Could not load the watermarks. Check that the backend is running.
        </div>
      </div>
    );
  }

  const rows = data?.watermarks ?? [];
  const running = data?.running ?? [];
  const allPicked = rows.length > 0 && rows.every((r) => picked.has(r.table));
  const toggle = (t: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });

  return (
    <div className="max-w-[900px] mx-auto px-6 py-10 space-y-6">
      {running.length > 0 && (
        <div className="rounded-xl border border-rule bg-white p-4 text-sm text-ink-light">
          <span className="font-medium text-ink">A job is running ({running.join(', ')}).</span>{' '}
          Rewinding is disabled until it stops — a sync finishing afterwards would write its
          own watermark over yours.
        </div>
      )}

      <div className="rounded-xl border border-rule bg-white overflow-hidden">
        <div className="px-6 py-4 border-b border-rule flex items-center justify-between gap-4 flex-wrap">
          <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">
            Watermarks {data && `(${rows.length})`}
          </h2>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="date"
              value={to}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-md border border-rule px-2 py-1 text-sm text-ink"
            />
            <button
              type="button"
              onClick={() => rewind.mutate()}
              disabled={!to || picked.size === 0 || running.length > 0 || rewind.isPending}
              className="rounded-lg bg-ink px-4 py-1.5 text-sm font-medium text-white border-0
                         cursor-pointer hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {rewind.isPending ? 'Rewinding…' : `Rewind ${picked.size || ''} to date`}
            </button>
          </div>
        </div>
        {isLoading && <p className="px-6 py-8 text-sm text-ink-muted">Loading…</p>}
        {data && rows.length === 0 && (
          <p className="px-6 py-8 text-sm text-ink-muted">
            No watermarks yet. Tables get one after their first sync.
          </p>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-6 py-2 font-medium w-8">
                    <input
                      type="checkbox"
                      checked={allPicked}
                      onChange={() =>
                        setPicked(allPicked ? new Set() : new Set(rows.map((r) => r.table)))
                      }
                      aria-label="Select all"
                    />
                  </th>
                  <th className="px-3 py-2 font-medium">Table</th>
                  <th className="px-3 py-2 font-medium">Next sync starts from</th>
                  <th className="px-3 py-2 font-medium">Last run</th>
                  <th className="px-6 py-2 font-medium text-right">Rows last run</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.table}
                    onClick={() => toggle(r.table)}
                    className="border-t border-rule cursor-pointer hover:bg-gray-50"
                  >
                    <td className="px-6 py-2.5">
                      <input
                        type="checkbox"
                        checked={picked.has(r.table)}
                        onChange={() => toggle(r.table)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Select ${r.table}`}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-ink">{r.table}</td>
                    <td className="px-3 py-2.5 tabular-nums text-ink">{r.watermark ?? '—'}</td>
                    <td className="px-3 py-2.5 tabular-nums text-ink-light text-xs">
                      {r.last_run ? r.last_run.replace('T', ' ').slice(0, 16) : '—'}
                    </td>
                    <td className="px-6 py-2.5 tabular-nums text-ink-light text-right">
                      {r.rows_loaded?.toLocaleString() ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {rewind.isSuccess && (
        <p className="text-sm text-ink-light bg-gray-50 rounded-lg px-3 py-2">
          {rewind.data.changed.length
            ? `Rewound ${rewind.data.changed.map((c) => c.table).join(', ')} to ${rewind.data.to}.`
            : 'Nothing changed.'}
          {rewind.data.skipped.length > 0 &&
            ` Already at or before ${rewind.data.to}: ${rewind.data.skipped.join(', ')}.`}
          {rewind.data.changed.length > 0 && ' Run the ingest to re-pull from there.'}
        </p>
      )}
      {rewind.isError && (
        <p className="text-sm text-red bg-red-soft rounded-lg px-3 py-2">
          {errDetail(rewind.error, 'Could not rewind.')}
        </p>
      )}
    </div>
  );
}
