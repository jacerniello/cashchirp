'use client';

import Link from 'next/link';
import { useScreens } from '@/hooks/useSavedScreens';
import { ScreenerAreaNav } from '@/components/nav/AreaSubNav';
import { Card, Spinner } from '../components/shared';

// The ideas index: one card per saved screen, each its own page.
//
// A screen is a hypothesis about what makes a good investment, so there is rarely only
// one worth holding — you keep several and compare what they surface. Each card carries
// its LIVE count, because a list of names with no sense of how many each finds is a list
// you have to click through one by one to compare.

export default function IdeasIndexPage() {
  const { data, isLoading, error } = useScreens();
  const screens = data?.screens ?? [];

  return (
    <div className="bg-white min-h-[calc(100vh-4rem)] font-sans">
      <ScreenerAreaNav />

      <div className="py-16 px-8 pb-12 text-center border-b border-rule">
        <h1 className="font-sans text-[2.5rem] font-bold tracking-tight text-ink mb-3">
          Ideas
        </h1>
        <p className="text-lg text-ink-light max-w-2xl mx-auto">
          Each saved screen, run live against the latest snapshot. Open one to see what it
          finds right now.
        </p>
        {data?.asof && (
          <p className="text-xs text-ink-muted mt-4">Numbers as of {data.asof}</p>
        )}
      </div>

      <div className="max-w-[1000px] mx-auto py-12 px-6 space-y-4">
        {isLoading && !data && <Spinner className="h-8 w-8 text-green" />}

        {error && (
          <Card>
            <div className="p-5 text-sm text-ink-light">
              Can&apos;t reach the API. Start the backend with{' '}
              <code className="font-mono">./dev.sh</code>.
            </div>
          </Card>
        )}

        {data && screens.length === 0 && (
          <Card>
            <div className="p-5">
              <div className="text-base font-semibold text-ink mb-1">No screens yet</div>
              <p className="text-sm text-ink-light">
                A screen is a filter you saved. Build one on the{' '}
                <Link href="/screener" className="text-green hover:text-green-dark no-underline">
                  screener
                </Link>{' '}
                and save it — it lands in <code className="font-mono">config/screens/</code>,
                where the CLI reads the same file.
              </p>
            </div>
          </Card>
        )}

        {screens.map((s) => (
          <Link
            key={s.id}
            href={`/screener/ideas/${encodeURIComponent(s.id)}`}
            className="group block no-underline bg-white rounded-xl border border-rule
                       shadow-sm p-5 transition-colors hover:border-green"
          >
            <div className="flex items-baseline justify-between gap-4 flex-wrap">
              <span className="text-base font-semibold text-ink group-hover:text-green
                               transition-colors">
                {s.title}
                {s.id === data?.active && (
                  <span className="ml-2 text-[0.7rem] font-normal rounded bg-green-soft
                                   text-green-text px-1.5 py-0.5 align-middle">
                    active
                  </span>
                )}
              </span>
              {/* A broken spec must say so rather than silently reading as "0 names". */}
              {s.error ? (
                <span className="text-sm text-neg">unreadable</span>
              ) : (
                <span className="text-sm text-ink-light tnum whitespace-nowrap">
                  <strong>{s.count ?? '—'}</strong> name{s.count === 1 ? '' : 's'}
                </span>
              )}
            </div>

            {s.description && (
              <p className="mt-1.5 text-sm text-ink-light leading-relaxed">{s.description}</p>
            )}
            {s.error && (
              <p className="mt-1.5 text-sm text-neg">{s.error}</p>
            )}

            {!!s.criteria?.length && (
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {s.criteria.slice(0, 3).map((c) => (
                  <li key={c} className="text-xs text-ink-faint bg-surface rounded px-2 py-1">
                    {c}
                  </li>
                ))}
                {s.criteria.length > 3 && (
                  <li className="text-xs text-ink-muted px-1 py-1">
                    +{s.criteria.length - 3} more
                  </li>
                )}
              </ul>
            )}

            <p className="mt-3 text-xs text-green">Open →</p>
          </Link>
        ))}

        {screens.length > 0 && (
          <p className="text-xs text-ink-faint pt-2">
            Screens live in <code className="font-mono">config/screens/</code>. The{' '}
            <strong>active</strong> one is what the CLI uses by default —
            set it with <code className="font-mono">ACTIVE_SCREEN</code> in{' '}
            <code className="font-mono">core/.env</code>.
          </p>
        )}
      </div>
    </div>
  );
}
