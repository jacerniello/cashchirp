'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ResearchAreaNav } from '../../ResearchAreaNav';
import { DDReportView } from '@/components/dd/DDReportView';
import { DDRedTeamMarkdown } from '@/components/dd/DDRedTeam';
import { MarkdownEditor } from '@/components/research/MarkdownEditor';
import { AddToGroup } from '@/components/research/Pickers';
import {
  ClaudeInstruction,
  ErrorPanel,
  fmtWhen,
  InlineError,
} from '@/components/research/ResearchBits';
import { RatingSummary, useStockIdentity } from '@/components/research/StockResearch';
import {
  errDetail,
  useDeleteStockDoc,
  usePatchGroup,
  useResearchGuide,
  useResearchStock,
  useSaveStockDoc,
} from '@/hooks/useResearch';
import { segItem } from '@/lib/styles';

const TABS = [
  { key: 'notes', label: 'Notes' },
  { key: 'dd', label: 'DD' },
  { key: 'redteam', label: 'Red team' },
  { key: 'groups', label: 'Groups' },
  { key: 'snapshots', label: 'Snapshots' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export default function StockResearchPage() {
  const params = useParams<{ permaticker: string }>();
  const pt = decodeURIComponent(params.permaticker ?? '');
  const stock = useResearchStock(pt);
  const guide = useResearchGuide();
  const { ticker, name } = useStockIdentity(pt, stock.data, stock.isError);
  const save = useSaveStockDoc(pt);
  const del = useDeleteStockDoc(pt);
  const patchGroup = usePatchGroup();
  const [tab, setTab] = useState<TabKey | null>(null);

  // ?tab= deep-links a section (the company page links straight to notes).
  useEffect(() => {
    const t = new URL(window.location.href).searchParams.get('tab');
    if (t && TABS.some((x) => x.key === t)) setTab(t as TabKey);
  }, []);

  const d = stock.data;
  const active: TabKey = tab ?? (d?.dd ? 'dd' : 'notes');
  const label = ticker || `#${pt}`;
  const root = guide.data?.root;

  function choose(k: TabKey) {
    setTab(k);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', k);
    window.history.replaceState(null, '', url.toString());
  }

  const ddInstruction =
    `Do a full DD on ${ticker ?? '<TICKER>'} (permaticker ${pt}) following the DD standard, ` +
    `and write it to stocks/${pt}/dd.json.`;
  const rtInstruction =
    `Red-team the DD for ${ticker ?? '<TICKER>'} (permaticker ${pt}): try to disprove the bull thesis, ` +
    `and write the memo to stocks/${pt}/redteam.md with a SURVIVES / CONDITIONAL / FAILS verdict.`;

  return (
    <div className="bg-surface min-h-[calc(100vh-4rem)] font-sans">
      <ResearchAreaNav />
      <div className="bg-white border-b border-rule">
        <div className="max-w-[1100px] mx-auto px-6 max-md:px-4 pt-6 pb-2">
          <Link href="/research" className="text-xs text-ink-muted hover:text-green no-underline">← Rankings</Link>
          <div className="flex items-baseline gap-3 flex-wrap mt-2">
            <h1 className="text-2xl font-bold text-ink tracking-tight m-0 font-mono">{label}</h1>
            {name && <span className="text-ink-light text-base">{name}</span>}
            <Link href={`/company/${pt}`} className="text-xs font-semibold text-green hover:text-green-dark no-underline">
              Company page ↗
            </Link>
          </div>
          {d && (
            <ul className="flex gap-1 overflow-x-auto list-none m-0 p-0 pt-4 pb-2">
              {TABS.map((t) => {
                const count =
                  t.key === 'groups' ? d.groups.length :
                  t.key === 'snapshots' ? d.snapshots.length : null;
                const has =
                  t.key === 'notes' ? !!d.notes : t.key === 'dd' ? !!d.dd : t.key === 'redteam' ? !!d.redteam : null;
                return (
                  <li key={t.key} className="flex-shrink-0">
                    <button type="button" onClick={() => choose(t.key)} className={segItem(active === t.key)}>
                      {t.label}
                      {count != null && count > 0 && <span className="ml-1 opacity-70">{count}</span>}
                      {has === false && <span className="ml-1 opacity-50">·</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="max-w-[1100px] mx-auto px-6 max-md:px-4 py-6 space-y-5">
        {stock.isLoading && <p className="text-sm text-ink-muted">Loading research…</p>}
        {stock.isError && (
          <ErrorPanel title={`Could not load research for ${label}.`}>
            <p className="m-0">{errDetail(stock.error, 'The research API did not answer. Check that the backend is running.')}</p>
          </ErrorPanel>
        )}

        {d && d.dd && active !== 'dd' && (
          <RatingSummary dd={d.dd} redteam={d.redteam} updated={d.dd_updated} />
        )}

        {d && active === 'notes' && (
          <div className="rounded-xl border border-rule bg-white p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-ink m-0">Notes</h2>
              {d.notes_updated && <span className="text-xs text-ink-muted">updated {fmtWhen(d.notes_updated, true)}</span>}
            </div>
            <MarkdownEditor
              value={d.notes}
              saving={save.isPending}
              error={save.isError ? errDetail(save.error, 'Could not save.') : del.isError ? errDetail(del.error) : null}
              emptyText="No notes on this stock yet. Notes are yours — Claude reads them but writes its work to the DD."
              startLabel="Start notes"
              placeholder={`# ${label}\n\n## Why I'm looking\n\n## What would change my mind\n`}
              onSave={(text) => save.mutateAsync({ doc: 'notes', content: text, ticker, name })}
              onDelete={() => del.mutateAsync('notes')}
            />
            <p className="text-xs text-ink-muted mt-4 mb-0">
              Saved to <code className="font-mono">stocks/{pt}/notes.md</code> in the research folder.
            </p>
          </div>
        )}

        {d && active === 'dd' && (
          d.dd ? (
            <>
              <DDReportView report={d.dd} />
              <p className="text-xs text-ink-muted m-0">
                From <code className="font-mono">stocks/{pt}/dd.json</code>
                {d.dd_updated && <> · updated {fmtWhen(d.dd_updated, true)}</>}
              </p>
            </>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-rule bg-white p-5 text-sm text-ink-light">
                {d.dd_error ? (
                  <>
                    <p className="font-semibold text-ink m-0 mb-1">The DD file is unreadable.</p>
                    <p className="m-0">
                      <code className="font-mono">stocks/{pt}/dd.json</code>: {d.dd_error}. Fix the JSON by hand or ask
                      Claude to rewrite it.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold text-ink m-0 mb-1">No due diligence on {label} yet.</p>
                    <p className="m-0">DD reports are written by Claude into the research folder. Ask it:</p>
                  </>
                )}
              </div>
              <ClaudeInstruction root={root} instruction={ddInstruction} />
            </div>
          )
        )}

        {d && active === 'redteam' && (
          d.redteam ? (
            <div className="rounded-xl border border-rule border-l-4 border-l-red bg-white p-5">
              <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                <h2 className="text-lg font-bold text-ink m-0">Red team</h2>
                {d.redteam_updated && <span className="text-xs text-ink-muted">updated {fmtWhen(d.redteam_updated, true)}</span>}
              </div>
              <p className="text-xs text-ink-muted mb-4">
                An adversarial pass whose only job was to disprove the bull thesis.
              </p>
              <DDRedTeamMarkdown markdown={d.redteam} />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-rule bg-white p-5 text-sm text-ink-light">
                <p className="font-semibold text-ink m-0 mb-1">No red team on {label} yet.</p>
                <p className="m-0">
                  A red team tries to kill the thesis{d.dd ? '' : ' — it needs a DD to attack first'}. Ask Claude:
                </p>
              </div>
              <ClaudeInstruction root={root} instruction={d.dd ? rtInstruction : ddInstruction + ' Then ' + rtInstruction.charAt(0).toLowerCase() + rtInstruction.slice(1)} />
            </div>
          )
        )}

        {d && active === 'groups' && (
          <div className="rounded-xl border border-rule bg-white p-5 space-y-4">
            <h2 className="text-lg font-bold text-ink m-0">Groups</h2>
            {d.groups.length ? (
              <div className="flex flex-wrap gap-2">
                {d.groups.map((g) => (
                  <span key={g.id} className="inline-flex items-center gap-1 rounded-md bg-surface pl-2 pr-1 py-1 text-sm">
                    <Link href={`/research/groups/${encodeURIComponent(g.id)}`} className="text-ink no-underline hover:text-green">
                      {g.name}
                    </Link>
                    <button
                      type="button"
                      title={`Remove ${label} from ${g.name}`}
                      disabled={patchGroup.isPending}
                      onClick={() => patchGroup.mutate({ id: g.id, remove: [pt] })}
                      className="bg-transparent border-0 cursor-pointer text-ink-muted hover:text-neg px-1"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-muted m-0">Not in any group yet.</p>
            )}
            {patchGroup.isError && <InlineError>{errDetail(patchGroup.error)}</InlineError>}
            <AddToGroup
              members={[{ permaticker: pt, ticker, name }]}
              exclude={new Set(d.groups.map((g) => g.id))}
            />
          </div>
        )}

        {d && active === 'snapshots' && (
          <div className="rounded-xl border border-rule bg-white p-5">
            <h2 className="text-lg font-bold text-ink m-0 mb-3">Snapshots containing {label}</h2>
            {d.snapshots.length ? (
              <ul className="list-none m-0 p-0 divide-y divide-rule-light">
                {d.snapshots.map((s) => (
                  <li key={s.id} className="py-2 flex items-center justify-between gap-3">
                    <Link href={`/screener/snapshots/${encodeURIComponent(s.id)}`} className="text-sm text-ink no-underline hover:text-green">
                      {s.name}
                    </Link>
                    <span className="text-xs text-ink-muted tabular-nums">{fmtWhen(s.created_at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted m-0">
                Not in any snapshot. Snapshots are made from the <Link href="/screener" className="text-green">screener</Link>.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
