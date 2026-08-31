/**
 * Consolidated formatting utilities
 * Replaces duplicate formatting functions scattered across components
 */

// ============================================================================
// CURRENCY FORMATTING
// ============================================================================

/**
 * Format currency with automatic scaling (T/B/M/K)
 * Handles negative values with prefix
 */
export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '-';

  const prefix = value < 0 ? '-' : '';
  const absValue = Math.abs(value);

  if (absValue >= 1_000_000_000_000) {
    return `${prefix}$${(absValue / 1_000_000_000_000).toFixed(2)}T`;
  }
  if (absValue >= 1_000_000_000) {
    return `${prefix}$${(absValue / 1_000_000_000).toFixed(2)}B`;
  }
  if (absValue >= 1_000_000) {
    return `${prefix}$${(absValue / 1_000_000).toFixed(2)}M`;
  }
  if (absValue >= 1_000) {
    return `${prefix}$${(absValue / 1_000).toFixed(2)}K`;
  }
  return `${prefix}$${absValue.toFixed(2)}`;
}

/**
 * Format per-share values (e.g., EPS, price per share)
 */
export function formatPerShare(value: number | null | undefined): string {
  if (value == null) return '-';
  return `$${value.toFixed(2)}`;
}

// ============================================================================
// NUMBER FORMATTING
// ============================================================================

/**
 * Format a value that's already in millions (common for SEC financial data)
 * Input: 1.5 (meaning 1.5M) → Output: "$1.5M"
 * Input: 1500 (meaning 1500M) → Output: "$1.5B"
 */
export function formatPreScaledMillions(value: number | null | undefined): string {
  if (value == null) return '-';

  const absValue = Math.abs(value);
  const prefix = value < 0 ? '-' : '';

  if (absValue >= 1000) return `${prefix}$${(absValue / 1000).toFixed(1)}B`;
  if (absValue >= 1) return `${prefix}$${absValue.toFixed(1)}M`;
  return `${prefix}$${(absValue * 1000).toFixed(0)}K`;
}

/**
 * Format number with locale-aware thousand separators
 */
export function formatNumber(value: number | null | undefined): string {
  if (value == null) return '-';
  return value.toLocaleString('en-US');
}

/**
 * Format large numbers with scaling (B/M/K)
 * Useful for shares, counts, etc.
 */
export function formatNumberCompact(value: number | null | undefined): string {
  if (value == null) return '-';

  const absValue = Math.abs(value);
  const prefix = value < 0 ? '-' : '';

  if (absValue >= 1_000_000_000) {
    return `${prefix}${(absValue / 1_000_000_000).toFixed(2)}B`;
  }
  if (absValue >= 1_000_000) {
    return `${prefix}${(absValue / 1_000_000).toFixed(2)}M`;
  }
  if (absValue >= 1_000) {
    return `${prefix}${(absValue / 1_000).toFixed(1)}K`;
  }
  return value.toLocaleString('en-US');
}

// ============================================================================
// PERCENTAGE FORMATTING
// ============================================================================

/**
 * Format decimal as percentage (0.15 -> "15.00%")
 * Does NOT include +/- prefix
 */
export function formatPercent(value: number | null | undefined): string {
  if (value == null) return '-';
  return `${(value * 100).toFixed(2)}%`;
}

/**
 * Format decimal as percentage with +/- sign
 * Useful for returns, changes, etc.
 */
export function formatPercentSigned(value: number | null | undefined): string {
  if (value == null) return '-';
  const pct = value * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

/**
 * Format a value that's already a percentage (15 -> "15.00%")
 */
export function formatPercentRaw(value: number | null | undefined): string {
  if (value == null) return '-';
  return `${value.toFixed(2)}%`;
}

// ============================================================================
// RATIO FORMATTING
// ============================================================================

/**
 * Format ratio values (P/E, debt/equity, etc.)
 */
export function formatRatio(
  value: number | null | undefined,
  decimals: number = 2
): string {
  if (value == null) return '-';
  return value.toFixed(decimals);
}

// ============================================================================
// DATE/TIME FORMATTING
// ============================================================================

/**
 * Format date as "Jan 15, 2024"
 */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  // Handle date-only strings (YYYY-MM-DD) without timezone shift
  // by parsing as local date, not UTC
  const dateOnly = dateStr.split('T')[0];
  const [year, month, day] = dateOnly.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ============================================================================
// NORMALIZATION REASON FORMATTING
// ============================================================================

/**
 * Transform technical normalization reasons into user-friendly text.
 *
 * Backend reason formats:
 * - "unchanged" → null (no display)
 * - "no_price_data" → null (no display)
 * - "adjusted_1000x - $13,136 × 1000 = $13,136,000" → "Reported in thousands (×1000)"
 * - "flagged_estimated - raw=99,615, estimated=45,396 from $1,203×1000/$26.50" → "Estimated from value ÷ price"
 *
 * @param reason - Raw reason string from the API
 * @param type - Whether this is a 'shares' or 'value' adjustment
 * @returns User-friendly string or null if no display needed
 */
export function formatNormalizationReason(
  reason: string | null | undefined,
  type: 'shares' | 'value'
): string | null {
  if (!reason || reason === 'unchanged' || reason === 'no_price_data') {
    return null;
  }

  // Handle 1000x adjustments (value was reported in thousands)
  if (reason.startsWith('adjusted_1000x')) {
    return type === 'value'
      ? 'Reported in thousands (×1000)'
      : 'Corrected from value (×1000)';
  }

  // Handle estimated shares from value/price calculation
  if (reason.startsWith('flagged_estimated')) {
    // Extract the raw and estimated values to calculate percentage
    const match = reason.match(/raw=([0-9,]+),\s*estimated=([0-9,]+)/);
    if (match) {
      const raw = parseInt(match[1].replace(/,/g, ''), 10);
      const estimated = parseInt(match[2].replace(/,/g, ''), 10);
      if (raw > 0 && estimated > 0) {
        const pctChange = Math.abs(((estimated - raw) / raw) * 100);
        return `Estimated from value ÷ price (${pctChange.toFixed(0)}% adj)`;
      }
    }
    return 'Estimated from value ÷ price';
  }

  // Handle other potential normalization reasons
  if (reason.includes('1000x') || reason.includes('×1000')) {
    return 'Corrected: reported in thousands';
  }

  // Return a cleaned version of unknown reasons
  return reason.split(' - ')[0].replace(/_/g, ' ');
}
