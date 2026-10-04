'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ResearchAreaNav } from '../../../../ResearchAreaNav';
import { DDReportView } from '@/components/dd/DDReportView';
import { DDRedTeamMarkdown } from '@/components/dd/DDRedTeam';
import { ClaudeInstruction, ErrorPanel, fmtWhen } from '@/components/research/ResearchBits';
import { RatingSummary } from '@/components/research/StockResearch';
import { errDetail, isNotFound, useReport, useReportDoc, useResearchGuide } from '@/hooks/useResearch';
import { segItem } from '@/lib/styles';

// One stock's analysis inside one report: the DD and red team as written for that run.
// It is a record — the stock's research page shows the latest analysis across reports.

export default function ReportStockPage() {
  const params = useParams<{ id: string; permaticker: string }>();
  const id = decodeURIComponent(params.id ?? '');
  const pt = decodeURIComponent(params.permaticker ?? '');
  const rep = useReport(id);
  const dd = useReportDoc(id, pt, 'dd');
  const rt = useReportDoc(id, pt, 'redteam');
  const guide = useResearchGuide();
  const [tab, setTab] = useState<'dd' | 'redteam'>('dd');

  useEffect(() => {
    if (new URL(window.location.href).searchParams.get('tab') === 'redteam') setTab('redteam');
  }, []);

  const member = rep.data?.members.find((m) => String(m.permaticker) === pt);
  const ddObj = dd.data?.content && typeof dd.data.content === 'object' ? (dd.data.content as Record<string, unknown>) : null;
  const rtText = typeof rt.data?.content === 'string' ? rt.data.content : null;
  const ticker = member?.ticker || (typeof ddObj?.ticker === 'string' ? ddObj.ticker : null);
  const name = member?.name || (typeof ddObj?.company === 'string' ? ddObj.company : null);
  const label = ticker || `#${pt}`;
  const asof = member?.analysis?.asof || (typeof ddObj?.asof === 'string' ? ddObj.asof : null);
  const ddMissing = dd.isError && isNotFound(dd.error);
  const rtMissing = rt.isError && isNotFound(rt.error);

  return (
    <div className="bg-surface min-h-[calc(100vh-4rem)] font-sans">
      <ResearchAreaNav />
      <div className="bg-white border-b border-rule">
        <div className="max-w-[1100px] mx-auto px-6 max-md:px-4 pt-6 pb-2">
          <Link href={`/research/reports/${encodeURIComponent(id)}`} className="text-xs text-ink-muted hover:text-green no-underline">
            ← {rep.data?.name ?? id}
          </Link>
          <div className="flex items-baseline gap-3 flex-wrap mt-2">
            <h1 className="text-2xl font-bold text-ink tracking-tight m-0 font-mono">{label}</h1>
            {name && <span className="text-ink-light text-base">{name}</span>}
            <Link href={`/research/stocks/${pt}`} className="text-xs font-semibold text-green hover:text-green-dark no-underline">
              Stock research ↗
            </Link>
            <Link href={`/company/${pt}`} className="text-xs font-semibold text-green hover:text-green-dark no-underline">
              Company page ↗
            </Link>
          </div>
          <p className="text-xs text-ink-muted mt-1 mb-0">
            Analysis as of <strong className="text-ink-light">{fmtWhen(asof)}</strong>, in report{' '}
            <strong className="text-ink-light">{rep.data?.name ?? id}</strong> (created {fmtWhen(rep.data?.created_at)}).
            Later analyses go in later reports; this one is not updated.
          </p>
          <ul className="flex gap-1 list-none m-0 p-0 pt-4 pb-2">
            <li><button type="button" onClick={() => setTab('dd')} className={segItem(tab === 'dd')}>DD</button></li>
            <li>
              <button type="button" onClick={() => setTab('redteam')} className={segItem(tab === 'redteam')}>
                Red team{rtMissing && <span className="ml-1 opacity-50">·</span>}
              </button>
            </li>
          </ul>
        </div>
      </div>

      <div className="max-w-[1100px] mx-auto px-6 max-md:px-4 py-6 space-y-5">
        {rep.isError && !isNotFound(rep.error) && (
          <ErrorPanel title="Could not load the report.">
            <p className="m-0">{errDetail(rep.error)}</p>
          </ErrorPanel>
        )}
        {rep.isError && isNotFound(rep.error) && <ErrorPanel title={`No report called “${id}”.`} />}

        {!(rep.isError && isNotFound(rep.error)) && tab === 'dd' && (
          dd.isLoading ? <p className="text-sm text-ink-muted">Loading DD…</p>
          : ddObj ? (
            <>
              <RatingSummary dd={ddObj} redteam={rtText} />
              <DDReportView report={ddObj} />
              <p className="text-xs text-ink-muted m-0">From <code className="font-mono">reports/{id}/stocks/{pt}/dd.json</code></p>
            </>
          ) : dd.data?.error ? (
            <ErrorPanel title="The DD file is unreadable.">
              <p className="m-0"><code className="font-mono">reports/{id}/stocks/{pt}/dd.json</code>: {dd.data.error}</p>
            </ErrorPanel>
          ) : ddMissing ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-rule bg-white p-5 text-sm text-ink-light">
                <p className="font-semibold text-ink m-0 mb-1">No DD on {label} in this report yet.</p>
              </div>
              <ClaudeInstruction root={guide.data?.root}
                instruction={`Write a DD for ${label} (permaticker ${pt}) in report ${id}, per _guide/DD_STANDARD.md, to reports/${id}/stocks/${pt}/dd.json.`} />
            </div>
          ) : dd.isError ? (
            <ErrorPanel title="Could not load the DD."><p className="m-0">{errDetail(dd.error)}</p></ErrorPanel>
          ) : null
        )}

        {!(rep.isError && isNotFound(rep.error)) && tab === 'redteam' && (
          rt.isLoading ? <p className="text-sm text-ink-muted">Loading red team…</p>
          : rtText ? (
            <div className="rounded-xl border border-rule border-l-4 border-l-red bg-white p-5">
              <h2 className="text-lg font-bold text-ink m-0 mb-1">Red team</h2>
              <p className="text-xs text-ink-muted mb-4">
                An adversarial pass on this report&apos;s DD · <code className="font-mono">reports/{id}/stocks/{pt}/redteam.md</code>
              </p>
              <DDRedTeamMarkdown markdown={rtText} />
            </div>
          ) : rtMissing ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-rule bg-white p-5 text-sm text-ink-light">
                <p className="font-semibold text-ink m-0 mb-1">No red team on {label} in this report.</p>
              </div>
              <ClaudeInstruction root={guide.data?.root}
                instruction={`Red-team the DD for ${label} in report ${id} (reports/${id}/stocks/${pt}/dd.json) per _guide/REDTEAM.md, and write reports/${id}/stocks/${pt}/redteam.md.`} />
            </div>
          ) : rt.isError ? (
            <ErrorPanel title="Could not load the red team."><p className="m-0">{errDetail(rt.error)}</p></ErrorPanel>
          ) : null
        )}
      </div>
    </div>
  );
}
