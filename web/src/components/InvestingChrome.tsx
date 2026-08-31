'use client';

// The ⌘K omni-search: a slim search bar rendered above every page (mounted by the layout,
// before the page content) plus the global keyboard shortcut. Both open the same
// SearchModal. It sits below the navbar rather than inside it so the bar stays a plain row
// of links. The per-page research sub-navs (Macro/DD areas) are unaffected — the pages
// still render <MacroAreaNav/> / <ScreenerAreaNav/>.
import { useState } from 'react';
import { SearchModal } from './SearchModal';
import { useKeyPress } from '../hooks/useCommon';

export function InvestingChrome() {
  const [searchOpen, setSearchOpen] = useState(false);

  useKeyPress('k', (e) => {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      setSearchOpen(true);
    }
  });

  return (
    <>
      <div className="border-b border-rule bg-white">
        <div className="max-w-[1400px] mx-auto px-6 py-3 flex justify-end">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Search stocks, funds, and holders"
            className="group flex w-full sm:w-80 items-center gap-2.5 rounded-lg border border-rule bg-white px-3.5 py-2 text-left text-ink-muted transition-colors hover:border-green focus:border-green focus:outline-none"
          >
            <svg className="h-4 w-4 shrink-0 opacity-70 group-hover:opacity-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <span className="flex-1 text-sm">Search stocks, funds…</span>
            <kbd className="hidden sm:inline-flex items-center rounded border border-rule px-1.5 py-0.5 text-[11px] font-medium text-ink-muted">⌘K</kbd>
          </button>
        </div>
      </div>
      <SearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
