import { useMinuteNow } from '../hooks/useMinuteNow.js';
import { formatRelTime } from '../lib/relTime.js';

// A relative time ("5m ago") that moves on by itself, so whatever it sits in
// doesn't have to re-render for it.
export function RelTime({ iso, suffix = '', ...props }) {
  const now = useMinuteNow();
  return <time dateTime={iso} {...props}>{formatRelTime(iso, now)}{suffix}</time>;
}
