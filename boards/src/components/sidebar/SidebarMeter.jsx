// The foot of the sidebar: how much room is used, and a way to add files.
//
// The free plan stops at a card limit OR a storage limit, whichever comes
// first, so it shows both bars (owner, 2026-10-18: "both, stacked"); a paid
// plan has no card limit and shows storage alone. The numbers come from the
// same places the plan pill reads (useMyTier's count and limit, passed in so
// this never calls useMyTier itself, and useStorageUsage). Bars are neutral
// ink: gold is for active and selected things, and a meter is neither. Red
// only near full, as in Settings → Billing.

import { useRef } from 'react';
import { Icon } from '../Icon.jsx';
import { Upload } from '../../lib/icons.js';
import { fmtBytes } from '../../lib/storageLabel.js';

const NEAR = 0.9;

function Bar({ frac, label, value, title }) {
  const pct = Math.max(0, Math.min(100, (Number(frac) || 0) * 100));
  return (
    <div className="sbf-meter-row" title={title}>
      <div className="sbf-meter-text">
        <span className="sbf-meter-label">{label}</span>
        <span className="sbf-meter-value">{value}</span>
      </div>
      <div className="sbf-meter-track">
        <div className={`sbf-meter-fill${frac >= NEAR ? ' is-near' : ''}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function SidebarMeter({
  isPaid = false, cardsUsed = 0, cardLimit = null, storage = null,
  onOpenPlan, onUpload, uploadTitle = 'Upload files',
}) {
  const inputRef = useRef(null);
  const known = storage && !storage.loading && !storage.error && Number(storage.quota) > 0;
  const storageFrac = known ? Number(storage.used) / Number(storage.quota) : 0;
  const showCards = !isPaid && Number(cardLimit) > 0;
  const cardFrac = showCards ? (Number(cardsUsed) || 0) / Number(cardLimit) : 0;

  return (
    <div className="sbf-meter">
      <button type="button" className="sbf-meter-bars" onClick={onOpenPlan}
              title="Plan and storage" aria-label="Plan and storage">
        {showCards && (
          <Bar frac={cardFrac} label="Cards"
               value={`${Number(cardsUsed) || 0} of ${cardLimit}`}
               title={`${Number(cardsUsed) || 0} of ${cardLimit} cards on the free plan`} />
        )}
        {known && (
          <Bar frac={storageFrac} label="Storage"
               value={`${fmtBytes(storage.used)} of ${fmtBytes(storage.quota)}`}
               title={`${fmtBytes(storage.used)} of ${fmtBytes(storage.quota)} used`} />
        )}
      </button>
      {onUpload && (
        <>
          <button type="button" className="sbf-upload" title={uploadTitle}
                  onClick={() => { const el = inputRef.current; if (el) { el.value = ''; el.click(); } }}>
            <Icon as={Upload} size={14} />
            <span>Upload</span>
          </button>
          <input ref={inputRef} type="file" multiple hidden
                 onChange={(e) => { const files = [...(e.target.files || [])]; if (files.length) onUpload(files); }} />
        </>
      )}
    </div>
  );
}
