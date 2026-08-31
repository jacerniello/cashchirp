'use client';

import { useState, useMemo, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  useScreener,
  useScreenerStats,
  useScreenerSectors,
  type MarketCapRange,
  type ScreenerParams,
} from '@/hooks/useScreener';
import { ALL_SCREEN_METRICS, type FilterPreset } from './constants';
import { parseFilterValue, filterToParam } from './utils';
import { SaveScreen } from './components/SaveScreen';
import { FilterPanel } from './components/FilterPanel';
import { LiveResults } from './components/LiveResults';
import { Card, EmptyState, Spinner } from './components/shared';
import { ScreenerAreaNav } from '@/components/nav/AreaSubNav';

function FilterPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Parse URL params for basic filters
  const initialRange = (searchParams.get('range') as MarketCapRange) || null;
  const initialSector = searchParams.get('sector') || '';
  const initialIndustry = searchParams.get('industry') || '';
  const initialExchange = searchParams.get('exchange') || '';
  const initialPage = parseInt(searchParams.get('page') || '1', 10);
  const initialSort = searchParams.get('sort') || '-market_cap';
  // Exclusion toggles mirror the Dash screener's defaults: commodities excluded by
  // default; biotech/pharma and delisted included unless toggled.
  const initialExclCommod = searchParams.get('excl_commod') !== '0';
  const initialExclBiotech = searchParams.get('excl_biotech') === '1';
  const initialInclDelisted = searchParams.get('incl_delisted') === '1';

  // State for basic filters
  const [selectedRange, setSelectedRange] = useState<MarketCapRange | null>(initialRange);
  const [selectedSector, setSelectedSector] = useState(initialSector);
  const [selectedIndustry, setSelectedIndustry] = useState(initialIndustry);
  const [selectedExchange, setSelectedExchange] = useState(initialExchange);
  const [excludeCommodities, setExcludeCommodities] = useState(initialExclCommod);
  const [excludeBiotech, setExcludeBiotech] = useState(initialExclBiotech);
  const [includeDelisted, setIncludeDelisted] = useState(initialInclDelisted);
  const [page, setPage] = useState(initialPage);
  const [sort, setSort] = useState(initialSort);

  // State for numeric range filters
  const [filters, setFilters] = useState<Record<string, { min: string; max: string }>>(() => {
    const initial: Record<string, { min: string; max: string }> = {};
    for (const filter of ALL_SCREEN_METRICS) {
      initial[filter.key] = {
        min: parseFilterValue(searchParams.get(`${filter.key}_min`), filter.isPercent || false),
        max: parseFilterValue(searchParams.get(`${filter.key}_max`), filter.isPercent || false),
      };
    }
    return initial;
  });

  // State for active preset
  const initialPreset = searchParams.get('preset') || null;
  const [activePreset, setActivePreset] = useState<string | null>(initialPreset);

  // Build screener params
  const screenerParams: ScreenerParams = useMemo(() => {
    const params: ScreenerParams = {
      page,
      per_page: 25,
      sort,
    };
    // Listing scope: include delisted wins; otherwise restrict to active (Dash default).
    if (includeDelisted) {
      params.include_delisted = true;
    } else {
      params.is_active = true;
    }

    if (selectedRange) {
      params.market_cap_range = selectedRange;
    }
    if (selectedSector) {
      params.sector = selectedSector;
    }
    if (selectedIndustry) {
      params.industry = selectedIndustry;
    }
    if (selectedExchange) {
      params.exchange = selectedExchange;
    }
    if (excludeCommodities) {
      params.exclude_commodities = true;
    }
    if (excludeBiotech) {
      params.exclude_biotech = true;
    }

    for (const filter of ALL_SCREEN_METRICS) {
      const minParam = filterToParam(filters[filter.key]?.min || '', filter.isPercent || false);
      const maxParam = filterToParam(filters[filter.key]?.max || '', filter.isPercent || false);

      if (minParam !== undefined) {
        (params as Record<string, unknown>)[`${filter.key}_min`] = parseFloat(minParam);
      }
      if (maxParam !== undefined) {
        (params as Record<string, unknown>)[`${filter.key}_max`] = parseFloat(maxParam);
      }
    }

    return params;
  }, [selectedRange, selectedSector, selectedIndustry, selectedExchange,
      excludeCommodities, excludeBiotech, includeDelisted, page, sort, filters]);

  // Fetch data
  const { data, isLoading, isFetching, error } = useScreener(screenerParams, true);
  const { data: stats } = useScreenerStats();
  // Unfiltered catalogue of categorical values (so the exchange dropdown doesn't
  // collapse to a single option once an exchange is selected).
  const { data: catalogue } = useScreenerSectors();

  // Derive available sectors/industries (filtered) + exchanges (full catalogue).
  const sectorsData = useMemo(() => {
    if (!data) return undefined;
    return {
      sectors: data.available_sectors || [],
      industries: data.available_industries || [],
      exchanges: catalogue?.exchanges || data.available_exchanges || [],
    };
  }, [data, catalogue]);

  // Clear sector/industry if no longer available
  useEffect(() => {
    if (!sectorsData) return;
    if (selectedSector && !sectorsData.sectors.includes(selectedSector)) {
      setSelectedSector('');
      setSelectedIndustry('');
    }
    if (selectedIndustry && !sectorsData.industries.includes(selectedIndustry)) {
      setSelectedIndustry('');
    }
  }, [sectorsData, selectedSector, selectedIndustry]);

  // Update URL when filters change. `replace` (used by pagination) swaps the URL
  // without a history entry or scroll jump, so only the results table re-renders.
  const updateUrl = (opts?: { replace?: boolean }) => {
    const params = new URLSearchParams();

    if (selectedRange) params.set('range', selectedRange);
    if (selectedSector) params.set('sector', selectedSector);
    if (selectedIndustry) params.set('industry', selectedIndustry);
    if (selectedExchange) params.set('exchange', selectedExchange);
    // Persist exclusion toggles only when they deviate from the Dash defaults
    // (commodities excluded; biotech/delisted not), to keep URLs clean.
    if (!excludeCommodities) params.set('excl_commod', '0');
    if (excludeBiotech) params.set('excl_biotech', '1');
    if (includeDelisted) params.set('incl_delisted', '1');
    if (page > 1) params.set('page', page.toString());
    if (sort !== '-market_cap') params.set('sort', sort);

    for (const filter of ALL_SCREEN_METRICS) {
      const minParam = filterToParam(filters[filter.key]?.min || '', filter.isPercent || false);
      const maxParam = filterToParam(filters[filter.key]?.max || '', filter.isPercent || false);
      if (minParam) params.set(`${filter.key}_min`, minParam);
      if (maxParam) params.set(`${filter.key}_max`, maxParam);
    }

    const url = `/filter?${params.toString()}`;
    if (opts?.replace) router.replace(url, { scroll: false });
    else router.push(url);
  };

  // Handlers
  const handleRangeClick = (range: MarketCapRange) => {
    const newRange = selectedRange === range ? null : range;
    setSelectedRange(newRange);
    setPage(1);
    setTimeout(updateUrl, 0);
  };

  const handleSectorChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedSector(e.target.value);
    setSelectedIndustry('');
    setPage(1);
    setTimeout(updateUrl, 0);
  };

  const handleIndustryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedIndustry(e.target.value);
    setPage(1);
    setTimeout(updateUrl, 0);
  };

  const handleExchangeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedExchange(e.target.value);
    setPage(1);
    setTimeout(updateUrl, 0);
  };

  const handleToggle = (
    key: 'commod' | 'biotech' | 'delisted',
    value: boolean
  ) => {
    if (key === 'commod') setExcludeCommodities(value);
    else if (key === 'biotech') setExcludeBiotech(value);
    else setIncludeDelisted(value);
    setPage(1);
    setTimeout(updateUrl, 0);
  };

  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSort(e.target.value);
    setPage(1);
    setTimeout(updateUrl, 0);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    setTimeout(() => updateUrl({ replace: true }), 0);
  };

  const handleMetricChange = (key: string, minMax: { min: string; max: string }) => {
    setFilters((prev) => ({
      ...prev,
      [key]: minMax,
    }));
    setPage(1);
    setActivePreset(null);
  };

  const applyFilters = () => {
    updateUrl();
  };

  const clearFilters = () => {
    setSelectedRange(null);
    setSelectedSector('');
    setSelectedIndustry('');
    setSelectedExchange('');
    setExcludeCommodities(true);  // Dash default
    setExcludeBiotech(false);
    setIncludeDelisted(false);
    setSort('-market_cap');
    setPage(1);
    setActivePreset(null);

    const emptyFilters: Record<string, { min: string; max: string }> = {};
    for (const filter of ALL_SCREEN_METRICS) {
      emptyFilters[filter.key] = { min: '', max: '' };
    }
    setFilters(emptyFilters);

    router.push('/filter');
  };

  const applyPreset = (preset: FilterPreset) => {
    const newFilters: Record<string, { min: string; max: string }> = {};
    for (const filter of ALL_SCREEN_METRICS) {
      newFilters[filter.key] = preset.filters[filter.key] || { min: '', max: '' };
    }

    setFilters(newFilters);
    setActivePreset(preset.key);
    setPage(1);

    const params = new URLSearchParams();
    if (selectedRange) params.set('range', selectedRange);
    if (selectedSector) params.set('sector', selectedSector);
    if (selectedIndustry) params.set('industry', selectedIndustry);
    params.set('preset', preset.key);

    for (const filter of ALL_SCREEN_METRICS) {
      const filterValue = newFilters[filter.key];
      const isPercent = filter.isPercent || false;

      const minParam = filterToParam(filterValue?.min || '', isPercent);
      const maxParam = filterToParam(filterValue?.max || '', isPercent);
      if (minParam) params.set(`${filter.key}_min`, minParam);
      if (maxParam) params.set(`${filter.key}_max`, maxParam);
    }

    router.push(`/filter?${params.toString()}`);
  };

  const hasActiveFilters = !!(selectedRange || selectedSector || selectedIndustry ||
    selectedExchange || !excludeCommodities || excludeBiotech || includeDelisted ||
    Object.values(filters).some((f) => f.min || f.max));

  const totalPages = data?.total_pages || 1;

  return (
    <div className="bg-white min-h-[calc(100vh-200px)] font-sans">
      <ScreenerAreaNav />
      {/* Header */}
      <div className="py-16 px-8 pb-12 text-center border-b border-rule">
        <h1 className="font-sans text-[2.5rem] font-bold tracking-tight text-ink mb-3">
          Filter
        </h1>
        <p className="text-lg text-ink-light mb-4">
          Filter companies by fundamentals, valuation, and more
        </p>
      </div>

      {/* Companies Main Content */}
      <div className="max-w-[1400px] mx-auto py-12 px-6 space-y-6">
        {/* Keep the current filter as a screen — see SaveScreen.tsx for why it writes
            YAML rather than storing it in the browser. */}
        <SaveScreen params={screenerParams} />
        <FilterPanel
          selectedRange={selectedRange}
          selectedSector={selectedSector}
          selectedIndustry={selectedIndustry}
          selectedExchange={selectedExchange}
          excludeCommodities={excludeCommodities}
          excludeBiotech={excludeBiotech}
          includeDelisted={includeDelisted}
          filters={filters}
          activePreset={activePreset}
          hasActiveFilters={hasActiveFilters}
          stats={stats}
          sectorsData={sectorsData}
          onRangeClick={handleRangeClick}
          onSectorChange={handleSectorChange}
          onIndustryChange={handleIndustryChange}
          onExchangeChange={handleExchangeChange}
          onToggle={handleToggle}
          onMetricChange={handleMetricChange}
          onApplyPreset={applyPreset}
          onApplyFilters={applyFilters}
          onClearFilters={clearFilters}
        />

        <div>
          <Card className="mb-4">
            <div className="flex flex-wrap items-center justify-between gap-4 p-4">
              <div className="text-sm text-ink-muted">
                <span className="font-semibold text-ink">{data?.total.toLocaleString() || 0}</span> companies found
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-ink-light">Sort:</label>
                <select
                  value={sort}
                  onChange={handleSortChange}
                  className="px-3 py-1.5 border border-rule rounded-lg text-sm text-ink bg-white focus:border-green focus:outline-none"
                >
                  {/* Mirrors the Dash screener SORTS; values are the API filter keys
                      (core/api/routers/screener.py _FILT). Leading "-" = descending. */}
                  <option value="-market_cap">Market Cap (High to Low)</option>
                  <option value="market_cap">Market Cap (Low to High)</option>
                  <option value="pe">P/E (Low to High)</option>
                  <option value="-pe">P/E (High to Low)</option>
                  <option value="ps">P/S (Low to High)</option>
                  <option value="pb">P/B (Low to High)</option>
                  <option value="ev_ebitda">EV/EBITDA (Low to High)</option>
                  <option value="-roe">ROE (High to Low)</option>
                  <option value="-roic">ROIC (High to Low)</option>
                  <option value="-profit_margin">Net Margin (High to Low)</option>
                  <option value="-eps_growth">EPS Growth TTM (High to Low)</option>
                  <option value="-revenue_growth">Sales Growth TTM (High to Low)</option>
                  <option value="-div_yield">Dividend Yield (High to Low)</option>
                  <option value="-net_cash_pct">Net Cash % of Cap (High to Low)</option>
                  <option value="-altman_z">Altman Z-Score (High to Low)</option>
                  <option value="-pct_below_high">Off 52w High (High to Low)</option>
                  <option value="-years_public">Years Public (High to Low)</option>
                  <option value="name">Name (A-Z)</option>
                  <option value="-name">Name (Z-A)</option>
                </select>
              </div>
            </div>
          </Card>

          <Card>
            {isLoading ? (
              <Spinner className="h-5 w-5 text-green" />
            ) : error ? (
              <div className="text-center py-12">
                <p className="text-ink-light">Error loading companies. Please try again.</p>
              </div>
            ) : data?.results.length === 0 ? (
              <EmptyState />
            ) : (
              <div className={isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
                <LiveResults
                  results={data?.results || []}
                  page={page}
                  totalPages={totalPages}
                  onPageChange={handlePageChange}
                />
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Re-key the grid on the query string so loading a saved screen actually takes effect.
 *
 *  FilterPageContent seeds every widget from `useSearchParams()` inside `useState`
 *  initialisers, which run ONCE per mount. Pushing a new URL for the same route re-renders
 *  but does not re-run them, so without this key a clicked screen would change the address
 *  bar and leave the filters untouched — the worst kind of bug, because it looks like it
 *  worked. Remounting re-reads the URL, which is this page's source of truth. */
function KeyedFilterPage() {
  const searchParams = useSearchParams();
  return <FilterPageContent key={searchParams.toString()} />;
}

export default function FilterPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-12"><Spinner className="h-8 w-8 text-green" /></div>}>
      <KeyedFilterPage />
    </Suspense>
  );
}
