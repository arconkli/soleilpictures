// Full-screen photo editor. Reached from the compact popover's "Full screen"
// button. A dedicated modal (NOT an ImageLightbox mode) because the lightbox
// uses style.transform on its <img> for pan/zoom, which would collide with the
// flip transform. Here there's no pan/zoom — just a fit-to-screen live preview
// beside the shared ImageAdjustPanel, with hold-to-compare against the original.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { R2Image } from './R2Image.jsx';
import { ImageAdjustPanel } from './ImageAdjustPanel.jsx';
import { Icon } from './Icon.jsx';
import { X, Download } from '../lib/icons.js';
import { buildImgStyle, isAdjusted } from '../lib/imageAdjust.js';
import { registerModalOpen } from '../lib/modalGuard.js';

// The portal still bubbles through the React tree: a press or double-click on
// the image or the rail reached the card that opened the editor and dragged it.
const stopBubble = (e) => e.stopPropagation();

export function ImageEditModal({ src, title, adjust, cardId, onChange, onReset, onDownload, onClose }) {
  const [comparing, setComparing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Registered with lib/modalGuard so the canvas shortcuts (Backspace, D, ⌘D…)
  // stand down while the editor is up, and Escape closes only the top layer.
  useEffect(() => registerModalOpen({ onEscape: () => { onCloseRef.current?.(); return true; } }), []);

  const canCompare = isAdjusted(adjust);
  const imgStyle = comparing ? undefined : buildImgStyle(adjust, cardId);

  const doDownload = async () => {
    if (downloading || !onDownload) return;
    setDownloading(true);
    try { await onDownload(); } finally { setDownloading(false); }
  };

  const node = (
    <div className="iem" role="dialog" aria-label="Edit photo"
         onPointerDown={(e) => {
           e.stopPropagation();
           if (!e.target.closest('.iem-img') && !e.target.closest('.iem-rail') && !e.target.closest('.iem-download')) onClose?.();
         }}
         onMouseDown={stopBubble} onDoubleClick={stopBubble} onContextMenu={stopBubble}>
      <button className="iem-x" aria-label="Close" onClick={onClose}><Icon as={X} size={18} /></button>
      <div className="iem-stage">
        {src
          ? <R2Image className="iem-img" src={src} alt={title || ''} eager draggable="false" style={imgStyle} />
          : null}
        {/* Single download, at the image's top-right (mirrors the image card's
            top-right download button — one consistent place). */}
        <button className="iem-download" aria-label="Download" title="Download"
                disabled={downloading} onClick={doDownload}><Icon as={Download} size={18} /></button>
        {comparing && <div className="iem-compare-tag">Original</div>}
      </div>
      <div className="iem-rail">
        <ImageAdjustPanel adjust={adjust} mode="full"
                          onChange={onChange} onReset={onReset} onClose={onClose}
                          onCompareStart={canCompare ? () => setComparing(true) : null}
                          onCompareEnd={() => setComparing(false)} />
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(node, document.body) : node;
}

export default ImageEditModal;
