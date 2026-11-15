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
// onOpenGuide adds the menu's last item, "Bring files from another app…",
// which opens the import tray's guide (lib/importGuide.js); without it the
// menu ends on a line saying the same in short.

import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside.js';
import { fmtBytes } from '../../lib/storageLabel.js';
import { Icon } from '../Icon.jsx';
import { Upload, FolderOpen, FileZip, CloudArrowDown } from '../../lib/icons.js';
import { noteSessionCounter } from '../../lib/analytics.js';
import { t, ph } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

const NEAR = 0.9;

// Splits "1.2 GB" at its last space (a no-break one in es, fr, pt-BR and ru);
// "1 024 Mo" keeps "1 024" as its number.
const splitUnit = (s) => { const m = /^(.*\S)\s+(\S+)$/u.exec(s); return m ? [m[1], m[2]] : [s]; };

// "1.2 of 5.0 GB" when both are in one unit, so the line fits a narrow column.
function storageText(used, quota) {
  const u = fmtBytes(used);
  const q = fmtBytes(quota);
  const [n, unit] = splitUnit(u);
  return unit && unit === splitUnit(q)[1] ? t`${n} of ${q}` : t`${u} of ${q}`;
}

export function SidebarMeter({
  isPaid = false, cardsUsed = 0, cardLimit = null, storage = null,
  onOpenPlan, onUpload, onUploadFolder, onUploadZips, onOpenGuide = null, uploadTitle = t`Upload files`,
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
  // Each way in is counted on the session's summary (files.upload_*): the
  // picker opening, and whether something was chosen in it. What happens to
  // the files is the upload's and the import's own events.
  const pick = (ref, what) => {
    noteSessionCounter(`files.upload_${what}`);
    const el = ref.current; setOpen(false); if (el) { el.value = ''; el.click(); }
  };
  const chosen = (what, files, send) => {
    if (!files.length) return;
    noteSessionCounter(`files.upload_${what}_chosen`);
    send(files);
  };
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
    showCards ? t`${used} of ${cardLimit} cards` : null,
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
          <button type="button" className="sbf-meter-text" onClick={() => { noteSessionCounter('files.meter_plan'); onOpenPlan?.(); }}
                  title={t`Plan and storage`} aria-label={t`Plan and storage: ${ph({ join: parts.join(', ') })}`}>
            {parts.join(' · ')}
          </button>
        )}
        {onUpload && !hasMenu && (
          <>
            <button type="button" className="sbf-upload" title={uploadTitle}
                    onClick={() => pick(inputRef, 'files')}>
              <Icon as={Upload} size={14} weight="regular" />
              <Trans>Upload</Trans>
            </button>
            <input ref={inputRef} type="file" multiple hidden
                   onChange={(e) => chosen('files', [...(e.target.files || [])], onUpload)} />
          </>
        )}
        {onUpload && hasMenu && (
          <div className="sbf-upload-wrap">
            <button type="button" ref={btnRef} className={'sbf-upload' + (open ? ' is-open' : '')} title={uploadTitle}
                    aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
              <Icon as={Upload} size={14} weight="regular" />
              <Trans>Upload</Trans>
            </button>
            {open && pos && createPortal(
              <div className="sbf-upmenu" role="menu" aria-label={t`Upload`} ref={menuRef} onKeyDown={onMenuKey} style={pos}>
                <button type="button" className="sbf-upitem" role="menuitem" onClick={() => pick(inputRef, 'files')}>
                  <Icon as={Upload} size={16} weight="regular" />
                  <span className="sbf-upitem-l"><b><Trans>Files…</Trans></b></span>
                </button>
                {canFolder && (
                  <button type="button" className="sbf-upitem" role="menuitem" onClick={() => pick(folderRef, 'folder')}>
                    <Icon as={FolderOpen} size={16} weight="regular" />
                    <span className="sbf-upitem-l"><b><Trans>A folder…</Trans></b><small><Trans>Its folders become clusters</Trans></small></span>
                  </button>
                )}
                {onUploadZips && (
                  <button type="button" className="sbf-upitem" role="menuitem" onClick={() => pick(zipRef, 'zips')}>
                    <Icon as={FileZip} size={16} weight="regular" />
                    <span className="sbf-upitem-l"><b><Trans>A zip or Google Takeout…</Trans></b><small><Trans>Each folder inside becomes a cluster</Trans></small></span>
                  </button>
                )}
                <div className="sbf-upsep" role="separator" />
                {onOpenGuide ? (
                  <button type="button" className="sbf-upitem" role="menuitem" onClick={() => { noteSessionCounter('files.upload_guide'); setOpen(false); onOpenGuide(); }}>
                    <Icon as={CloudArrowDown} size={16} weight="regular" />
                    <span className="sbf-upitem-l"><b><Trans>Bring files from another app…</Trans></b><small><Trans>Google Drive, Dropbox and more</Trans></small></span>
                  </button>
                ) : (
                  <div className="sbf-upnote"><Trans>Moving from Google Drive or Dropbox? Download it as a zip, or pick its folder on your computer.</Trans></div>
                )}
              </div>, document.body)}
            <input ref={inputRef} type="file" multiple hidden
                   onChange={(e) => chosen('files', [...(e.target.files || [])], onUpload)} />
            {canFolder && (
              <input ref={(el) => { folderRef.current = el; if (el) el.setAttribute('webkitdirectory', ''); }} type="file" multiple hidden
                     onChange={(e) => chosen('folder', [...(e.target.files || [])], onUploadFolder)} />
            )}
            {onUploadZips && (
              <input ref={zipRef} type="file" multiple hidden accept=".zip,application/zip,application/x-zip-compressed"
                     onChange={(e) => chosen('zips', [...(e.target.files || [])], onUploadZips)} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
