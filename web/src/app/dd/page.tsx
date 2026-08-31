import { DDIndex } from './DDIndex';
import { DDAreaNav } from '@/components/nav/AreaSubNav';

export const metadata = {
  title: 'Due Diligence',
  description:
    'Deep due-diligence reports on the names your screen surfaced — moat, financial-quality, valuation/expectations, catalysts, and a 1–6 buy rating per name.',
};

export default function DDPage() {
  return (
    <>
      <DDAreaNav />
      <DDIndex />
    </>
  );
}
