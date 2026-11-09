// Whether the browser says it is online (navigator.onLine), live.

import { useSyncExternalStore } from 'react';

const subscribe = (fn) => {
  window.addEventListener('online', fn);
  window.addEventListener('offline', fn);
  return () => {
    window.removeEventListener('online', fn);
    window.removeEventListener('offline', fn);
  };
};

export function useOnline() {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine !== false,
    () => true,
  );
}
