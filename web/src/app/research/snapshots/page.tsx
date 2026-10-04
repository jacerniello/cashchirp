import { redirect } from 'next/navigation';

// Snapshots moved into the Screener area (they are frozen screener results). Kept as a
// redirect so old links and bookmarks still land.
export default function SnapshotsMoved() {
  redirect('/screener/snapshots');
}
