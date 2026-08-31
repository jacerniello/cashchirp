/**
 * Shared chart utilities and configurations
 * Consolidates common chart patterns used across components
 */

import { formatPreScaledMillions } from './formatters';

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  TimeScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  type ChartOptions,
} from 'chart.js';
import 'chartjs-adapter-date-fns';

// ============================================================================
// CHART.JS REGISTRATION
// ============================================================================

/**
 * Register all common Chart.js components
 * Call this once in your app or in individual chart components
 */
export function registerChartComponents(): void {
  ChartJS.register(
    CategoryScale,
    LinearScale,
    TimeScale,
    PointElement,
    LineElement,
    BarElement,
    ArcElement,
    Title,
    Tooltip,
    Legend,
    Filler
  );
}

// Register components (idempotent - safe to call multiple times)
registerChartComponents();

// ============================================================================
// COLOR PALETTES
// ============================================================================

/**
 * Standard chart color palette with bg (fill) and border colors
 */
export const CHART_COLORS = [
  { bg: 'rgba(0, 199, 152, 0.7)', border: 'rgba(0, 199, 152, 1)' },     // Green (primary)
  { bg: 'rgba(59, 130, 246, 0.7)', border: 'rgba(59, 130, 246, 1)' },   // Blue
  { bg: 'rgba(239, 68, 68, 0.7)', border: 'rgba(239, 68, 68, 1)' },     // Red
  { bg: 'rgba(245, 158, 11, 0.7)', border: 'rgba(245, 158, 11, 1)' },   // Amber
  { bg: 'rgba(139, 92, 246, 0.7)', border: 'rgba(139, 92, 246, 1)' },   // Purple
  { bg: 'rgba(236, 72, 153, 0.7)', border: 'rgba(236, 72, 153, 1)' },   // Pink
  { bg: 'rgba(6, 182, 212, 0.7)', border: 'rgba(6, 182, 212, 1)' },     // Cyan
  { bg: 'rgba(132, 204, 22, 0.7)', border: 'rgba(132, 204, 22, 1)' },   // Lime
] as const;

/**
 * Solid colors for simple use cases
 */
export const SOLID_COLORS = {
  green: '#10b981',
  blue: '#3b82f6',
  red: '#dc2626',
  amber: '#f59e0b',
  purple: '#8b5cf6',
  pink: '#ec4899',
  cyan: '#06b6d4',
  lime: '#84cc16',
  gray: '#6b7280',
  teal: '#14b8a6',
  indigo: '#6366f1',
  sky: '#0ea5e9',
  violet: '#8b5cf6',
  emerald: '#10b981',
  slate: '#64748b',
} as const;

/**
 * Extended color palette for multi-series charts (12 distinct colors)
 */
export const MULTI_SERIES_COLORS = [
  '#14b8a6', // Teal
  '#6366f1', // Indigo
  '#0ea5e9', // Sky
  '#8b5cf6', // Violet
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#64748b', // Slate
  '#ef4444', // Red
  '#3b82f6', // Blue
  '#a855f7', // Purple
  '#22c55e', // Green
  '#ec4899', // Pink
] as const;

/**
 * HSL color palette for segment/category charts (16 distinct colors)
 */
export const SEGMENT_COLORS = [
  'hsl(207, 86%, 55%)', 'hsl(150, 70%, 50%)', 'hsl(359, 79%, 65%)', 'hsl(267, 70%, 62%)',
  'hsl(40, 90%, 60%)', 'hsl(180, 65%, 50%)', 'hsl(307, 70%, 60%)', 'hsl(84, 65%, 55%)',
  'hsl(20, 75%, 60%)', 'hsl(240, 60%, 70%)', 'hsl(120, 45%, 70%)', 'hsl(330, 85%, 70%)',
  'hsl(60, 90%, 70%)', 'hsl(200, 75%, 70%)', 'hsl(280, 70%, 45%)', 'hsl(170, 70%, 45%)',
] as const;

// ============================================================================
// VALUE FORMATTING
// ============================================================================

/**
 * Format chart value based on type
 */
export function formatChartValue(
  value: number | null | undefined,
  options?: {
    isPerShare?: boolean;
    isPercent?: boolean;
    isCurrency?: boolean;
    decimals?: number;
  }
): string {
  if (value == null) return '-';

  const { isPerShare, isPercent, isCurrency = true, decimals = 1 } = options || {};

  // Percentage
  if (isPercent) {
    return `${value.toFixed(decimals)}%`;
  }

  // Per share (exact dollar amount)
  if (isPerShare) {
    return `$${value.toFixed(2)}`;
  }

  // Currency with scaling (default for financial charts)
  if (isCurrency) {
    const absValue = Math.abs(value);
    const prefix = value < 0 ? '-' : '';

    if (absValue >= 1_000_000_000_000) {
      return `${prefix}$${(absValue / 1_000_000_000_000).toFixed(decimals)}T`;
    }
    if (absValue >= 1_000_000_000) {
      return `${prefix}$${(absValue / 1_000_000_000).toFixed(decimals)}B`;
    }
    if (absValue >= 1_000_000) {
      return `${prefix}$${(absValue / 1_000_000).toFixed(decimals)}M`;
    }
    if (absValue >= 1_000) {
      return `${prefix}$${(absValue / 1_000).toFixed(decimals)}K`;
    }
    return `${prefix}$${absValue.toFixed(2)}`;
  }

  // Plain number
  return value.toFixed(decimals);
}

/**
 * Format value assuming it's in millions (common for financial data)
 * @deprecated Use formatPreScaledMillions from formatters.ts directly
 */
export const formatMillions = formatPreScaledMillions;

// ============================================================================
// COMMON CHART OPTIONS
// ============================================================================

/**
 * Base options for bar charts
 */
export function getBarChartOptions(options?: {
  isPercent?: boolean;
  isPerShare?: boolean;
  isRatio?: boolean;
  showLegend?: boolean;
  maxTicksLimit?: number;
}): ChartOptions<'bar'> {
  const { isPercent, isPerShare, isRatio, showLegend = false, maxTicksLimit = 12 } = options || {};

  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false, // Disable for snappy range slider response
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: {
        display: showLegend,
        position: 'top',
        labels: {
          boxWidth: 12,
          padding: 8,
          font: { size: 11 },
        },
      },
      tooltip: {
        enabled: true,
        callbacks: {
          label: (context) => {
            const value = context.raw as number;
            return formatChartValue(value, { isPercent, isPerShare, isCurrency: !isRatio });
          },
        },
      },
    },
    scales: {
      x: {
        ticks: {
          maxRotation: 45,
          minRotation: 45,
          autoSkip: true,
          maxTicksLimit,
          font: { size: 10 },
        },
      },
      y: {
        beginAtZero: true,
        ticks: {
          font: { size: 10 },
          callback: (value) => {
            if (isPercent) return `${Number(value).toFixed(0)}%`;
            if (isPerShare) return `$${Number(value).toFixed(2)}`;
            if (isRatio) return Number(value).toFixed(2);
            return formatMillions(value as number);
          },
        },
      },
    },
  };
}

/**
 * Base options for line charts
 */
export function getLineChartOptions(options?: {
  isPercent?: boolean;
  isCurrency?: boolean;
  showLegend?: boolean;
  maxTicksLimit?: number;
}): ChartOptions<'line'> {
  const { isPercent, isCurrency = true, showLegend = false, maxTicksLimit = 12 } = options || {};

  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: showLegend,
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const value = context.parsed.y;
            if (value === null || value === undefined) return '';
            if (isCurrency) {
              return `$${value.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}`;
            }
            if (isPercent) {
              return `${value.toFixed(2)}%`;
            }
            return value.toString();
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { size: 10 }, color: '#94a3b8', maxTicksLimit },
      },
      y: {
        beginAtZero: false,
        grid: { color: '#f1f5f9' },
        ticks: {
          font: { size: 10 },
          color: '#94a3b8',
          callback: (value) => {
            if (isCurrency) return `$${Number(value).toLocaleString()}`;
            if (isPercent) return `${Number(value).toFixed(1)}%`;
            return value.toString();
          },
        },
      },
    },
  };
}

// ============================================================================
// DATA TRANSFORMATION UTILITIES
// ============================================================================

/**
 * Replace null values with 0 for chart rendering
 * Returns both the cleaned data and a set of indices that were null
 */
export function cleanChartData(data: (number | null)[]): {
  values: number[];
  nullIndices: Set<number>;
} {
  const nullIndices = new Set<number>();
  const values = data.map((v, i) => {
    if (v === null) {
      nullIndices.add(i);
      return 0;
    }
    return v;
  });
  return { values, nullIndices };
}

/**
 * Generate colors for bars based on null values
 */
export function generateBarColors(
  data: (number | null)[],
  color: { bg: string; border: string }
): { backgroundColor: string[]; borderColor: string[] } {
  const backgroundColor = data.map((v) =>
    v === null ? 'rgba(200, 200, 200, 0.3)' : color.bg
  );
  const borderColor = data.map((v) =>
    v === null ? 'rgba(150, 150, 150, 0.5)' : color.border
  );
  return { backgroundColor, borderColor };
}

// ============================================================================
// DATE LABEL FORMATTING
// ============================================================================

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ============================================================================
// MULTI-AXIS LINE CHART OPTIONS
// ============================================================================

const DEFAULT_FONT_FAMILY = 'Plus Jakarta Sans, sans-serif';
