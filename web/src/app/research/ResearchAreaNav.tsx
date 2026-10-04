'use client';

import { SubNav, type SubNavItem } from '@/components/nav/SubNav';

// Research area: analysis runs (reports), the latest view per stock (rankings), how you have grouped it, and
// free-form notes. Snapshots (frozen screener results) live under the Screener area.
const ITEMS: SubNavItem[] = [
  { name: 'Reports', key: 'reports', url: '/research/reports' },
  { name: 'Rankings', key: 'research', url: '/research' },
  { name: 'Groups', key: 'groups', url: '/research/groups' },
  { name: 'Notes', key: 'notes', url: '/research/notes' },
];

export function ResearchAreaNav() {
  return <SubNav items={ITEMS} baseUrl="/research" variant="tools" homeKey="research" />;
}
