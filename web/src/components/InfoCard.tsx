import type { ReactNode } from 'react';

interface InfoCardProps {
  label: string;
  value: string | null | undefined;
  href?: string;
  mono?: boolean;
}

export function InfoCard({ label, value, href, mono }: InfoCardProps) {
  const content = (
    <div className={`
      bg-surface-warm border border-rule-light rounded-lg p-4
      transition-all duration-150
      ${href ? 'hover:border-green hover:bg-green-soft cursor-pointer' : ''}
    `}>
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-xs font-bold uppercase tracking-wider text-ink-light">
          {label}
        </span>
        {href && (
          <svg className="w-3 h-3 text-ink-light" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        )}
      </div>
      <p className={`text-sm font-medium text-ink overflow-x-auto ${mono ? 'font-mono' : ''}`}>
        {value || 'N/A'}
      </p>
    </div>
  );

  if (href && value) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="no-underline">
        {content}
      </a>
    );
  }

  return content;
}

interface InfoGridProps {
  children: ReactNode;
  cols?: 2 | 3 | 4;
}

export function InfoGrid({ children, cols = 2 }: InfoGridProps) {
  const colsClass = {
    2: 'grid-cols-2',
    3: 'grid-cols-3 max-md:grid-cols-1',
    4: 'grid-cols-4 max-md:grid-cols-2',
  };

  return (
    <div className={`grid ${colsClass[cols]} gap-3`}>
      {children}
    </div>
  );
}
