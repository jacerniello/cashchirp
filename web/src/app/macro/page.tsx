import { MacroBrowser } from './MacroBrowser';
import { MacroAreaNav } from '@/components/nav/AreaSubNav';

export const metadata = {
  title: 'Macro (FRED)',
  description:
    'Point-in-time macro series from the FRED-MD / FRED-QD panels. Browse the catalogue and chart any series.',
};

export default function MacroPage() {
  return (
    <>
      <MacroAreaNav />
      <MacroBrowser
        title="Macro (FRED)"
        subtitle="Point-in-time macro series from the FRED-MD / FRED-QD panels. Search the catalogue and chart any series."
        excludeDatasets={['FRED-Spot']}
        emptyMessage="Pick a series from the list to chart its history."
        showVintages
        chartCaption="FRED-MD/QD observations are point-in-time: leave the vintage on “latest” for the most-revised view, or pin a release to see exactly what was published then (backtest-safe)."
      />
    </>
  );
}
