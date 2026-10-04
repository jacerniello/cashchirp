'use client';

import { SubNav, type SubNavItem } from '@/components/nav/SubNav';

// Research area: what you have researched (rankings), how you have grouped it, and
// free-form notes. Snapshots (frozen screener results) live under the Screener area.
const ITEMS: SubNavItem[] = [
  { name: 'Rankings', key: 'research', url: '/research' },
  { name: 'Groups', key: 'groups', url: '/research/groups' },
  { name: 'Notes', key: 'notes', url: '/research/notes' },
];

export function ResearchAreaNav() {
  return <SubNav items={ITEMS} baseUrl="/research" variant="tools" homeKey="research" />;
}
