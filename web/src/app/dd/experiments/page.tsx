import { ExperimentsBrowser } from './ExperimentsBrowser';
import { DDAreaNav } from '@/components/nav/AreaSubNav';

export const metadata = {
  title: 'Experiments',
  description:
    'Research experiments log — hypothesis, falsification criteria, method, and verdict for each run.',
};

export default function ExperimentsPage() {
  return (
    <>
      <DDAreaNav />
      <ExperimentsBrowser />
    </>
  );
}
