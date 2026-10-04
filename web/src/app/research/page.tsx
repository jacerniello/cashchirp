'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { TableStates } from '@/components/TableStates';
import {
  ClaudeInstruction,
  ErrorPanel,
  fmtWhen,
  PageHeader,
  RatingPill,
  SectionCard,
} from '@/components/research/ResearchBits';
import { NewReportForm, ReportSourceLine, ReportStatusBadge } from '@/components/research/Reports';
import { useReports, useResearchGuide } from '@/hooks/useResearch';
import { tableStyles } from '@/lib/styles';

// The Research area's front page: every report — each one an analysis run built at a
// particular time, with its own ranking — newest first. Reports are how stocks are organised;
// a stock's rating over time lives on its research page (its analysis history).

export default function ReportsPage() {
  const router = useRouter();
  const { data, isLoading, isError } = useReports();
  const guide = useResearchGuide();
  const reports = data ?? [];

  return (
    <div className="bg-white min-h-[calc(100vh-4rem)] font-sans">
      <PageHeader title="Reports">
        A report is one analysis run: a set of stocks — usually a snapshot — each with a DD (and
        maybe a red team) written as of that day, ranked against each other. Reports are how your
        research is organised, and a record: re-analysing later means a new report.
      </PageHeader>

      <div className="max-w-[1200px] mx-auto px-6 max-md:px-4 py-8 space-y-6">
        <SectionCard title="New report">
          <NewReportForm />
        </SectionCard>

        {isError ? (
          <ErrorPanel title="Could not load reports.">
            <p className="m-0">
              The research API did not answer. Check that the backend is running and that its
              research folder (<code className="font-mono">RESEARCH_DIR</code>) is readable.
            </p>
          </ErrorPanel>
        ) : (
          <SectionCard title={`Reports${data ? ` (${reports.length})` : ''}`}>
            <div className={tableStyles.container}>
              <table className={tableStyles.table}>
                <thead>
                  <tr>
                    <th className={tableStyles.th}>Report</th>
                    <th className={tableStyles.th}>Created</th>
                    <th className={tableStyles.th}>Source</th>
                    <th className={tableStyles.th}>Status</th>
                    <th className={tableStyles.thNum}>Analysed</th>
                    <th className={tableStyles.th}>Top names</th>
                  </tr>
                </thead>
                <tbody>
                  <TableStates loading={isLoading} empty={!!data && reports.length === 0} colSpan={6} rows={4}
                               emptyText="No reports yet. Start one above, or from a snapshot." />
                  {reports.map((r) => (
                    <tr key={r.id} onClick={() => router.push(`/research/reports/${encodeURIComponent(r.id)}`)}
                        className={`${tableStyles.row} cursor-pointer`}>
                      <td className={`${tableStyles.td} max-w-[320px]`}>
                        <Link href={`/research/reports/${encodeURIComponent(r.id)}`} onClick={(e) => e.stopPropagation()}
                              className="text-ink font-semibold no-underline hover:text-green">
                          {r.name}
                        </Link>
                        {r.error && <span className="ml-2 text-[11px] text-neg">unreadable report.json</span>}
                        {r.thesis && <div className="text-xs text-ink-muted truncate" title={r.thesis}>{r.thesis}</div>}
                      </td>
                      <td className={`${tableStyles.td} text-xs tabular-nums`}>{fmtWhen(r.created_at)}</td>
                      <td className={`${tableStyles.td} text-xs text-ink-light`} onClick={(e) => e.stopPropagation()}>
                        <ReportSourceLine source={r.source} />
                      </td>
                      <td className={tableStyles.td}><ReportStatusBadge status={r.status} /></td>
                      <td className={`${tableStyles.tdNum} text-xs`}>
                        {r.analysed_count ?? 0}/{r.member_count ?? 0}
                        {(r.redteam_count ?? 0) > 0 && <div className="text-ink-muted">{r.redteam_count} red-teamed</div>}
                      </td>
                      <td className={tableStyles.td}>
                        <span className="inline-flex items-center gap-2 flex-wrap">
                          {(r.top ?? []).map((t) => (
                            <span key={t.permaticker} className="inline-flex items-center gap-1">
                              <RatingPill rating={t.rating} size="sm" showLabel={false} />
                              <span className="font-mono text-xs font-semibold">{t.ticker || `#${t.permaticker}`}</span>
                            </span>
                          ))}
                          {!(r.top ?? []).length && <span className="text-xs text-ink-muted">—</span>}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}

        <ClaudeInstruction
          root={guide.data?.root}
          blurb="Claude can also start a report itself: it writes reports/<id>/report.json and an analysis per member inside it."
          instruction={
            reports[0]
              ? `Complete report ${reports[0].id}: write a DD for every member without one, then red-team the ones rated 5–6.`
              : 'Start a report on snapshot <snapshot-id> and do a full DD on every kept member, then red-team the ones rated 5–6.'
          }
        />
      </div>
    </div>
  );
}
