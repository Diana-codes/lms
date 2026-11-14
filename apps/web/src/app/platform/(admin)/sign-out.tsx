'use client';

import { useState } from 'react';
import { api } from '@/lib/api';

export function PlatformSignOut() {
  const [leaving, setLeaving] = useState(false);
  async function signOut() {
    setLeaving(true);
    try {
      await api('/platform/auth/logout', { method: 'POST', retryOnUnauthorized: false });
    } catch {
      // Already signed out, or offline.
    }
    window.location.assign('/platform/login');
  }
  return (
    <button
      type="button"
      onClick={signOut}
      disabled={leaving}
      className="min-h-11 cursor-pointer rounded-control border border-white/30 bg-transparent px-3 text-sm text-white hover:bg-white/10"
    >
      {leaving ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
