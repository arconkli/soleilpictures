// AdminIssueBits — the small pieces the Issues view's list, detail and trail
// share (AdminErrorsTab, AdminIssueDetail, AdminIssueTrail).

import { useState } from 'react';
import { useFeedback } from '../../components/AppFeedback.jsx';
import { Icon } from '../../components/Icon.jsx';
import { severityLabel } from '../../lib/adminIssues.js';
import { Copy, Check } from '../../lib/icons.js';

// Icon-only copy. stopPropagation on keydown too: the problem rows treat Enter
// and Space as open.
export function CopyButton({ getText, title }) {
  const feedback = useFeedback();
  const [copied, setCopied] = useState(false);
  const copy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(getText());
      setCopied(true);
      feedback.toast({ type: 'success', message: 'Copied' });
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      feedback.toast({ type: 'error', code: 'admin_copy_failed', message: 'Copy failed' });
    }
  };
  return (
    <button type="button" className="admin-iconbtn" onClick={copy} onKeyDown={(e) => e.stopPropagation()}
            title={title} aria-label={title}>
      <Icon as={copied ? Check : Copy} size={14} />
    </button>
  );
}

// Crash, Error or Warning, in words: the colour never carries it alone.
export function SeverityBadge({ severity }) {
  const s = ['crash', 'error', 'warning'].includes(severity) ? severity : 'error';
  return <span className={`iss-badge iss-sev-${s}`}>{severityLabel(s)}</span>;
}
