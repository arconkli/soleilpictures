// CopyableText — renders an email/id as click-to-copy with a "Copied"
// toast and a brief check-mark confirmation. Email is the identifier
// admins paste into Stripe/Supabase/support all day; this makes that a
// one-click action everywhere instead of a manual select-and-copy.
//
//   <CopyableText value={user.email} />
//   <CopyableText value={id} display={id.slice(0, 8)} />

import { useState } from 'react';
import { Icon } from './Icon.jsx';
import { Copy, Check } from '../lib/icons.js';
import { useFeedback } from './AppFeedback.jsx';

export function CopyableText({ value, display, className = '', title }) {
  const feedback = useFeedback();
  const [copied, setCopied] = useState(false);
  const text = value ?? display ?? '';

  const copy = async (e) => {
    e.stopPropagation();           // don't trigger row-level click handlers
    if (!text) return;
    try {
      await navigator.clipboard.writeText(String(text));
      setCopied(true);
      feedback.toast({ type: 'success', message: 'Copied' });
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      feedback.toast({ type: 'error', message: 'Copy failed' });
    }
  };

  return (
    <button
      type="button"
      className={`admin-copyable ${className}`}
      onClick={copy}
      title={title || (text ? `Copy ${text}` : 'Copy')}
      aria-label={text ? `Copy ${text}` : 'Copy'}
    >
      <span className="admin-copyable-text">{display ?? value}</span>
      <Icon as={copied ? Check : Copy} size={12} className="admin-copyable-icon" />
    </button>
  );
}
