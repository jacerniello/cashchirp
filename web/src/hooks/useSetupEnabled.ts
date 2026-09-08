'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';

// Does this deployment serve the setup surface?
//
// The answer is whether GET /setup/enabled exists at all: main.py mounts the setup router
// only when SETUP_ENABLED is on, so a disabled deployment 404s. One setting on the API
// therefore governs both the routes and the nav link, instead of the frontend carrying its
// own NEXT_PUBLIC_ copy that could drift out of step with it.
//
// Deliberately NOT react-query: this is called from Navbar, which the root layout renders
// OUTSIDE <Providers>, so there is no QueryClient in scope there. A plain fetch keeps the
// navbar independent of where the provider happens to sit.

// Module-level, so a remount doesn't re-ask. It cannot change without an API restart.
let cached: boolean | undefined;

export function useSetupEnabled(): boolean {
  const [enabled, setEnabled] = useState(cached ?? false);

  useEffect(() => {
    if (cached !== undefined) return;
    let live = true;
    api.get('/setup/enabled')
      .then(() => { cached = true; if (live) setEnabled(true); })
      // 404 (not mounted) or the API is down — either way, don't advertise the route.
      .catch(() => { cached = false; if (live) setEnabled(false); });
    return () => { live = false; };
  }, []);

  return enabled;
}
