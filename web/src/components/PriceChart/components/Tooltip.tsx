import type { CorporateAction } from '../../../hooks/usePrices';

interface TooltipData {
  date: string;
  close?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
}

interface TooltipProps {
  data: TooltipData;
  x: number;
  y: number;
  corporateAction?: CorporateAction;
  pinned?: boolean;
}

export function Tooltip({ data, x, y, corporateAction, pinned = false }: TooltipProps) {
  const formatPrice = (price: number) => {
    return price.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const formatVolume = (volume: number) => {
    if (volume >= 1_000_000_000) return (volume / 1_000_000_000).toFixed(2) + 'B';
    if (volume >= 1_000_000) return (volume / 1_000_000).toFixed(2) + 'M';
    if (volume >= 1_000) return (volume / 1_000).toFixed(2) + 'K';
    return volume.toLocaleString();
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const tooltipWidth = 150;
  const baseHeight = 100;
  const tooltipHeight = corporateAction ? baseHeight + 40 : baseHeight;

  // Position tooltip differently when pinned (top-left corner like Django) vs floating (above hovered point)
  let adjustedX: number;
  let adjustedY: number;

  if (pinned) {
    // Pinned mode: position in top-left corner, above range buttons (like Django)
    // x is padding.left, y is 5 (near top of SVG)
    adjustedX = x + tooltipWidth / 2 + 10; // Left-aligned with some padding
    adjustedY = tooltipHeight + 20; // Position tooltip starting near top
  } else {
    // Floating mode: center above hovered point
    adjustedX = Math.max(tooltipWidth / 2 + 10, Math.min(x, 800 - tooltipWidth / 2 - 10));
    adjustedY = Math.max(tooltipHeight + 20, y);
  }

  return (
    <g className="pointer-events-none">
      {/* Drop shadow for tooltip */}
      <defs>
        <filter id="tooltip-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="rgba(0,0,0,0.25)" />
        </filter>
      </defs>

      <rect
        x={adjustedX - tooltipWidth / 2}
        y={adjustedY - tooltipHeight - 15}
        width={tooltipWidth}
        height={tooltipHeight}
        rx={8}
        fill="var(--color-ink)"
        filter="url(#tooltip-shadow)"
      />

      {/* Main Price - prominent and green */}
      <text
        x={adjustedX - tooltipWidth / 2 + 14}
        y={adjustedY - tooltipHeight + 22}
        className="fill-green text-[18px] font-bold font-mono"
      >
        {data.close !== undefined ? formatPrice(data.close) : '-'}
      </text>

      {/* Date */}
      <text
        x={adjustedX - tooltipWidth / 2 + 14}
        y={adjustedY - tooltipHeight + 42}
        className="fill-white/70 text-[11px]"
      >
        {formatDate(data.date)}
      </text>

      {/* OHLC in a compact row - only show if data is available */}
      {(data.open !== undefined || data.high !== undefined) && (
        <text
          x={adjustedX - tooltipWidth / 2 + 14}
          y={adjustedY - tooltipHeight + 64}
          className="fill-white/50 text-[9px] uppercase tracking-wide"
        >
          O: <tspan className="fill-white/80">{data.open !== undefined ? formatPrice(data.open) : '-'}</tspan>
          <tspan className="fill-white/50">  H: </tspan><tspan className="fill-[#10b981]">{data.high !== undefined ? formatPrice(data.high) : '-'}</tspan>
        </text>
      )}
      {(data.low !== undefined || data.volume !== undefined) && (
        <text
          x={adjustedX - tooltipWidth / 2 + 14}
          y={adjustedY - tooltipHeight + 80}
          className="fill-white/50 text-[9px] uppercase tracking-wide"
        >
          L: <tspan className="fill-[#ef4444]">{data.low !== undefined ? formatPrice(data.low) : '-'}</tspan>
          <tspan className="fill-white/50">  Vol: </tspan><tspan className="fill-white/80">{data.volume !== undefined ? formatVolume(data.volume) : '-'}</tspan>
        </text>
      )}

      {/* Corporate Action */}
      {corporateAction && (
        <>
          <text
            x={adjustedX - tooltipWidth / 2 + 14}
            y={adjustedY - tooltipHeight + 98}
            className="text-[10px] font-semibold"
            fill={corporateAction.color}
          >
            {corporateAction.type === 'dividend' ? 'Dividend: ' : 'Split: '}
            <tspan className="fill-white">
              {corporateAction.type === 'dividend'
                ? `$${corporateAction.value.toFixed(2)}`
                : `${corporateAction.value}:1`}
            </tspan>
          </text>
          <text
            x={adjustedX - tooltipWidth / 2 + 14}
            y={adjustedY - tooltipHeight + 112}
            className="fill-white/60 text-[9px]"
          >
            {formatDate(corporateAction.date)}
          </text>
        </>
      )}
    </g>
  );
}
