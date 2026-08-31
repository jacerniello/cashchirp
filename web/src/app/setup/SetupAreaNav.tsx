'use client';

import { SubNav, type SubNavItem } from '@/components/nav/SubNav';

// Setup area: the overview reports, the two sub-pages act. Splitting run controls onto
// their own pages keeps the landing page a place you can look at safely — nothing on it
// starts a 38 GB download.
const ITEMS: SubNavItem[] = [
  { name: 'Overview', key: 'setup', url: '/setup' },
  { name: 'Ingest', key: 'ingest', url: '/setup/ingest' },
  { name: 'Derived', key: 'derived', url: '/setup/derived' },
];

export function SetupAreaNav() {
  return <SubNav items={ITEMS} baseUrl="/setup" variant="tools" homeKey="setup" />;
}
