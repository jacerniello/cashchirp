'use client';

import { memo, useMemo } from 'react';
import type { PriceDataPoint } from '../../../hooks/usePrices';

interface PerformanceReturnsProps {
  prices: PriceDataPoint[];
}

interface PerformanceData {
  day: number | null;
  week: number | null;
  month: number | null;
  threeMonth: number | null;
  sixMonth: number | null;
  ytd: number | null;
  year: number | null;
  latestPrice: number;
}

export const PerformanceReturns = memo(function PerformanceReturns({ prices }: PerformanceReturnsProps) {
  const performanceReturns = useMemo((): PerformanceData | null => {
    if (!prices || prices.length < 2) return null;

    const latestPrice = prices[prices.length - 1]?.close;
    if (!latestPrice) return null;

    const now = new Date();
    const getDateString = (date: Date) => date.toISOString().split('T')[0];

    const findPriceAtDate = (targetDate: Date): number | null => {
      const targetStr = getDateString(targetDate);
      for (let i = prices.length - 1; i >= 0; i--) {
        if (prices[i].date <= targetStr) {
          return prices[i].close;
        }
      }
      return prices[0]?.close || null;
    };

    const calcReturn = (oldPrice: number | null): number | null => {
      if (!oldPrice || oldPrice === 0) return null;
      return ((latestPrice - oldPrice) / oldPrice) * 100;
    };

    const oneDayAgo = new Date(now);
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    const oneWeekAgo = new Date(now);
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const oneMonthAgo = new Date(now);
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const threeMonthsAgo = new Date(now);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const ytdDate = new Date(now.getFullYear(), 0, 1);

    return {
      day: calcReturn(findPriceAtDate(oneDayAgo)),
      week: calcReturn(findPriceAtDate(oneWeekAgo)),
      month: calcReturn(findPriceAtDate(oneMonthAgo)),
      threeMonth: calcReturn(findPriceAtDate(threeMonthsAgo)),
      sixMonth: calcReturn(findPriceAtDate(sixMonthsAgo)),
      ytd: calcReturn(findPriceAtDate(ytdDate)),
      year: calcReturn(findPriceAtDate(oneYearAgo)),
      latestPrice,
    };
  }, [prices]);

  if (!performanceReturns) return null;

  const periods = [
    { label: '1D', value: performanceReturns.day },
    { label: '1W', value: performanceReturns.week },
    { label: '1M', value: performanceReturns.month },
    { label: '3M', value: performanceReturns.threeMonth },
    { label: '6M', value: performanceReturns.sixMonth },
    { label: 'YTD', value: performanceReturns.ytd },
    { label: '1Y', value: performanceReturns.year },
  ];

  return (
    <div className="mt-6 pt-5 border-t border-rule-light">
      <div className="grid grid-cols-4 md:grid-cols-7 gap-3">
        {periods.map(({ label, value }) => (
          <div key={label} className="text-center">
            <div className="text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-muted mb-1">
              {label}
            </div>
            <div
              className={`text-sm font-bold ${
                value === null ? 'text-ink-muted' : value >= 0 ? 'text-green' : 'text-red'
              }`}
            >
              {value === null ? '-' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
