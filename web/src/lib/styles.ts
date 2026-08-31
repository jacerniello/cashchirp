/**
 * Common Tailwind class patterns used across the application
 * Import these to ensure consistent styling and reduce duplication
 */

// ============================================================================
// CARD STYLES
// ============================================================================

export const cardStyles = {
  /** Standard card container */
  base: 'bg-white border border-rule rounded-xl p-6 shadow-sm',
  /** Card with hover effect */
  interactive: 'bg-white border border-rule rounded-xl p-6 shadow-sm transition-all hover:border-green hover:shadow-md',
  /** Compact card (less padding) */
  compact: 'bg-white border border-rule rounded-xl p-4 shadow-sm',
  /** Stat card for overview sections */
  stat: 'bg-white rounded-xl border border-rule p-4 transition-shadow hover:shadow-md',
} as const;

// ============================================================================
// BAR / SEGMENTED CONTROL STYLES
// ============================================================================

// Mirrors the Dash `.co-tabs` pill bar (core/frontend/assets/app.css): pills sit
// directly on the page (no gray track), muted inactive text, light hover fill, and
// a solid blue (#2563eb / `--color-blue`) fill + white text when active. 6px radius,
// compact padding. Use `<SegmentedControl>` for the common case, or `segItem()` to
// style an existing button bar inline.
export const controlStyles = {
  /** The bar wrapper — pills laid out in a row, transparent background. */
  bar: 'inline-flex items-center gap-1 flex-wrap',
  /** Base for one pill (combine with active/inactive). */
  item: 'px-3 py-1.5 text-[0.84rem] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap select-none',
  /** Inactive pill — ink-faint reads clearly (not the too-dim ink-muted). */
  itemInactive: 'text-ink-faint hover:text-ink hover:bg-surface-warm',
  /** Active pill — the one Dash accent. */
  itemActive: 'bg-blue text-white',
} as const;

/** Class string for a single segmented-control pill given its active state. */
export function segItem(active: boolean): string {
  return cn(controlStyles.item, active ? controlStyles.itemActive : controlStyles.itemInactive);
}

// ============================================================================
// LINK STYLES
// ============================================================================

export const linkStyles = {
  /** Standard text link */
  base: 'text-green hover:text-green-dark no-underline font-medium transition-colors',
  /** Footer link (light on dark) */
  footer: 'font-sans text-sm font-medium text-white/70 no-underline transition-colors duration-150 hover:text-green',
  /** Muted link */
  muted: 'text-ink-muted hover:text-ink no-underline transition-colors',
  /** Card link (block-level) */
  card: 'block no-underline transition-all hover:shadow-md',
} as const;

// ============================================================================
// TEXT STYLES
// ============================================================================

export const textStyles = {
  /** Page title */
  pageTitle: 'text-2xl md:text-3xl font-bold text-ink tracking-tight',
  /** Section title */
  sectionTitle: 'text-lg font-bold text-ink',
  /** Card title */
  cardTitle: 'text-xl font-bold text-ink',
  /** Label text */
  label: 'text-xs text-ink-muted uppercase font-semibold tracking-wide',
  /** Body text */
  body: 'text-sm text-ink',
  /** Muted text */
  muted: 'text-sm text-ink-muted',
  /** Error text */
  error: 'text-sm text-red-600',
  /** Success text */
  success: 'text-sm text-green-600',
} as const;

// ============================================================================
// TABLE STYLES
// ============================================================================

// Precise, space-efficient "terminal" tables: no filled header (a 2px rule instead),
// 11px uppercase column labels, tight padding, 13px tabular-nums body, subtle zebra +
// hover. Mirrors the Dash data_table look so the web UI reads the same.
export const tableStyles = {
  /** Table container (horizontal scroll on overflow) */
  container: 'overflow-x-auto',
  /** Table element */
  table: 'w-full border-collapse',
  /** Header cell (left-aligned, e.g. ticker/name) */
  th: 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-muted border-b-2 border-rule whitespace-nowrap',
  /** Header cell (right-aligned, for numeric columns) */
  thNum: 'px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-muted border-b-2 border-rule whitespace-nowrap',
  /** Data cell */
  td: 'px-3 py-1.5 text-[13px] text-ink border-b border-rule-light whitespace-nowrap',
  /** Data cell (numeric: right-aligned, tabular, monospaced) */
  tdNum: 'px-3 py-1.5 text-[13px] text-right tabular-nums font-mono text-ink-light border-b border-rule-light whitespace-nowrap',
  /** Body row: faint zebra for scanning + hover tint */
  row: 'odd:bg-surface-warm hover:bg-green-soft transition-colors',
} as const;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Combine class names conditionally
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}
