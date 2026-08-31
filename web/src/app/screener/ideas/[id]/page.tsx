'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Suspense } from 'react';
import { useIdeas } from '@/hooks/useIdeas';
import { LiveResults } from '../../components/LiveResults';
import { Card, Spinner } from '../../components/shared';
import { ScreenerAreaNav } from '@/components/nav/AreaSubNav';

// One saved screen (config/screens/<id>.yaml) run live on the snapshot. The title and
// description come from the screen spec, so this page describes whatever filter it is
// rather than naming one. Reuses the screener's LiveResults grid verbatim.
function IdeaDetail() {
  // One idea = one screen = one page, addressed by its own id. That makes it linkable,
  // bookmarkable, and reachable with the back button from the list.
  const params = useParams<{ id: string }>();
  const selected = decodeURIComponent(params.id);
  const { data, isLoading, error } = useIdeas(selected);
  // 404 from the API means the screen doesn't exist, which is a different problem from
  // the backend being down — and has a different fix.
  const notFound =
    (error as { response?: { status?: number } })?.response?.status === 404;

  return (
    <div className="bg-white min-h-[calc(100vh-200px)] font-sans">
      <ScreenerAreaNav />
      {/* Header */}
      <div className="py-16 px-8 pb-12 text-center border-b border-rule">
        <h1 className="font-sans text-[2.5rem] font-bold tracking-tight text-ink mb-3">
          {data?.screen?.title || 'Ideas'}
        </h1>
        <p className="text-lg text-ink-light max-w-2xl mx-auto">
          {data?.screen?.description
            || 'Everything your active screen surfaces, run live on the latest snapshot.'}
        </p>
        <p className="text-sm text-ink-muted max-w-2xl mx-auto mt-3">
          Candidates to research, not recommendations.
          {data?.screen?.id && (
            <>
              {' '}Screen{' '}
              <code className="font-mono text-[0.9em]">{data.screen.id}</code> — edit it in{' '}
              <code className="font-mono text-[0.9em]">config/screens/</code>.
            </>
          )}
        </p>
        <div className="mt-5">
          <Link href="/screener/ideas" className="text-sm font-medium text-green
                 hover:text-green-dark no-underline">
            ← All ideas
          </Link>
        </div>
        {data?.asof && (
          <p className="text-xs text-ink-muted mt-4">Numbers as of {data.asof}</p>
        )}
      </div>

      <div className="max-w-[1400px] mx-auto py-12 px-6 space-y-6">
        {/* How the list was built */}
        {data?.criteria && (
          <Card>
            <div className="p-5">
              <h2 className="text-sm font-semibold text-ink mb-3 uppercase tracking-wide">
                How this list was built
              </h2>
              <ul className="space-y-1.5">
                {data.criteria.map((c) => (
                  <li key={c} className="flex items-start gap-2 text-sm text-ink-light">
                    <span className="mt-0.5 text-green">•</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        )}

        {/* Results table — the screener grid, reused verbatim */}
        <div>
          <Card className="mb-4">
            <div className="flex items-center justify-between gap-4 p-4">
              <div className="text-sm text-ink-muted">
                <span className="font-semibold text-ink">{data?.total ?? 0}</span> survivors
              </div>
              <Link href="/screener" className="text-sm font-medium text-green hover:text-green-dark">
                Screen further →
              </Link>
            </div>
          </Card>

          <Card>
            {isLoading ? (
              <Spinner className="h-5 w-5 text-green" />
            ) : error ? (
              // A missing screen is not a transient failure — "try again" would be a lie.
              // Say which it is, and give the way back.
              <div className="py-10 px-5">
                <p className="text-base font-semibold text-ink mb-1">
                  {notFound ? `No screen called “${selected}”` : 'Could not load this idea'}
                </p>
                <p className="text-sm text-ink-light">
                  {notFound
                    ? 'It may have been renamed or deleted. Screens live in config/screens/.'
                    : 'The API did not answer. Check that the backend is running.'}
                </p>
                <Link href="/screener/ideas" className="inline-block mt-4 text-sm font-medium
                       text-green hover:text-green-dark no-underline">
                  ← All ideas
                </Link>
              </div>
            ) : (
              <LiveResults
                results={data?.results || []}
                page={1}
                totalPages={1}
                onPageChange={() => {}}
              />
            )}
          </Card>
        </div>

      </div>
    </div>
  );
}

export default function IdeaDetailPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-12"><Spinner className="h-8 w-8 text-green" /></div>}>
      <IdeaDetail />
    </Suspense>
  );
}
