import type { ReactNode } from 'react';

export type BadgeVariant = 'green' | 'blue' | 'gray' | 'red' | 'orange' | 'purple' | 'yellow';

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  href?: string;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  green: 'bg-green-soft text-green-text',
  blue: 'bg-blue-soft text-blue-text',
  gray: 'bg-surface text-ink-faint',
  red: 'bg-red-soft text-red',
  orange: 'bg-orange-100 text-orange-700',
  purple: 'bg-purple-100 text-purple-700',
  yellow: 'bg-yellow-100 text-yellow-700',
};

export function Badge({ children, variant = 'gray', href, className: extraClassName }: BadgeProps) {
  const baseClassName = `
    inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-md
    ${variantStyles[variant]}
    ${href ? 'hover:opacity-80 transition-opacity' : ''}
    ${extraClassName || ''}
  `;

  if (href) {
    return (
      <a href={href} className={`${baseClassName} no-underline`}>
        {children}
      </a>
    );
  }

  return <span className={baseClassName}>{children}</span>;
}
