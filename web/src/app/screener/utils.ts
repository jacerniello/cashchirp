export function formatMarketCap(value: number | null): string {
  if (value === null) return '-';
  if (value >= 1_000_000_000_000) {
    return `$${(value / 1_000_000_000_000).toFixed(2)}T`;
  }
  if (value >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  return `$${value.toLocaleString()}`;
}

export function formatRatio(value: number | null): string {
  if (value === null || value === undefined) return '-';
  return value.toFixed(1);
}

export function formatPercent(value: number | null): string {
  if (value === null || value === undefined) return '-';
  return `${(value * 100).toFixed(1)}%`;
}

export function parseFilterValue(value: string | null, isPercent: boolean): string {
  if (!value) return '';
  if (isPercent) {
    const num = parseFloat(value);
    if (isNaN(num)) return '';
    return (num * 100).toString();
  }
  return value;
}

export function filterToParam(value: string, isPercent: boolean): string | undefined {
  if (!value) return undefined;
  const num = parseFloat(value);
  if (isNaN(num)) return undefined;
  if (isPercent) {
    return (num / 100).toString();
  }
  return value;
}
