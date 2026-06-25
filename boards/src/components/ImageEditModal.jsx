// Full-screen photo editor. Reached from the compact popover's "Full screen"
// button. A dedicated modal (NOT an ImageLightbox mode) because the lightbox
// uses style.transform on its <img> for pan/zoom, which would collide with the
// flip transform. Here there's no pan/zoom — just a fit-to-screen live preview
// beside the shared ImageAdjustPanel, with hold-to-compare against the original.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { R2Image } from './R2Image.jsx';
import { ImageAdjustPanel } from './ImageAdjustPanel.jsx';
import { Icon } from './Icon.jsx';
import { X } from '../lib/icons.js';
import { buildImgStyle, isAdjusted } from '../lib/imageAdjust.js';

export function ImageEditModal({ src, title, adjust, cardId, onChange, onReset, onDownload, onClose }) {
  const [comparing, setComparing] = useState(false);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const canCompare = isAdjusted(adjust);
  const imgStyle = comparing ? undefined : buildImgStyle(adjust, cardId);

  const node = (
    <div className="iem" role="dialog" aria-label="Edit photo"
         onPointerDown={(e) => {
           if (!e.target.closest('.iem-img') && !e.target.closest('.iem-rail')) onClose?.();
         }}>
      <button className="iem-x" aria-label="Close" onClick={onClose}><Icon as={X} size={18} /></button>
      <div className="iem-stage">
        {src
          ? <R2Image className="iem-img" src={src} alt={title || ''} eager draggable="false" style={imgStyle} />
          : null}
        {comparing && <div className="iem-compare-tag">Original</div>}
      </div>
      <div className="iem-rail">
        <ImageAdjustPanel adjust={adjust} mode="full"
                          onChange={onChange} onReset={onReset}
                          onDownload={onDownload} onClose={onClose}
                          onCompareStart={canCompare ? () => setComparing(true) : null}
                          onCompareEnd={() => setComparing(false)} />
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(node, document.body) : node;
}

export default ImageEditModal;
