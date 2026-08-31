import { SpinnerIcon } from './icons';

// Inline spinner for use within buttons or other elements
export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return <SpinnerIcon className={className} />;
}
