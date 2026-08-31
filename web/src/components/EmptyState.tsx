import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons';

interface EmptyStateProps {
  icon?: ReactNode;
  iconName?: IconName;
  title?: string;
  description?: string;
  action?: ReactNode;
  /**
   * Variant styles:
   * - 'default': Full empty state with icon, title, description
   * - 'inline': Simple inline text for charts/tables
   */
  variant?: 'default' | 'inline';
  /** Simple message for inline variant */
  message?: string;
  className?: string;
}

export function EmptyState({
  icon,
  iconName,
  title,
  description,
  action,
  variant = 'default',
  message = 'No data available',
  className = '',
}: EmptyStateProps) {
  // Inline variant - simple centered text
  if (variant === 'inline') {
    return (
      <div className={`h-full flex items-center justify-center text-ink-muted ${className}`}>
        <span className="text-sm">{message}</span>
      </div>
    );
  }

  // Default variant - full empty state
  const renderIcon = () => {
    if (iconName) {
      return <Icon name={iconName} className="h-8 w-8 text-ink-muted" />;
    }
    if (icon) {
      return icon;
    }
    return <Icon name="folder" className="h-8 w-8 text-ink-muted" />;
  };

  return (
    <div className={`text-center py-12 px-6 ${className}`}>
      <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center mx-auto mb-4">
        {renderIcon()}
      </div>
      {title && <h3 className="text-lg font-semibold text-ink mb-2">{title}</h3>}
      {description && <p className="text-ink-muted mb-6">{description}</p>}
      {action}
    </div>
  );
}
