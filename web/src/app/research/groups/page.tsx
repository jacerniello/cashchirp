'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ResearchAreaNav } from '../ResearchAreaNav';
import { TableStates } from '@/components/TableStates';
import {
  AddedByBadge,
  btnPrimary,
  ClaudeInstruction,
  ErrorPanel,
  fmtWhen,
  InlineError,
  inputCls,
  PageHeader,
  SectionCard,
} from '@/components/research/ResearchBits';
import { errDetail, useCreateGroup, useGroups, useResearchGuide } from '@/hooks/useResearch';
import { tableStyles } from '@/lib/styles';

export default function GroupsPage() {
  const router = useRouter();
  const { data, isLoading, isError } = useGroups();
  const guide = useResearchGuide();
  const create = useCreateGroup();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  async function onCreate() {
    try {
      const g = await create.mutateAsync({ name: name.trim(), description: description.trim() });
      setName('');
      setDescription('');
      router.push(`/research/groups/${encodeURIComponent(g.id)}`);
    } catch {
      /* shown below */
    }
  }

  const groups = data ?? [];

  return (
    <div className="bg-white min-h-[calc(100vh-4rem)] font-sans">
      <ResearchAreaNav />
      <PageHeader title="Groups">
        Named, editable sets of stocks — a theme, a catalyst type, a shortlist. You and Claude can
        both add and remove members; each member remembers who added it.
      </PageHeader>

      <div className="max-w-[1100px] mx-auto px-6 max-md:px-4 py-8 space-y-6">
        <SectionCard title="New group">
          <div className="px-5 py-4 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name — e.g. Asset plays"
                     className={`${inputCls} w-64`}
                     onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) void onCreate(); }} />
              <input value={description} onChange={(e) => setDescription(e.target.value)}
                     placeholder="What ties these together? (optional)" className={`${inputCls} flex-1 min-w-[240px]`} />
              <button type="button" className={btnPrimary} disabled={!name.trim() || create.isPending} onClick={onCreate}>
                {create.isPending ? 'Creating…' : 'Create group'}
              </button>
            </div>
            {create.isError && <InlineError>{errDetail(create.error, 'Could not create the group.')}</InlineError>}
          </div>
        </SectionCard>

        {isError ? (
          <ErrorPanel title="Could not load groups." />
        ) : (
          <SectionCard title={`Groups${data ? ` (${groups.length})` : ''}`}>
            <div className={tableStyles.container}>
              <table className={tableStyles.table}>
                <thead>
                  <tr>
                    <th className={tableStyles.th}>Name</th>
                    <th className={tableStyles.th}>Description</th>
                    <th className={tableStyles.thNum}>Members</th>
                    <th className={tableStyles.th}>Created by</th>
                    <th className={tableStyles.thNum}>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  <TableStates
                    loading={isLoading}
                    empty={!!data && groups.length === 0}
                    colSpan={5}
                    rows={4}
                    emptyText="No groups yet. Create one above, or add stocks to a new group from a snapshot or a stock's research page."
                  />
                  {groups.map((g) => (
                    <tr key={g.id} className={`${tableStyles.row} cursor-pointer`}
                        onClick={() => router.push(`/research/groups/${encodeURIComponent(g.id)}`)}>
                      <td className={`${tableStyles.td} font-semibold`}>
                        <Link href={`/research/groups/${encodeURIComponent(g.id)}`} onClick={(e) => e.stopPropagation()}
                              className="text-ink no-underline hover:text-green">
                          {g.name}
                        </Link>
                        {g.error && <span className="ml-2 text-[11px] text-neg" title={g.error}>unreadable file</span>}
                      </td>
                      <td className={`${tableStyles.td} text-ink-light whitespace-normal max-w-[420px]`}>
                        {g.description || <span className="text-ink-muted">—</span>}
                      </td>
                      <td className={tableStyles.tdNum}>{Array.isArray(g.members) ? g.members.length : 0}</td>
                      <td className={tableStyles.td}><AddedByBadge by={g.created_by} /></td>
                      <td className={`${tableStyles.tdNum} text-xs`}>{fmtWhen(g.updated_at ?? g.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}

        <ClaudeInstruction
          root={guide.data?.root}
          blurb="Claude can create and curate groups too — they are JSON files under groups/ in the research folder."
          instruction="Look through the DD reports rated 4–6 and sort them into groups by catalyst type (one groups/<id>.json each, added_by: ai), with a one-line note per member saying why it belongs."
        />
      </div>
    </div>
  );
}
