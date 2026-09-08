'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BANNER } from '@/config/banner';

// next/link is for routes inside this app. Handing it an off-site URL still renders an
// anchor, but without `rel="noopener"` and without opening in a new tab — so a reader
// following the source link loses the page they were looking at. Off-site gets a plain
// anchor; in-app keeps the client-side navigation.
const isExternal = (href: string) => /^https?:\/\//.test(href);

// The site-wide banner. Text and behaviour come from src/config/banner.ts.
//
// Rendered under the navbar on every route. Dismissal is per-browser and keyed on the
// message id, so changing the text brings the banner back for someone who dismissed the
// previous one — otherwise a new warning would be invisible to exactly the people who
// have used the site before.

const TONES: Record<string, string> = {
  info: 'bg-green-soft text-green-text border-green/30',
  warn: 'bg-gold-soft text-ink border-gold/40',
  demo: 'bg-ink text-white/90 border-ink',
};

export function SiteBanner() {
  const [hidden, setHidden] = useState(false);

  // Read after mount: localStorage doesn't exist during SSR, and reading it in render
  // would make the server and client markup disagree.
  useEffect(() => {
    if (!BANNER.dismissible) return;
    try {
      setHidden(localStorage.getItem(`banner-dismissed:${BANNER.id}`) === '1');
    } catch {
      /* private mode / blocked storage — showing the banner is the safe default */
    }
  }, []);

  if (!BANNER.enabled || hidden) return null;

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(`banner-dismissed:${BANNER.id}`, '1');
    } catch {
      /* not being able to remember the dismissal is not worth an error */
    }
  };

  return (
    <div
      role="status"
      className={`border-b px-6 py-2.5 text-sm ${TONES[BANNER.tone] ?? TONES.info}`}
    >
      <div className="max-w-[1200px] mx-auto flex items-center justify-between gap-4">
        <span>
          {BANNER.text}
          {BANNER.link && (
            <>
              {' '}
              {isExternal(BANNER.link.href) ? (
                <a
                  href={BANNER.link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:no-underline font-medium"
                >
                  {BANNER.link.label}
                </a>
              ) : (
                <Link href={BANNER.link.href} className="underline hover:no-underline">
                  {BANNER.link.label}
                </Link>
              )}
            </>
          )}
        </span>
        {BANNER.dismissible && (
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="shrink-0 bg-transparent border-0 cursor-pointer opacity-70
                       hover:opacity-100 text-current text-lg leading-none"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
