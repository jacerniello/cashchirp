'use client';

import { useState, useRef, useEffect } from 'react';
import { Icon } from '../../icons';
import api from '../../../lib/api';

interface TickerSelectorProps {
  selectedTicker: string;
  onTickerChange: (ticker: string) => void;
  onRemove?: () => void;
  placeholder?: string;
}

interface SearchResult {
  ticker: string;
  name: string;
  cik?: string;
}

export function TickerSelector({
  selectedTicker,
  onTickerChange,
  onRemove,
  placeholder = 'Enter ticker...',
}: TickerSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Search for tickers
  useEffect(() => {
    if (query.length < 1) {
      setResults([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      setIsLoading(true);
      try {
        const response = await api.get('/search/', {
          params: { type: 'stock', q: query },
        });
        const data = response.data;
        setResults(
          data.results?.slice(0, 8).map((r: { ticker: string; name: string; cik?: string }) => ({
            ticker: r.ticker,
            name: r.name,
            cik: r.cik,
          })).filter((r: SearchResult) => r.ticker) || []
        );
      } catch {
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 200);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const handleSelect = (ticker: string) => {
    onTickerChange(ticker);
    setQuery('');
    setIsOpen(false);
    setResults([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && query.trim()) {
      // If there's a match in results, select it
      const match = results.find(
        (r) => r.ticker.toLowerCase() === query.trim().toLowerCase()
      );
      if (match) {
        handleSelect(match.ticker);
      } else if (query.trim().length <= 5) {
        // Otherwise try the raw input (assume it's a ticker)
        handleSelect(query.trim().toUpperCase());
      }
    }
    if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2">
        {selectedTicker ? (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-green-soft text-green rounded-md text-sm font-semibold">
            {selectedTicker}
            {onRemove && (
              <button
                onClick={onRemove}
                className="hover:text-green-dark transition-colors"
              >
                <Icon name="close" className="w-4 h-4" />
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setIsOpen(true);
                }}
                onFocus={() => setIsOpen(true)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                className="w-32 px-3 py-1.5 text-sm border border-rule rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-green focus:border-transparent"
              />
              {isLoading && (
                <Icon
                  name="spinner"
                  className="w-4 h-4 text-ink-muted animate-spin absolute right-2 top-1/2 -translate-y-1/2"
                />
              )}
            </div>
            <button
              onClick={() => {
                if (query.trim()) {
                  const match = results.find(
                    (r) => r.ticker.toLowerCase() === query.trim().toLowerCase()
                  );
                  if (match) {
                    handleSelect(match.ticker);
                  } else if (query.trim().length <= 5) {
                    handleSelect(query.trim().toUpperCase());
                  }
                }
              }}
              disabled={!query.trim()}
              className="px-3 py-1.5 text-sm font-semibold bg-green text-white rounded-md hover:bg-green-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Add
            </button>
          </div>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && results.length > 0 && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-rule rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
          {results.map((result) => (
            <button
              key={`${result.ticker}-${result.cik}`}
              onClick={() => handleSelect(result.ticker)}
              className="w-full px-3 py-2 text-left hover:bg-surface-warm flex items-center gap-2 transition-colors"
            >
              <span className="font-semibold text-green text-sm min-w-[50px]">
                {result.ticker}
              </span>
              <span className="text-xs text-ink-light truncate">
                {result.name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
