// Board preview — single metadata line. Card count + last-update.

import { relativeTimeShort } from '../../lib/relativeTime.js';

export function previewMini(row) {
  const when = row?.updated_at ? relativeTimeShort(row.updated_at) : '';
  return (
    <div className="ent-prev-meta">
      {when && <span>· {when}</span>}
    </div>
  );
}

export const previewFull = previewMini;
