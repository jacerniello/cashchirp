'use client';

import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  useSearchStocks,
  useSearchFunds,
  useSearchEntities,
  type SearchType,
  type StockResult,
  type FundResult,
  type EntityResult,
} from '../hooks/useSearch';

// Constants
const DEBOUNCE_DELAY_MS = 300;

const SEARCH_FILTERS: { key: SearchType; label: string }[] = [
  { key: 'stock', label: 'Stocks' },
  { key: 'fund', label: 'Funds' },
];

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Shared result item component to eliminate render function duplication
interface SearchResultItemProps {
  isSelected: boolean;
  isNavigating?: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  badge?: string | null;
  badgeVariant?: 'default' | 'warning';
}

const SearchResultItem = memo(function SearchResultItem({
  isSelected,
  isNavigating,
  onClick,
  onMouseEnter,
  icon,
  title,
  subtitle,
  badge,
  badgeVariant = 'default',
  itemRef,
}: SearchResultItemProps & { itemRef?: React.RefObject<HTMLButtonElement | null>; isNavigating?: boolean }) {
  return (
    <button
      ref={itemRef}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      disabled={isNavigating}
      className={`w-full flex items-center gap-4 py-4 px-6 text-left border-b border-rule last:border-b-0 transition-colors duration-150 ${
        isNavigating ? 'bg-green-soft opacity-75' : isSelected ? 'bg-green-soft' : 'hover:bg-green-soft'
      }`}
    >
      {isNavigating ? (
        <div className="w-11 h-11 flex items-center justify-center shrink-0">
          <svg className="w-6 h-6 animate-spin text-green" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
      ) : icon}
      <div className="flex-1 min-w-0">
        <div className="font-sans text-[0.9375rem] font-semibold text-ink mb-1">{title}</div>
        <div className="font-sans text-sm text-ink-light whitespace-nowrap overflow-hidden text-ellipsis">{subtitle}</div>
      </div>
      {isNavigating ? (
        <div className="font-sans text-xs font-medium text-green">Opening...</div>
      ) : badge && (
        <div className={`font-sans text-xs font-semibold py-1.5 px-3 rounded-md shrink-0 ${
          badgeVariant === 'warning'
            ? 'text-amber-700 bg-amber-50 border border-amber-200'
            : 'text-ink-faint bg-surface border border-rule'
        }`}>
          {badge}
        </div>
      )}
    </button>
  );
});

// Icon component for stock/fund results
const TickerIcon = memo(function TickerIcon({ ticker, name }: { ticker: string; name?: string }) {
  // Use ticker if available, otherwise get initials from name
  const displayText = ticker
    ? ticker.slice(0, 2)
    : name
      ? name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
      : '??';
  return (
    <div className="w-11 h-11 flex items-center justify-center font-sans text-xs font-bold bg-surface border border-rule rounded-[10px] text-ink-mid shrink-0">
      {displayText}
    </div>
  );
});

// Icon component for entity results
const EntityIcon = memo(function EntityIcon({ isCIK }: { isCIK: boolean }) {
  return (
    <div
      className={`w-11 h-11 flex items-center justify-center font-sans text-xs font-bold rounded-[10px] shrink-0 ${
        isCIK
          ? 'text-green bg-green-soft border border-green'
          : 'bg-violet-100 border border-violet-300 text-violet-600'
      }`}
    >
      {isCIK ? 'CIK' : 'LEI'}
    </div>
  );
});

export const SearchModal = memo(function SearchModal({ isOpen, onClose }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<SearchType>('stock');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [navigatingIndex, setNavigatingIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedItemRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const initialPathnameRef = useRef(pathname);

  // Close modal when pathname changes (navigation completed)
  useEffect(() => {
    if (isOpen && navigatingIndex !== null && pathname !== initialPathnameRef.current) {
      onClose();
    }
  }, [pathname, isOpen, navigatingIndex, onClose]);

  // Track initial pathname when modal opens (only set once per open, not on every pathname change)
  useEffect(() => {
    if (isOpen) {
      initialPathnameRef.current = pathname;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, DEBOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // Use the appropriate search hook based on active filter (with debounced query)
  const stocksQuery = useSearchStocks(activeFilter === 'stock' ? debouncedQuery : '');
  const fundsQuery = useSearchFunds(activeFilter === 'fund' ? debouncedQuery : '');
  const entitiesQuery = useSearchEntities(activeFilter === 'entity' ? debouncedQuery : '');

  // Get current results based on active filter
  const getCurrentData = useCallback(() => {
    switch (activeFilter) {
      case 'stock':
        return stocksQuery;
      case 'fund':
        return fundsQuery;
      case 'entity':
        return entitiesQuery;
    }
  }, [activeFilter, stocksQuery, fundsQuery, entitiesQuery]);

  const { data, isLoading } = getCurrentData();
  const results = data?.results || [];

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setDebouncedQuery('');
      setSelectedIndex(0);
      setNavigatingIndex(null);
    }
  }, [isOpen]);

  // Reset selection when results or filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [results, activeFilter]);

  // Scroll selected item into view when navigating with keyboard
  useEffect(() => {
    if (selectedItemRef.current) {
      selectedItemRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex]);

  const handleSelect = useCallback(
    (result: StockResult | FundResult | EntityResult, index: number) => {
      // Show loading state on the selected result
      setNavigatingIndex(index);

      // Every result carries a precomputed permaticker deep-link (/company/<permaticker>)
      // from the API — already root-relative, so it is pushed as-is.
      if (result.url) {
        router.push(result.url);
      }
      // Don't close modal immediately - it will close when navigation completes
    },
    [router]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (results[selectedIndex] && navigatingIndex === null) {
            handleSelect(results[selectedIndex], selectedIndex);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 'Tab':
          e.preventDefault();
          const currentIndex = SEARCH_FILTERS.findIndex((f) => f.key === activeFilter);
          const nextIndex = e.shiftKey
            ? (currentIndex - 1 + SEARCH_FILTERS.length) % SEARCH_FILTERS.length
            : (currentIndex + 1) % SEARCH_FILTERS.length;
          setActiveFilter(SEARCH_FILTERS[nextIndex].key);
          break;
      }
    },
    [results, selectedIndex, navigatingIndex, handleSelect, onClose, activeFilter]
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  const renderResult = useCallback(
    (result: StockResult | FundResult | EntityResult, index: number) => {
      const isSelected = index === selectedIndex;
      const isNavigating = index === navigatingIndex;
      const onClick = () => navigatingIndex === null && handleSelect(result, index);
      const onMouseEnter = () => navigatingIndex === null && setSelectedIndex(index);

      if (activeFilter === 'stock') {
        const stockResult = result as StockResult;
        const ticker = (stockResult.ticker || '').toUpperCase();
        return (
          <SearchResultItem
            key={`stock-${ticker}-${index}`}
            isSelected={isSelected}
            isNavigating={isNavigating}
            onClick={onClick}
            onMouseEnter={onMouseEnter}
            icon={<TickerIcon ticker={ticker} name={stockResult.name} />}
            title={ticker}
            subtitle={stockResult.name || ''}
            badge={stockResult.exchange}
            itemRef={isSelected ? selectedItemRef : undefined}
          />
        );
      }

      if (activeFilter === 'fund') {
        const fundResult = result as FundResult;
        const ticker = (fundResult.ticker || '').toUpperCase();
        const badge = fundResult.price_only ? 'Price Only' : fundResult.exchange;
        return (
          <SearchResultItem
            key={`fund-${ticker}-${index}`}
            isSelected={isSelected}
            isNavigating={isNavigating}
            onClick={onClick}
            onMouseEnter={onMouseEnter}
            icon={<TickerIcon ticker={ticker} name={fundResult.name} />}
            title={ticker || fundResult.name || ''}
            subtitle={ticker ? (fundResult.name || '') : ''}
            badge={badge}
            badgeVariant={fundResult.price_only ? 'warning' : 'default'}
            itemRef={isSelected ? selectedItemRef : undefined}
          />
        );
      }

      // Entity result
      const entityResult = result as EntityResult;
      const isCIK = Boolean(entityResult.cik && !entityResult.is_lei);
      const name = entityResult.is_lei ? entityResult.entity_legal_name : entityResult.name;
      const id = entityResult.is_lei ? entityResult.lei : entityResult.cik;

      return (
        <SearchResultItem
          key={`entity-${id}-${index}`}
          isSelected={isSelected}
          isNavigating={isNavigating}
          onClick={onClick}
          onMouseEnter={onMouseEnter}
          icon={<EntityIcon isCIK={isCIK} />}
          title={name || ''}
          subtitle={id || ''}
          itemRef={isSelected ? selectedItemRef : undefined}
        />
      );
    },
    [activeFilter, selectedIndex, navigatingIndex, handleSelect]
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[300] pt-[8vh] px-4 pb-4 flex items-start justify-center"
      onClick={handleBackdropClick}
    >
      <div className="absolute inset-0 bg-ink/50 backdrop-blur-sm" onClick={onClose}></div>

      <div className="relative w-full max-w-[640px] bg-white rounded-xl border border-rule shadow-lg overflow-hidden animate-in">
        {/* Header */}
        <div className="p-5 px-6 border-b border-rule">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-ink-faint shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search"
              className="flex-1 font-sans text-[1.0625rem] font-medium text-ink border-none outline-none bg-transparent py-1 placeholder:text-ink-faint placeholder:font-normal"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
            />
            <span className="font-sans text-xs font-medium text-ink-faint bg-surface py-1 px-2 border border-rule rounded">ESC</span>
            <button
              onClick={onClose}
              className="bg-transparent border-none p-2 -mr-1 ml-1 cursor-pointer text-ink-faint rounded-md transition-all duration-150 hover:text-ink hover:bg-surface"
            >
              <svg className="w-[1.125rem] h-[1.125rem]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-2 py-4 px-6 border-b border-rule bg-surface">
          {SEARCH_FILTERS.map((filter) => (
            <button
              key={filter.key}
              onClick={() => setActiveFilter(filter.key)}
              className={`font-sans text-[0.9375rem] font-medium py-2.5 px-5 rounded-lg cursor-pointer transition-all duration-150 ${
                activeFilter === filter.key
                  ? 'bg-green text-white font-semibold border border-green'
                  : 'text-ink-light bg-white border border-rule hover:text-ink hover:border-ink-faint'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {/* Results Area */}
        <div className="max-h-[400px] overflow-y-auto">
          {/* Hint shown before a query is typed */}
          {query.length < 2 && (
            <div className="py-12 px-6 text-center font-sans text-sm text-ink-faint">
              Type at least 2 characters to search stocks and funds.
            </div>
          )}

          {/* Loading - show when typing or fetching */}
          {query.length >= 2 && (isLoading || query !== debouncedQuery) && (
            <div className="py-12 px-6 text-center">
              <div className="w-14 h-14 mx-auto mb-5 text-green">
                <svg className="w-full h-full animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
              <div className="font-sans text-lg font-medium text-ink-light">Searching...</div>
            </div>
          )}

          {/* No Results */}
          {debouncedQuery.length >= 2 && !isLoading && query === debouncedQuery && results.length === 0 && (
            <div className="py-16 px-6 text-center">
              <div className="w-16 h-16 mx-auto mb-4 bg-surface rounded-full flex items-center justify-center">
                <svg className="w-7 h-7 text-ink-faint" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="font-sans text-lg font-semibold text-ink mb-2">No results found</h3>
              <p className="font-sans text-sm text-ink-light">Try a different search term</p>
            </div>
          )}

          {/* Results */}
          {debouncedQuery.length >= 2 && !isLoading && query === debouncedQuery && results.length > 0 && (
            <div>
              {results.map((result, index) => renderResult(result, index))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between py-4 px-6 bg-surface border-t border-rule">
          <div className="hidden sm:flex gap-5">
            <span className="flex items-center gap-2 font-sans text-[0.8125rem] text-ink-faint">
              <kbd className="font-sans text-[0.6875rem] font-medium bg-white border border-rule rounded py-0.5 px-1.5 min-w-5 text-center">↵</kbd> select
            </span>
            <span className="flex items-center gap-2 font-sans text-[0.8125rem] text-ink-faint">
              <kbd className="font-sans text-[0.6875rem] font-medium bg-white border border-rule rounded py-0.5 px-1.5 min-w-5 text-center">↑</kbd>
              <kbd className="font-sans text-[0.6875rem] font-medium bg-white border border-rule rounded py-0.5 px-1.5 min-w-5 text-center">↓</kbd> navigate
            </span>
          </div>
        </div>
      </div>
    </div>
  );
});
