// The foot of the files' card: how much room is used, and a way to add files.
//
// A 4px bar over one line (owner, 2026-10-18, the floating mockup they
// picked). The free plan stops at a card limit OR a storage limit, whichever
// comes first, so the line names both, "38 of 50 cards · 1.2 of 5.0 GB"; a
// paid plan has no card limit and names storage alone. The bar fills as far
// as whichever limit is closer to full. The numbers come from the same places
// the plan pill reads (useMyTier's count and limit, passed in so this never
// calls useMyTier itself, and useStorageUsage). The bar is neutral ink: gold
// is for active and selected things, and a meter is neither. Red only near
// full, as in Settings → Billing.
//
// Upload opens a menu (files, a folder, zips) when onUploadFolder or
// onUploadZips is given; with neither it opens the file picker directly.

import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside.js';
import { fmtBytes } from '../../lib/storageLabel.js';
import { Icon } from '../Icon.jsx';
import { Upload, FolderOpen, FileZip } from '../../lib/icons.js';

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
  onOpenPlan, onUpload, onUploadFolder, onUploadZips, uploadTitle = 'Upload files',
}) {
  const inputRef = useRef(null);
  const folderRef = useRef(null);
  const zipRef = useRef(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const wrapRef = useRef(null);
  const [open, setOpen] = useState(false);
  const hasMenu = !!(onUploadFolder || onUploadZips);
  const canFolder = !!onUploadFolder && typeof document !== 'undefined' && 'webkitdirectory' in document.createElement('input');
  const close = (refocus) => { setOpen(false); if (refocus) btnRef.current?.focus(); };
  useDismissOnOutside(wrapRef, open, () => close(true), { ignore: '.sbf-upmenu' });
  // The menu is portaled (the files card clips overflow, and folds), so it is
  // placed from the meter's box when it opens and closes if anything moves.
  const [pos, setPos] = useState(null);
  const toggle = () => {
    if (open) { setOpen(false); return; }
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left + 8, width: r.width - 16, bottom: window.innerHeight - r.top + 6 });
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return undefined;
    const shut = () => setOpen(false);
    window.addEventListener('resize', shut);
    window.addEventListener('scroll', shut, true);
    return () => { window.removeEventListener('resize', shut); window.removeEventListener('scroll', shut, true); };
  }, [open]);
  useEffect(() => { if (open) menuRef.current?.querySelector('[role="menuitem"]')?.focus(); }, [open]);
  const pick = (ref) => { const el = ref.current; setOpen(false); if (el) { el.value = ''; el.click(); } };
  const onMenuKey = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...menuRef.current.querySelectorAll('[role="menuitem"]')];
    const i = items.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next]?.focus();
    e.preventDefault();
  };
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
    <div className="sbf-meter" ref={wrapRef}>
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
        {onUpload && !hasMenu && (
          <>
            <button type="button" className="sbf-upload" title={uploadTitle}
                    onClick={() => { const el = inputRef.current; if (el) { el.value = ''; el.click(); } }}>
              <Icon as={Upload} size={14} weight="regular" />
              Upload
            </button>
            <input ref={inputRef} type="file" multiple hidden
                   onChange={(e) => { const files = [...(e.target.files || [])]; if (files.length) onUpload(files); }} />
          </>
        )}
        {onUpload && hasMenu && (
          <div className="sbf-upload-wrap">
            <button type="button" ref={btnRef} className={'sbf-upload' + (open ? ' is-open' : '')} title={uploadTitle}
                    aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
              <Icon as={Upload} size={14} weight="regular" />
              Upload
            </button>
            {open && pos && createPortal(
              <div className="sbf-upmenu" role="menu" aria-label="Upload" ref={menuRef} onKeyDown={onMenuKey} style={pos}>
                <button type="button" className="sbf-upitem" role="menuitem" onClick={() => pick(inputRef)}>
                  <Icon as={Upload} size={16} weight="regular" />
                  <span className="sbf-upitem-l"><b>Files…</b></span>
                </button>
                {canFolder && (
                  <button type="button" className="sbf-upitem" role="menuitem" onClick={() => pick(folderRef)}>
                    <Icon as={FolderOpen} size={16} weight="regular" />
                    <span className="sbf-upitem-l"><b>A folder…</b><small>Its folders become clusters</small></span>
                  </button>
                )}
                {onUploadZips && (
                  <button type="button" className="sbf-upitem" role="menuitem" onClick={() => pick(zipRef)}>
                    <Icon as={FileZip} size={16} weight="regular" />
                    <span className="sbf-upitem-l"><b>A zip or Google Takeout…</b><small>Each folder inside becomes a cluster</small></span>
                  </button>
                )}
                <div className="sbf-upsep" role="separator" />
                <div className="sbf-upnote">Moving from Google Drive or Dropbox? Download it as a zip, or pick its folder on your computer.</div>
              </div>, document.body)}
            <input ref={inputRef} type="file" multiple hidden
                   onChange={(e) => { const files = [...(e.target.files || [])]; if (files.length) onUpload(files); }} />
            {canFolder && (
              <input ref={(el) => { folderRef.current = el; if (el) el.setAttribute('webkitdirectory', ''); }} type="file" multiple hidden
                     onChange={(e) => { const files = [...(e.target.files || [])]; if (files.length) onUploadFolder(files); }} />
            )}
            {onUploadZips && (
              <input ref={zipRef} type="file" multiple hidden accept=".zip,application/zip,application/x-zip-compressed"
                     onChange={(e) => { const files = [...(e.target.files || [])]; if (files.length) onUploadZips(files); }} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
