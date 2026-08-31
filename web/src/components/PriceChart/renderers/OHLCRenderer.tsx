import type { PriceDataPoint } from '../../../hooks/usePrices';

interface OHLCRendererProps {
  data: PriceDataPoint[];
  padding: { top: number; right: number; bottom: number; left: number };
  chartWidth: number;
  priceChartHeight: number;
  minPrice: number;
  maxPrice: number;
}

interface CandleData {
  x: number;
  open: number;
  high: number;
  low: number;
  close: number;
  isGreen: boolean;
}

export function OHLCRenderer({
  data,
  padding,
  chartWidth,
  priceChartHeight,
  minPrice,
  maxPrice,
}: OHLCRendererProps) {
  if (data.length === 0) return null;

  const priceRange = maxPrice - minPrice || 1;

  const getY = (price: number) => {
    return padding.top + priceChartHeight - ((price - minPrice) / priceRange) * priceChartHeight;
  };

  // Calculate candle width based on data density
  const candleWidth = Math.max(2, Math.min(12, (chartWidth / data.length) * 0.7));
  const wickWidth = Math.max(1, candleWidth * 0.15);

  const candles: CandleData[] = data.map((point, index) => {
    const x = padding.left + (index / (data.length - 1 || 1)) * chartWidth;
    return {
      x,
      open: point.open,
      high: point.high,
      low: point.low,
      close: point.close,
      isGreen: point.close >= point.open,
    };
  });

  return (
    <g className="ohlc-candles">
      {candles.map((candle, index) => {
        const bodyTop = getY(Math.max(candle.open, candle.close));
        const bodyBottom = getY(Math.min(candle.open, candle.close));
        const bodyHeight = Math.max(1, bodyBottom - bodyTop);

        const wickTop = getY(candle.high);
        const wickBottom = getY(candle.low);

        const fillColor = candle.isGreen ? '#10b981' : '#ef4444';
        const strokeColor = candle.isGreen ? '#059669' : '#dc2626';

        return (
          <g key={`candle-${index}`}>
            {/* Wick (high-low line) */}
            <line
              x1={candle.x}
              y1={wickTop}
              x2={candle.x}
              y2={wickBottom}
              stroke={strokeColor}
              strokeWidth={wickWidth}
            />
            {/* Body (open-close rectangle) */}
            <rect
              x={candle.x - candleWidth / 2}
              y={bodyTop}
              width={candleWidth}
              height={bodyHeight}
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={0.5}
              rx={1}
            />
          </g>
        );
      })}
    </g>
  );
}
