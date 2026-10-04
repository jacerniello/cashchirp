import { redirect } from 'next/navigation';

// Snapshots moved to /screener/snapshots/<id>; this keeps old links working.
export default async function SnapshotMoved({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let raw = id;
  try {
    raw = decodeURIComponent(id);
  } catch {
    /* already decoded */
  }
  redirect(`/screener/snapshots/${encodeURIComponent(raw)}`);
}
