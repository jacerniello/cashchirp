'use client';

import { useState, useCallback } from 'react';

interface ExportButtonProps {
  /** Called when export button is clicked */
  onExport: () => Promise<void>;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Button to export a chart as PNG
 * Shows "Export" text with download icon and loading state during export
 */
export function ExportButton({ onExport, className = '' }: ExportButtonProps) {
  const [isExporting, setIsExporting] = useState(false);

  const handleClick = useCallback(async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      await onExport();
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setIsExporting(false);
    }
  }, [onExport, isExporting]);

  return (
    <button
      onClick={handleClick}
      disabled={isExporting}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-ink text-white hover:bg-ink-light transition-colors disabled:opacity-50 ${className}`}
      title="Export as PNG"
      aria-label="Export chart as PNG"
    >
      {isExporting ? (
        <svg
          className="w-3.5 h-3.5 animate-spin"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      ) : (
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        </svg>
      )}
      <span>{isExporting ? 'Exporting...' : 'Export'}</span>
    </button>
  );
}
