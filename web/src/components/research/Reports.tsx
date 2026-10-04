'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/Badge';
import {
  errDetail,
  toNum,
  useCreateReport,
  useSnapshots,
  type ReportSource,
} from '@/hooks/useResearch';
import { btnGhost, btnPrimary, fmtWhen, InlineError, inputCls } from './ResearchBits';

// Pieces the report pages (and the snapshot and idea pages) share.
//
// A report is one analysis run, built at a particular time: a set of stocks with a DD (and
// maybe a red team) each, done as of that report, and its own ranking. Re-analysing later
// means a new report, so a report's numbers are a record, never refreshed in place.

export function fmtPrice(v: unknown): string {
  const n = toNum(v);
  if (n == null) return '—';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Fractional change from `then` to `now`, or null when either is missing. */
function priceMove(then: unknown, now: unknown): number | null {
  const a = toNum(then);
  const b = toNum(now);
  if (a == null || b == null || a <= 0) return null;
  return b / a - 1;
}

/** "$12.30 → $14.10 +15%" — the price an analysis was written at, and today's. */
export function PriceThenNow({ then, now, nowDate }: { then: unknown; now: unknown; nowDate?: string | null }) {
  const mv = priceMove(then, now);
  return (
    <span className="tabular-nums whitespace-nowrap" title={nowDate ? `latest close ${nowDate}` : undefined}>
      <span className="text-ink-light">{fmtPrice(then)}</span>
      <span className="text-ink-muted"> → </span>
      <span className="text-ink">{fmtPrice(now)}</span>
      {mv != null && (
        <span className={`ml-1 text-xs font-semibold ${mv >= 0 ? 'text-pos' : 'text-neg'}`}>
          {mv >= 0 ? '+' : ''}{(mv * 100).toFixed(0)}%
        </span>
      )}
    </span>
  );
}

export function ReportStatusBadge({ status }: { status?: string }) {
  return status === 'complete' ? <Badge variant="green">complete</Badge> : <Badge variant="blue">open</Badge>;
}

/** Where a report's members came from, with links back. Anything but a snapshot source
 *  (including a legacy one in an old report.json) reads as hand-picked. */
export function ReportSourceLine({ source }: { source?: ReportSource }) {
  if (source?.kind !== 'snapshot') return <span>Hand-picked</span>;
  return (
    <span>
      From snapshot{' '}
      {source.snapshot_id ? (
        <Link href={`/screener/snapshots/${encodeURIComponent(source.snapshot_id)}`} className="text-green">
          {source.snapshot_name || source.snapshot_id}
        </Link>
      ) : '?'}
      {source.screen_id && (
        <>
          {' '}of idea{' '}
          <Link href={`/screener/ideas/${encodeURIComponent(source.screen_id)}`} className="text-green">
            {source.screen_title || source.screen_id}
          </Link>
        </>
      )}
    </span>
  );
}

/** The instruction that completes a report from a Claude session in the research folder. */
export function reportInstruction(id: string): string {
  return (
    `Complete report ${id}: write a DD (per _guide/DD_STANDARD.md) for every member of ` +
    `reports/${id}/report.json that has no reports/${id}/stocks/<permaticker>/dd.json, ` +
    `then red-team the ones rated 5–6.`
  );
}

/** "Start a report" from a snapshot — all kept members, or just the selected rows. */
export function StartReportFromSnapshot({
  snapshotId,
  defaultName,
  selected,
}: {
  snapshotId: string;
  defaultName?: string;
  /** Permatickers of the selected rows; empty means "all kept members". */
  selected: string[];
}) {
  const router = useRouter();
  const create = useCreateReport();
  const [name, setName] = useState('');
  const subset = selected.length > 0;

  async function go() {
    try {
      const r = await create.mutateAsync({
        name: name.trim() || defaultName,
        snapshot_id: snapshotId,
        ...(subset ? { permatickers: selected, members_from: 'selected' as const } : { members_from: 'kept' as const }),
      });
      router.push(r.open);
    } catch {
      /* shown below */
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={defaultName || 'Report name'}
               className={`${inputCls} w-56`} />
        <button type="button" className={btnPrimary} disabled={create.isPending} onClick={go}>
          {create.isPending ? 'Starting…' : subset ? `Start a report on ${selected.length} selected` : 'Start a report on all kept'}
        </button>
      </div>
      {create.isError && <InlineError>{errDetail(create.error, 'Could not start the report.')}</InlineError>}
    </div>
  );
}

/** "New report" — from a snapshot (picker), or empty. */
export function NewReportForm() {
  const router = useRouter();
  const snaps = useSnapshots();
  const create = useCreateReport();
  const [kind, setKind] = useState<'snapshot' | 'manual'>('snapshot');
  const [snapshotId, setSnapshotId] = useState('');
  const [name, setName] = useState('');
  const [thesis, setThesis] = useState('');

  const ready = kind === 'manual' ? !!name.trim() : !!snapshotId;

  async function go() {
    try {
      const r = await create.mutateAsync({
        name: name.trim() || undefined,
        thesis: thesis.trim() || undefined,
        ...(kind === 'snapshot' ? { snapshot_id: snapshotId, members_from: 'kept' as const } : {}),
      });
      router.push(r.open);
    } catch {
      /* shown below */
    }
  }

  const tab = (k: typeof kind, label: string) => (
    <button type="button" onClick={() => setKind(k)} className={kind === k ? btnPrimary : btnGhost}>{label}</button>
  );

  return (
    <div className="px-5 py-4 space-y-3">
      <div className="flex gap-2 flex-wrap">
        {tab('snapshot', 'From a snapshot')}
        {tab('manual', 'Empty')}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {kind === 'snapshot' && (
          <select value={snapshotId} onChange={(e) => setSnapshotId(e.target.value)} className={`${inputCls} max-w-[420px]`}>
            <option value="">
              {snaps.isError ? 'Snapshots unavailable' : snaps.isLoading ? 'Loading snapshots…' : 'Choose a snapshot…'}
            </option>
            {(snaps.data ?? []).filter((s) => !s.error).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.count ?? 0} kept · {fmtWhen(s.created_at)}
              </option>
            ))}
          </select>
        )}
        <input value={name} onChange={(e) => setName(e.target.value)}
               placeholder={kind === 'manual' ? 'Report name' : 'Name (defaults to the source’s)'}
               className={`${inputCls} w-64`} />
      </div>
      <textarea value={thesis} onChange={(e) => setThesis(e.target.value)} rows={2}
                placeholder="Thesis — what this run is testing (defaults to the snapshot note)"
                className={`${inputCls} w-full`} />
      <div className="flex items-center gap-3">
        <button type="button" className={btnPrimary} disabled={!ready || create.isPending} onClick={go}>
          {create.isPending ? 'Creating…' : 'Create report'}
        </button>
        <span className="text-xs text-ink-muted">
          {kind === 'snapshot' ? 'Members: the snapshot’s kept (untrimmed) stocks.' : 'Add members on the report page.'}
        </span>
      </div>
      {create.isError && <InlineError>{errDetail(create.error, 'Could not create the report.')}</InlineError>}
    </div>
  );
}
