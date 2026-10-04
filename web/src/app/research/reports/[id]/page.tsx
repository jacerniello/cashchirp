'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ResearchAreaNav } from '../../ResearchAreaNav';
import { AddToGroup, StockSearch } from '@/components/research/Pickers';
import {
  AddedByBadge,
  btnDanger,
  btnGhost,
  btnPrimary,
  ClaudeInstruction,
  ErrorPanel,
  fmtSignedPct,
  fmtWhen,
  GroupChips,
  InlineError,
  inputCls,
  RatingPill,
  SectionCard,
} from '@/components/research/ResearchBits';
import {
  PriceThenNow,
  reportInstruction,
  ReportSourceLine,
  ReportStatusBadge,
} from '@/components/research/Reports';
import {
  errDetail,
  isNotFound,
  toNum,
  useDeleteReport,
  usePatchReport,
  useReport,
  useResearchGuide,
  useSnapshot,
  type ReportMember,
} from '@/hooks/useResearch';
import { tableStyles } from '@/lib/styles';

// One report: an analysis run built at a particular time. The API returns its members in
// ranking order (score desc, base upside desc; unanalysed last), so the table below is the
// report's own ranking — independent of any later analysis of the same stocks.

export default function ReportPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id ?? '');
  const router = useRouter();
  const { data: rep, isLoading, isError, error } = useReport(id);
  const guide = useResearchGuide();
  const patch = usePatchReport();
  const del = useDeleteReport();
  const src = rep?.source;
  const snapId = src?.kind === 'snapshot' ? src.snapshot_id ?? '' : '';
  const snap = useSnapshot(snapId);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [thesis, setThesis] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (rep && !editing) {
      setName(rep.name ?? '');
      setThesis(rep.thesis ?? '');
    }
  }, [rep, editing]);

  const members = useMemo(() => (Array.isArray(rep?.members) ? rep.members : []), [rep]);
  const analysed = members.filter((m) => m.analysis?.has_dd);
  const pending = members.filter((m) => !m.analysis?.has_dd);
  const memberIds = useMemo(() => new Set(members.map((m) => String(m.permaticker))), [members]);
  // The source snapshot's kept members not yet in the report — what "Expand" would add.
  const remaining = (snap.data?.members ?? []).filter((m) => !m.removed && !memberIds.has(String(m.permaticker)));
  const pickedMembers = members.filter((m) => selected.has(String(m.permaticker)));

  function toggle(pt: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(pt)) n.delete(pt);
      else n.add(pt);
      return n;
    });
  }

  async function saveMeta() {
    try {
      await patch.mutateAsync({ id, name: name.trim(), thesis });
      setEditing(false);
    } catch {
      /* shown below */
    }
  }

  async function onDelete() {
    const n = analysed.length;
    if (!window.confirm(
      `Delete the report "${rep?.name ?? id}"${n ? ` and its ${n} DD${n === 1 ? '' : 's'}` : ''}? ` +
      'This removes reports/' + id + '/ from the research folder and cannot be undone.',
    )) return;
    try {
      await del.mutateAsync(id);
      router.push('/research/reports');
    } catch {
      /* shown below */
    }
  }

  function removeMember(m: ReportMember) {
    if (!window.confirm(`Remove ${m.ticker ?? m.permaticker} from this report?`)) return;
    patch.mutate({ id, remove: [String(m.permaticker)] });
  }

  const stockHref = (pt: string) => `/research/reports/${encodeURIComponent(id)}/stocks/${pt}`;

  return (
    <div className="bg-white min-h-[calc(100vh-4rem)] font-sans">
      <ResearchAreaNav />
      <div className="max-w-[1300px] mx-auto px-6 max-md:px-4 py-8 space-y-6">
        <Link href="/research/reports" className="text-xs text-ink-muted hover:text-green no-underline">← All reports</Link>

        {isLoading && <p className="text-sm text-ink-muted">Loading report…</p>}
        {isError && (
          <ErrorPanel title={isNotFound(error) ? `No report called “${id}”.` : 'Could not load this report.'}>
            <p className="m-0">
              {isNotFound(error)
                ? 'It may have been deleted (reports are folders under reports/ in the research folder).'
                : errDetail(error, 'The research API did not answer. Check that the backend is running.')}
            </p>
          </ErrorPanel>
        )}

        {rep && (
          <>
            {/* ---- Header ---- */}
            <div className="space-y-2">
              {editing ? (
                <div className="space-y-2 max-w-3xl">
                  <input value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} w-full text-lg font-semibold`} />
                  <textarea value={thesis} onChange={(e) => setThesis(e.target.value)} rows={3}
                            placeholder="What is this run testing?" className={`${inputCls} w-full`} />
                  <div className="flex gap-2">
                    <button type="button" className={btnPrimary} disabled={patch.isPending} onClick={saveMeta}>
                      {patch.isPending ? 'Saving…' : 'Save'}
                    </button>
                    <button type="button" className={btnGhost} onClick={() => setEditing(false)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <h1 className="text-[1.75rem] font-bold tracking-tight text-ink m-0 flex items-center gap-3 flex-wrap">
                      {rep.name}
                      <ReportStatusBadge status={rep.status} />
                    </h1>
                    <p className="text-sm text-ink-light mt-1 mb-0 whitespace-pre-line">
                      {rep.thesis || <span className="text-ink-muted">No thesis.</span>}
                    </p>
                    <p className="text-xs text-ink-muted mt-2 mb-0 flex items-center gap-2 flex-wrap">
                      <span>Created {fmtWhen(rep.created_at, true)} by</span>
                      <AddedByBadge by={rep.created_by} />
                      <span>·</span>
                      <ReportSourceLine source={rep.source} />
                      <span>· <code className="font-mono">reports/{rep.id}/</code></span>
                    </p>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button type="button" className={btnGhost} onClick={() => setEditing(true)} disabled={!!rep.error}>
                      Edit name &amp; thesis
                    </button>
                    <button
                      type="button"
                      className={btnGhost}
                      disabled={patch.isPending || !!rep.error}
                      onClick={() => patch.mutate({ id, status: rep.status === 'complete' ? 'open' : 'complete' })}
                    >
                      {rep.status === 'complete' ? 'Reopen' : 'Mark complete'}
                    </button>
                    <button type="button" className={btnDanger} onClick={onDelete} disabled={del.isPending}>
                      {del.isPending ? 'Deleting…' : 'Delete report'}
                    </button>
                  </div>
                </div>
              )}
              {rep.error && (
                <InlineError>
                  The report file is unreadable ({rep.error}). Fix <code className="font-mono">reports/{rep.id}/report.json</code> by
                  hand before editing it here.
                </InlineError>
              )}
              {patch.isError && <InlineError>{errDetail(patch.error, 'Could not update the report.')}</InlineError>}
              {del.isError && <InlineError>{errDetail(del.error, 'Could not delete the report.')}</InlineError>}
            </div>

            {/* ---- Ranking ---- */}
            <SectionCard
              title={`Ranking — ${analysed.length} of ${members.length} analysed`}
              actions={
                <AddToGroup
                  disabled={!pickedMembers.length}
                  label={pickedMembers.length ? `Add ${pickedMembers.length} to group` : 'Add selected to group'}
                  members={pickedMembers.map((m) => ({ permaticker: String(m.permaticker), ticker: m.ticker, name: m.name }))}
                  onDone={() => setSelected(new Set())}
                />
              }
            >
              {rep.prices_error && (
                <p className="px-5 pt-3 m-0 text-xs text-ink-muted">Today&apos;s prices are unavailable ({rep.prices_error}).</p>
              )}
              <div className={tableStyles.container}>
                <table className={tableStyles.table}>
                  <thead>
                    <tr>
                      <th className={`${tableStyles.th} w-8`}></th>
                      <th className={tableStyles.thNum}>#</th>
                      <th className={tableStyles.th}>Ticker</th>
                      <th className={tableStyles.th}>Rating</th>
                      <th className={tableStyles.th}>Confidence</th>
                      <th className={tableStyles.thNum}>Base upside</th>
                      <th className={tableStyles.thNum}>Price then → now</th>
                      <th className={tableStyles.th}>Red team</th>
                      <th className={tableStyles.th}>Groups</th>
                      <th className={tableStyles.th}>As of</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysed.length === 0 && (
                      <tr>
                        <td colSpan={10} className="px-3 py-6 text-center text-sm text-ink-faint">
                          Nothing analysed yet — ask Claude to complete this report (below).
                        </td>
                      </tr>
                    )}
                    {analysed.map((m, i) => {
                      const pt = String(m.permaticker);
                      const a = m.analysis!;
                      const up = toNum(a.rating?.upside_base_pct);
                      return (
                        <tr key={pt} className={`${tableStyles.row} ${selected.has(pt) ? '!bg-green-soft' : ''}`}
                            title={a.rating?.one_liner ?? undefined}>
                          <td className={tableStyles.td}>
                            <input type="checkbox" checked={selected.has(pt)} onChange={() => toggle(pt)}
                                   aria-label={`Select ${m.ticker ?? pt}`} />
                          </td>
                          <td className={`${tableStyles.tdNum} text-ink-muted`}>{i + 1}</td>
                          <td className={`${tableStyles.td} font-mono font-semibold`}>
                            <Link href={stockHref(pt)} className="text-ink no-underline hover:text-green">
                              {m.ticker || `#${pt}`}
                            </Link>
                            {m.name && <div className="font-sans font-normal text-xs text-ink-muted max-w-[200px] truncate">{m.name}</div>}
                            {m.listed === false && <div className="font-sans font-normal text-[10px] text-ink-muted">not in members list</div>}
                          </td>
                          <td className={tableStyles.td}><RatingPill rating={a.rating} size="sm" /></td>
                          <td className={`${tableStyles.td} text-ink-light`}>{a.rating?.confidence || '—'}</td>
                          <td className={`${tableStyles.tdNum} ${up == null ? '' : up >= 0 ? 'text-pos' : 'text-neg'}`}>
                            {fmtSignedPct(up)}
                          </td>
                          <td className={tableStyles.tdNum}>
                            <PriceThenNow then={a.price_at_analysis} now={m.price_now} nowDate={m.price_date} />
                          </td>
                          <td className={tableStyles.td}>
                            {a.has_redteam ? (
                              <Link href={`${stockHref(pt)}?tab=redteam`} className="text-xs font-semibold text-red no-underline">RT</Link>
                            ) : <span className="text-xs text-ink-muted">—</span>}
                          </td>
                          <td className={tableStyles.td}><GroupChips groups={m.groups} max={2} /></td>
                          <td className={`${tableStyles.td} text-xs tabular-nums`}>{fmtWhen(a.asof)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </SectionCard>

            {/* ---- Not yet analysed + Expand ---- */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <SectionCard title={`Not yet analysed (${pending.length})`}>
                {pending.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-ink-muted m-0">
                    {members.length ? 'Every member has a DD.' : 'No members yet — expand the report.'}
                  </p>
                ) : (
                  <ul className="list-none m-0 p-0 divide-y divide-rule-light max-h-[420px] overflow-y-auto">
                    {pending.map((m) => {
                      const pt = String(m.permaticker);
                      const a = m.analysis;
                      return (
                        <li key={pt} className="px-5 py-2 flex items-center gap-3">
                          <input type="checkbox" checked={selected.has(pt)} onChange={() => toggle(pt)}
                                 aria-label={`Select ${m.ticker ?? pt}`} />
                          <Link href={`/research/stocks/${pt}`} className="font-mono text-sm font-semibold text-ink no-underline hover:text-green w-16">
                            {m.ticker || `#${pt}`}
                          </Link>
                          <span className="text-xs text-ink-light truncate flex-1">{m.name || '—'}</span>
                          {a?.dd_error && <span className="text-[11px] text-neg" title={a.dd_error}>dd.json unreadable</span>}
                          {a?.has_redteam && <span className="text-[11px] text-ink-muted">red team only</span>}
                          {!a && (
                            <button type="button" onClick={() => removeMember(m)} disabled={patch.isPending}
                                    className="bg-transparent border-0 cursor-pointer text-xs text-ink-muted hover:text-neg">
                              remove
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </SectionCard>

              <SectionCard title="Expand">
                <div className="px-5 py-4 space-y-4">
                  {src?.kind === 'snapshot' && (
                    <div className="space-y-1.5">
                      <div className="text-sm text-ink-light">
                        {snap.isError ? 'The source snapshot could not be loaded.'
                          : snap.isLoading ? 'Checking the source snapshot…'
                          : remaining.length
                            ? <>The source snapshot has <strong className="text-ink">{remaining.length}</strong> kept member{remaining.length === 1 ? '' : 's'} not in this report.</>
                            : 'Every kept member of the source snapshot is already in this report.'}
                      </div>
                      <button type="button" className={btnGhost} disabled={!remaining.length || patch.isPending || !!rep.error}
                              onClick={() => patch.mutate({ id, add_from_source: true })}>
                        Add the rest of the snapshot{remaining.length ? ` (${remaining.length})` : ''}
                      </button>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <div className="text-sm text-ink-light">Add a stock by ticker or name:</div>
                    <StockSearch exclude={memberIds} onPick={(s) => patch.mutate({ id, add: [s] })} />
                  </div>
                  <p className="text-xs text-ink-muted m-0">
                    Analysed members cannot be removed here — an analysis is a record. Delete its files first if it was a mistake.
                  </p>
                </div>
              </SectionCard>
            </div>

            <ClaudeInstruction
              root={guide.data?.root}
              blurb="Claude writes each analysis inside this report's folder; nothing outside it changes."
              instruction={reportInstruction(rep.id)}
            />
          </>
        )}
      </div>
    </div>
  );
}
