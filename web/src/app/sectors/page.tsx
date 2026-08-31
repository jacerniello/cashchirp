import { SectorsBrowser } from './SectorsBrowser';

export const metadata = {
  title: 'Sectors',
  description:
    'The equity universe by GICS-style sector — size, breadth, and median valuation/quality — plus how the S&P 500’s sector mix has rotated over time.',
};

export default function SectorsPage() {
  return <SectorsBrowser />;
}
