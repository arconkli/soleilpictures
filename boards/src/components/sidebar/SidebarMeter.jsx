// The foot of the sidebar: how much room is used, and a way to add files.
//
// One quiet line (owner, 2026-10-18: the sidebar had too much going on). The
// free plan stops at a card limit OR a storage limit, whichever comes first,
// so the line names both, "38 of 50 cards · 1.2 of 5.0 GB"; a paid plan has
// no card limit and names storage alone. The bar is the foot's own top edge,
// filled as far as whichever limit is closer to full. The numbers come from
// the same places the plan pill reads (useMyTier's count and limit, passed in
// so this never calls useMyTier itself, and useStorageUsage). The bar is
// neutral ink: gold is for active and selected things, and a meter is
// neither. Red only near full, as in Settings → Billing.

import { useRef } from 'react';
import { fmtBytes } from '../../lib/storageLabel.js';

const NEAR = 0.9;

// "1.2 of 5.0 GB" when both are in one unit, so the line fits a narrow column.
function storageText(used, quota) {
  const u = fmtBytes(used);
  const q = fmtBytes(quota);
  const [n, unit] = u.split(' ');
  return unit && unit === q.split(' ')[1] ? `${n} of ${q}` : `${u} of ${q}`;
}

export function SidebarMeter({
  isPaid = false, cardsUsed = 0, cardLimit = null, storage = null,
  onOpenPlan, onUpload, uploadTitle = 'Upload files',
}) {
  const inputRef = useRef(null);
  const known = storage && !storage.loading && !storage.error && Number(storage.quota) > 0;
  const storageFrac = known ? Number(storage.used) / Number(storage.quota) : 0;
  const showCards = !isPaid && Number(cardLimit) > 0;
  const used = Number(cardsUsed) || 0;
  const cardFrac = showCards ? used / Number(cardLimit) : 0;
  const parts = [
    showCards ? `${used} of ${cardLimit} cards` : null,
    known ? storageText(storage.used, storage.quota) : null,
  ].filter(Boolean);
  const frac = Math.max(cardFrac, storageFrac);
  const pct = Math.max(0, Math.min(100, frac * 100));

  return (
    <div className="sbf-meter">
      <div className="sbf-meter-track" aria-hidden="true">
        {parts.length > 0 && <div className={`sbf-meter-fill${frac >= NEAR ? ' is-near' : ''}`} style={{ width: `${pct}%` }} />}
      </div>
      <div className="sbf-meter-line">
        {parts.length > 0 && (
          <button type="button" className="sbf-meter-text" onClick={onOpenPlan}
                  title="Plan and storage" aria-label={`Plan and storage: ${parts.join(', ')}`}>
            {parts.join(' · ')}
          </button>
        )}
        {onUpload && (
          <>
            <button type="button" className="sbf-upload" title={uploadTitle}
                    onClick={() => { const el = inputRef.current; if (el) { el.value = ''; el.click(); } }}>
              Upload
            </button>
            <input ref={inputRef} type="file" multiple hidden
                   onChange={(e) => { const files = [...(e.target.files || [])]; if (files.length) onUpload(files); }} />
          </>
        )}
      </div>
    </div>
  );
}
