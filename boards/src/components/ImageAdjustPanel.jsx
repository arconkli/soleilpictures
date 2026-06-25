// Shared photo-adjustment controls. Pure & presentational — it owns no Yjs or
// portal knowledge; the host (compact popover or full-screen modal) wires
// onChange/onReset/onDownload/onExpand to the canvas mutators.
//
//   <ImageAdjustPanel
//      adjust={card.adjust}
//      onChange={(next) => updateCard(id, { adjust: next })}
//      onReset={() => updateCard(id, { adjust: null })}
//      onDownload={() => downloadImage({ ... })}
//      onExpand={() => openFullScreen()}   // compact mode only
//      mode="compact" | "full" />

import { useState } from 'react';
import { Icon } from './Icon.jsx';
import {
  Download, RotateCcw, Maximize2, X,
  FlipHorizontal, FlipVertical, CircleHalf, Sun, Thermometer, Sparkle,
} from '../lib/icons.js';
import { isAdjusted } from '../lib/imageAdjust.js';

const SLIDERS = [
  { key: 'brightness', label: 'Brightness', min: 0,    max: 200, neutral: 100, icon: Sun,         suffix: '%' },
  { key: 'contrast',   label: 'Contrast',   min: 0,    max: 200, neutral: 100, icon: CircleHalf,  suffix: '%' },
  { key: 'saturation', label: 'Saturation', min: 0,    max: 200, neutral: 100, icon: Sparkle,     suffix: '%' },
  { key: 'warmth',     label: 'Warmth',     min: -100, max: 100, neutral: 0,   icon: Thermometer, suffix: '' },
  { key: 'sharpen',    label: 'Sharpness',  min: 0,    max: 3,   neutral: 0,   step: 1, icon: null, suffix: '' },
];

export function ImageAdjustPanel({ adjust, onChange, onReset, onDownload, onExpand, onClose, mode = 'compact' }) {
  const [downloading, setDownloading] = useState(false);
  const a = adjust || {};
  const val = (key, neutral) => (a[key] == null ? neutral : Number(a[key]));
  const dirty = isAdjusted(a);

  const setField = (key, value) => onChange?.({ ...a, [key]: value });
  const toggle = (key) => onChange?.({ ...a, [key]: !a[key] });

  const doDownload = async () => {
    if (downloading || !onDownload) return;
    setDownloading(true);
    try { await onDownload(); } finally { setDownloading(false); }
  };

  const fmtVal = (s) => {
    const v = val(s.key, s.neutral);
    if (s.key === 'sharpen') return ['Off', 'Low', 'Med', 'High'][v] || String(v);
    if (s.key === 'warmth') return v === 0 ? 'Neutral' : (v > 0 ? `Warm ${v}` : `Cool ${-v}`);
    return `${v}${s.suffix}`;
  };

  return (
    <div className={`iap iap-${mode}`}>
      <div className="iap-head">
        <span className="iap-title">Edit photo</span>
        <div className="iap-head-actions">
          {mode === 'compact' && onExpand && (
            <button type="button" className="iap-iconbtn" title="Full screen" onClick={onExpand}>
              <Icon as={Maximize2} size={15} />
            </button>
          )}
          {mode === 'full' && onClose && (
            <button type="button" className="iap-iconbtn" title="Done" onClick={onClose}>
              <Icon as={X} size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="iap-flips">
        <button type="button" className={`iap-toggle ${a.flipH ? 'is-on' : ''}`}
                onClick={() => toggle('flipH')} title="Flip horizontal">
          <Icon as={FlipHorizontal} size={16} /><span>Flip H</span>
        </button>
        <button type="button" className={`iap-toggle ${a.flipV ? 'is-on' : ''}`}
                onClick={() => toggle('flipV')} title="Flip vertical">
          <Icon as={FlipVertical} size={16} /><span>Flip V</span>
        </button>
        <button type="button" className={`iap-toggle ${a.grayscale ? 'is-on' : ''}`}
                onClick={() => toggle('grayscale')} title="Black & white">
          <span className="iap-bw">B/W</span>
        </button>
      </div>

      <div className="iap-sliders">
        {SLIDERS.map((s) => (
          <label key={s.key} className="iap-row">
            <span className="iap-rowtop">
              <span className="iap-label">{s.label}</span>
              <span className="iap-val">{fmtVal(s)}</span>
            </span>
            <input type="range" className="iap-slider"
                   min={s.min} max={s.max} step={s.step || 1}
                   value={val(s.key, s.neutral)}
                   onChange={(e) => setField(s.key, Number(e.target.value))}
                   onDoubleClick={() => setField(s.key, s.neutral)} />
          </label>
        ))}
      </div>

      <div className="iap-foot">
        <button type="button" className="iap-btn" disabled={!dirty} onClick={onReset}>
          <Icon as={RotateCcw} size={14} /><span>Reset</span>
        </button>
        <button type="button" className="iap-btn iap-btn-primary" disabled={downloading} onClick={doDownload}>
          <Icon as={Download} size={14} /><span>{downloading ? 'Saving…' : 'Download'}</span>
        </button>
      </div>
    </div>
  );
}

export default ImageAdjustPanel;
