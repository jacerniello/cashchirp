'use client';

/**
 * Common reusable hooks
 * Consolidates repeated patterns like click-outside, debouncing, toggles
 */

import { useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore, type RefObject } from 'react';

// ============================================================================
// useDisclosure (alternative to useToggle with named actions)
// ============================================================================

interface UseDisclosureReturn {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

// ============================================================================
// useKeyPress
// ============================================================================

/**
 * Hook that listens for a specific key press
 * Useful for keyboard shortcuts
 *
 * @example
 * ```tsx
 * useKeyPress('Escape', () => setIsOpen(false));
 * useKeyPress('k', () => setSearchOpen(true), { metaKey: true }); // Cmd+K
 * ```
 */
export function useKeyPress(
  targetKey: string,
  handler: (event: KeyboardEvent) => void,
  options?: {
    metaKey?: boolean;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    enabled?: boolean;
  }
): void {
  const { metaKey, ctrlKey, shiftKey, altKey, enabled = true } = options || {};

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(event: KeyboardEvent) {
      // Check if key matches
      if (event.key !== targetKey) return;

      // Check modifier keys
      if (metaKey !== undefined && event.metaKey !== metaKey) return;
      if (ctrlKey !== undefined && event.ctrlKey !== ctrlKey) return;
      if (shiftKey !== undefined && event.shiftKey !== shiftKey) return;
      if (altKey !== undefined && event.altKey !== altKey) return;

      handler(event);
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [targetKey, handler, metaKey, ctrlKey, shiftKey, altKey, enabled]);
}
