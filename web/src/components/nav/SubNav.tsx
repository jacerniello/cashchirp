'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '../icons';

export interface SubNavItem {
  name: string;
  key: string;
  url?: string;
  external?: boolean;
  icon?: IconName;
}

export type SubNavVariant = 'cik' | 'fund' | 'tools' | 'account' | 'default';

interface SubNavProps {
  items: SubNavItem[];
  baseUrl: string;
  variant?: SubNavVariant;
  /** Key of the "home" item that should use `end` matching */
  homeKey?: string;
}

/**
 * Unified sub-navigation component for CIK, Fund, and Tools pages.
 *
 * Usage:
 * - CIK pages: <SubNav items={nav} baseUrl={`/cik/${cik}`} variant="cik" homeKey="summary" />
 * - Fund pages: <SubNav items={nav} baseUrl={`/fund/${seriesId}`} variant="fund" homeKey="summary" />
 * - Tools pages: <SubNav items={toolsNav} baseUrl="/tools" variant="tools" />
 */
export function SubNav({ items, baseUrl, variant = 'default', homeKey = 'summary' }: SubNavProps) {
  const pathname = usePathname();

  if (items.length === 0) return null;

  // Style variations
  const styles = {
    cik: {
      container: 'bg-white border-b border-rule sticky top-16 z-[100]',
      inner: 'max-w-[1200px] mx-auto px-8 max-[768px]:px-4',
      list: 'flex gap-2 max-[768px]:gap-0 overflow-x-auto scrollbar-hide list-none m-0 p-0',
      item: 'flex-shrink-0',
      linkBase: 'block font-sans font-semibold text-[0.9375rem] max-[768px]:text-sm py-[1.125rem] max-[768px]:py-4 px-4 max-[768px]:px-3.5 border-b-[3px] no-underline whitespace-nowrap transition-all duration-200 -mb-px',
      linkActive: 'text-ink border-green bg-transparent',
      linkInactive: 'text-ink-light border-transparent hover:text-ink hover:bg-surface-warm',
    },
    fund: {
      container: 'bg-white border-b border-rule sticky top-16 z-[100]',
      inner: 'max-w-[1200px] mx-auto px-8 max-[768px]:px-4',
      list: 'flex gap-2 max-[768px]:gap-0 overflow-x-auto scrollbar-hide list-none m-0 p-0',
      item: 'flex-shrink-0',
      linkBase: 'block font-sans font-semibold text-[0.9375rem] max-[768px]:text-sm py-[1.125rem] max-[768px]:py-4 px-4 max-[768px]:px-3.5 border-b-[3px] no-underline whitespace-nowrap transition-all duration-200 -mb-px',
      linkActive: 'text-ink border-green bg-transparent',
      linkInactive: 'text-ink-light border-transparent hover:text-ink hover:bg-surface-warm',
    },
    tools: {
      container: 'bg-white border-b border-rule sticky top-16 z-[100]',
      inner: 'max-w-[1200px] mx-auto',
      list: 'flex items-center gap-1 overflow-x-auto py-1 px-8 max-[768px]:px-4 scrollbar-hide',
      item: '',
      linkBase: 'font-sans text-sm font-medium no-underline py-3 px-4 whitespace-nowrap transition-colors duration-150 relative flex items-center gap-2',
      linkActive: 'text-green after:absolute after:bottom-0 after:left-4 after:right-4 after:h-0.5 after:bg-green after:rounded-full',
      linkInactive: 'text-ink-faint hover:text-ink',
    },
    account: {
      container: 'bg-white border-b border-rule sticky top-16 z-[100]',
      inner: 'max-w-[1200px] mx-auto px-8 max-[768px]:px-4',
      list: 'flex gap-2 max-[768px]:gap-0 overflow-x-auto scrollbar-hide list-none m-0 p-0',
      item: 'flex-shrink-0',
      linkBase: 'block font-sans font-semibold text-[0.9375rem] max-[768px]:text-sm py-[1.125rem] max-[768px]:py-4 px-4 max-[768px]:px-3.5 border-b-[3px] no-underline whitespace-nowrap transition-all duration-200 -mb-px',
      linkActive: 'text-ink border-green bg-transparent',
      linkInactive: 'text-ink-light border-transparent hover:text-ink hover:bg-surface-warm',
    },
    default: {
      container: 'bg-white border-b border-rule sticky top-16 z-[100]',
      inner: 'max-w-[1200px] mx-auto px-8 max-[768px]:px-4',
      list: 'flex gap-1 overflow-x-auto scrollbar-hide list-none m-0 p-0',
      item: 'flex-shrink-0',
      linkBase: 'block font-sans text-sm font-medium py-3 px-4 no-underline whitespace-nowrap transition-colors duration-150',
      linkActive: 'text-green border-b-2 border-green',
      linkInactive: 'text-ink-faint hover:text-ink',
    },
  };

  const style = styles[variant];

  // Check if a path is active
  const isActive = (href: string, isHome: boolean) => {
    if (isHome) {
      // For home/summary, exact match only
      return pathname === href;
    }
    // For other items, check if pathname starts with href
    return pathname === href || pathname.startsWith(href + '/');
  };

  return (
    <nav className={style.container}>
      <div className={style.inner}>
        <ul className={style.list}>
          {items.map((item) => {
            const isHome = item.key === homeKey;
            const href = item.url || (isHome ? baseUrl : `${baseUrl}/${item.key}`);
            const active = isActive(href, isHome);

            if (item.external && item.url) {
              return (
                <li key={item.key} className={style.item}>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${style.linkBase} ${style.linkInactive} flex items-center gap-1`}
                  >
                    {item.icon && <Icon name={item.icon} className="w-4 h-4" />}
                    {item.name}
                    <Icon name="external-link" className="w-3 h-3" />
                  </a>
                </li>
              );
            }

            return (
              <li key={item.key} className={style.item}>
                <Link
                  href={href}
                  prefetch={false}
                  className={`${style.linkBase} ${active ? style.linkActive : style.linkInactive}`}
                >
                  {item.icon && <Icon name={item.icon} className="w-4 h-4" />}
                  {item.name}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
