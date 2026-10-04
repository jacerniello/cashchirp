'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ScreenerAreaNav } from '@/components/nav/AreaSubNav';
import { TableStates } from '@/components/TableStates';
import { AddedByBadge, ErrorPanel, fmtWhen, PageHeader, SectionCard } from '@/components/research/ResearchBits';
import { sourceLabel } from '@/components/research/SnapshotSource';
import { useSnapshots } from '@/hooks/useResearch';
import { tableStyles } from '@/lib/styles';

export default function SnapshotsPage() {
  const router = useRouter();
  const { data, isLoading, isError } = useSnapshots();
  const snaps = data ?? [];

  return (
    <div className="bg-white min-h-[calc(100vh-4rem)] font-sans">
      <ScreenerAreaNav />
      <PageHeader title="Snapshots">
        Screener results frozen at a moment, with the numbers as they were. Trim the ones you
        don&apos;t want, then start a report on the rest and hand it to Claude for due diligence.
      </PageHeader>

      <div className="max-w-[1100px] mx-auto px-6 max-md:px-4 py-8 space-y-6">
        {isError ? (
          <ErrorPanel title="Could not load snapshots." />
        ) : (
          <SectionCard title={`Snapshots${data ? ` (${snaps.length})` : ''}`}>
            <div className={tableStyles.container}>
              <table className={tableStyles.table}>
                <thead>
                  <tr>
                    <th className={tableStyles.th}>Name</th>
                    <th className={tableStyles.th}>Source</th>
                    <th className={tableStyles.th}>Data as of</th>
                    <th className={tableStyles.thNum}>Kept</th>
                    <th className={tableStyles.thNum}>Trimmed</th>
                    <th className={tableStyles.th}>By</th>
                    <th className={tableStyles.thNum}>Created</th>
                  </tr>
                </thead>
                <tbody>
                  <TableStates loading={isLoading} colSpan={7} rows={4} />
                  {snaps.map((s) => (
                    <tr key={s.id} className={`${tableStyles.row} cursor-pointer`}
                        onClick={() => router.push(`/screener/snapshots/${encodeURIComponent(s.id)}`)}>
                      <td className={`${tableStyles.td} font-semibold whitespace-normal`}>
                        <Link href={`/screener/snapshots/${encodeURIComponent(s.id)}`} onClick={(e) => e.stopPropagation()}
                              className="text-ink no-underline hover:text-green">
                          {s.name}
                        </Link>
                        {s.error && <span className="ml-2 text-[11px] text-neg" title={s.error}>unreadable file</span>}
                        {s.note && <div className="text-xs font-normal text-ink-muted truncate max-w-[360px]">{s.note}</div>}
                      </td>
                      <td className={`${tableStyles.td} text-ink-light`}>{sourceLabel(s.source)}</td>
                      <td className={`${tableStyles.td} tabular-nums text-ink-light`}>{fmtWhen(s.asof)}</td>
                      <td className={tableStyles.tdNum}>{s.count ?? '—'}</td>
                      <td className={tableStyles.tdNum}>{s.removed_count || '—'}</td>
                      <td className={tableStyles.td}><AddedByBadge by={s.created_by} /></td>
                      <td className={`${tableStyles.tdNum} text-xs`}>{fmtWhen(s.created_at, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data && snaps.length === 0 && (
              <div className="px-6 py-8 text-sm text-ink-light">
                <p className="font-semibold text-ink m-0 mb-1">No snapshots yet.</p>
                <p className="m-0">
                  On the <Link href="/screener" className="text-green">screener</Link>, set a filter and press{' '}
                  <em>Snapshot</em> — or open one of your{' '}
                  <Link href="/screener/ideas" className="text-green">saved screens</Link> and freeze it.
                </p>
              </div>
            )}
          </SectionCard>
        )}
      </div>
    </div>
  );
}
