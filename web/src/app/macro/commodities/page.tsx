import { CommoditiesBrowser } from './CommoditiesBrowser';
import { MacroAreaNav } from '@/components/nav/AreaSubNav';

export const metadata = {
  title: 'Commodities',
  description:
    'Major commodity ETFs from the Sharadar fund-price mirror (sfp): rebased relative-performance compare, ' +
    'per-name candlestick detail, ETF-vs-FRED-spot drag, and the curated universe.',
};

export default function CommoditiesPage() {
  return (
    <>
      <MacroAreaNav />
      <CommoditiesBrowser />
    </>
  );
}
