import type { ReactNode } from 'react';
import { cardStyles, textStyles, cn } from '../lib/styles';

interface CardProps {
  children: ReactNode;
  className?: string;
  variant?: 'base' | 'interactive' | 'compact' | 'stat';
}

export function Card({ children, className = '', variant = 'base' }: CardProps) {
  return (
    <div className={cn(cardStyles[variant], className)}>
      {children}
    </div>
  );
}

interface CardHeaderProps {
  title?: string;
  count?: number;
  actions?: ReactNode;
  children?: ReactNode;
}
