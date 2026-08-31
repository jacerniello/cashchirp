// The three states a table body can be in before it has rows, in one place.
//
// Every table needs these and each one was inventing its own — or, more often, none:
// `(data ?? []).map(...)` renders column headers over nothing while a request is in
// flight, and renders exactly the same nothing when the request failed. Worse, a table
// guarded only by `items.length === 0 ? <Empty/>` claims "none found" during loading,
// which is a confident answer to a question nobody has asked yet.
//
// Skeleton rows rather than a centred "Loading…" so the card keeps its height and the
// page does not jump when data lands.

interface TableStatesProps {
  loading?: boolean;
  error?: unknown;
  /** True only once loading has finished and the result really is empty. */
  empty?: boolean;
  colSpan: number;
  /** Skeleton rows to draw — roughly what the table usually holds. */
  rows?: number;
  /** Relative cell widths for the skeleton, so it echoes the real columns. */
  widths?: number[];
  emptyText?: string;
  errorText?: string;
}

export function TableStates({
  loading = false,
  error = null,
  empty = false,
  colSpan,
  rows = 8,
  widths,
  emptyText = 'No data',
  errorText = 'Could not load this table.',
}: TableStatesProps) {
  if (loading) {
    const w = widths ?? Array.from({ length: colSpan }, (_, i) => (i === 0 ? 40 : 24));
    return (
      <>
        {Array.from({ length: rows }).map((_, r) => (
          <tr key={`sk-${r}`} className="border-b border-rule-light">
            {Array.from({ length: colSpan }).map((_, c) => (
              <td key={c} className="px-3 py-2">
                <div
                  className="h-3 rounded bg-surface-warm animate-pulse"
                  style={{
                    width: `${(w[c] ?? 24) * 4}px`,
                    // right-aligned columns read better with the bar on the right
                    marginLeft: c === colSpan - 1 && colSpan > 1 ? 'auto' : undefined,
                  }}
                />
              </td>
            ))}
          </tr>
        ))}
      </>
    );
  }

  // A failure must not look like an empty result: "we could not ask" and "there is
  // nothing" are different answers, and only one of them is worth retrying.
  if (error) {
    return (
      <tr>
        <td colSpan={colSpan} className="px-3 py-6 text-center text-sm text-ink-faint">
          {errorText}
        </td>
      </tr>
    );
  }

  if (empty) {
    return (
      <tr>
        <td colSpan={colSpan} className="px-3 py-6 text-center text-sm text-ink-faint">
          {emptyText}
        </td>
      </tr>
    );
  }

  return null;
}
