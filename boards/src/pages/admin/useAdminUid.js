// useAdminUid — whose last-visit numbers these are (lib/adminSnapshot.js keys
// every snapshot by account). null means nothing is kept.

import { useAuth } from '../../auth/AuthGate.jsx';
import { isAdminPreviewMode } from '../../lib/localMode.js';

export function useAdminUid() {
  const { user } = useAuth();
  if (user?.id) return user.id;
  // The preview harness has no account. It keeps its fixtures under a name of
  // its own, so the last-visit paint can be looked at there too. Behind the
  // literal DEV guard, so a production build drops it.
  if (import.meta.env.DEV && isAdminPreviewMode()) return 'preview';
  return null;
}
