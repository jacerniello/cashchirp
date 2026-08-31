'use client';

export function EmptyState() {
  return (
    <div className="text-center py-12">
      <div className="w-16 h-16 mx-auto mb-4 bg-surface rounded-full flex items-center justify-center">
        <svg className="w-7 h-7 text-ink-faint" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-ink mb-2">No companies found</h3>
      <p className="text-sm text-ink-light">Try adjusting your filters</p>
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  // Compact, low-chrome pager to match the dense table: small bordered buttons, a thin
  // top rule, monospaced page counter.
  const btn = 'px-2.5 py-1 rounded-md border border-rule text-[12px] font-medium text-ink-light bg-white transition-colors hover:border-green hover:text-green disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-rule disabled:hover:text-ink-light';

  return (
    <div className="flex items-center justify-center gap-1.5 pt-3 border-t border-rule-light mt-3">
      <button onClick={() => onPageChange(1)} disabled={page <= 1} className={btn}>First</button>
      <button onClick={() => onPageChange(page - 1)} disabled={page <= 1} className={btn}>Prev</button>
      <span className="px-3 text-[12px] tabular-nums text-ink-muted">
        Page {page} of {totalPages}
      </span>
      <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} className={btn}>Next</button>
      <button onClick={() => onPageChange(totalPages)} disabled={page >= totalPages} className={btn}>Last</button>
    </div>
  );
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl border border-rule shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <div className="flex justify-center py-12">
      <svg className={`animate-spin ${className}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
    </div>
  );
}
