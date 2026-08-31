'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Spinner } from '@/components/Loading';
import { DDReportView } from '@/components/dd/DDReportView';
import { type DDReport } from '@/components/dd/types';

async function fetchReport(id: string): Promise<DDReport> {
  const res = await fetch(`/api/dd?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load DD ${id}: ${res.status}`);
  return res.json();
}

export default function DDReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const ddId = decodeURIComponent(id);

  const { data: r, isLoading, error } = useQuery({
    queryKey: ['dd', ddId],
    queryFn: () => fetchReport(ddId),
    staleTime: 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="max-w-[1000px] mx-auto px-5 py-16 flex items-center justify-center">
        <Spinner className="h-6 w-6 text-green" />
        <span className="ml-3 text-ink-light">Loading DD…</span>
      </div>
    );
  }

  if (error || !r) {
    return (
      <div className="max-w-[1000px] mx-auto px-5 py-10">
        <Card>
          <EmptyState iconName="x-circle" title="DD not found" description={`No DD report for "${ddId}".`} />
        </Card>
        <div className="mt-4">
          <Link href="/dd" className="text-sm text-green hover:text-green-dark">← All DD reports</Link>
        </div>
      </div>
    );
  }

  return <DDReportView report={r} />;
}
