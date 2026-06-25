// Shared photo-adjustment controls. Pure & presentational — it owns no Yjs or
// portal knowledge; the host (compact popover or full-screen modal) wires
// onChange/onReset/onDownload/onExpand/onCompare* to the canvas mutators.
//
//   <ImageAdjustPanel
//      adjust={card.adjust}
//      onChange={(next) => updateCard(id, { adjust: next })}
//      onReset={() => updateCard(id, { adjust: null })}
//      onDownload={() => downloadImage({ ... })}
//      onExpand={() => openFullScreen()}            // compact mode only
//      onCompareStart={...} onCompareEnd={...}      // hold-to-compare original
//      mode="compact" | "full" />

import { useState } from 'react';
import { Icon } from './Icon.jsx';
import {
  Download, RotateCcw, Maximize2, X, Eye,
  FlipHorizontal, FlipVertical, CircleHalf, Sun, Thermometer, Sparkle, Triangle,
} from '../lib/icons.js';
import { isAdjusted } from '../lib/imageAdjust.js';

const SLIDERS = [
  { key: 'brightness', label: 'Brightness', min: 0,    max: 200, neutral: 100, icon: Sun,         fmt: 'pct' },
  { key: 'contrast',   label: 'Contrast',   min: 0,    max: 200, neutral: 100, icon: CircleHalf,  fmt: 'pct' },
  { key: 'saturation', label: 'Saturation', min: 0,    max: 200, neutral: 100, icon: Sparkle,     fmt: 'pct' },
  { key: 'warmth',     label: 'Warmth',     min: -100, max: 100, neutral: 0,   icon: Thermometer, fmt: 'warmth', warmth: true },
  { key: 'sharpen',    label: 'Sharpness',  min: 0,    max: 3,   neutral: 0,   icon: Triangle,    fmt: 'sharpen', step: 1 },
];

const pct = (v, min, max) => ((v - min) / (max - min)) * 100;

export function ImageAdjustPanel({ adjust, onChange, onReset, onDownload, onExpand, onClose,
                                   onCompareStart, onCompareEnd, mode = 'compact' }) {
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

  const fmtVal = (s, v) => {
    if (s.fmt === 'sharpen') return ['Off', 'Low', 'Med', 'High'][v] || String(v);
    if (s.fmt === 'warmth') return v === 0 ? 'Neutral' : (v > 0 ? `Warm ${v}` : `Cool ${-v}`);
    return `${v}%`;
  };

  const endCompare = () => onCompareEnd?.();

  return (
    <div className={`iap iap-${mode}`}>
      <div className="iap-head">
        <span className="iap-eyebrow">Edit photo</span>
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

      <div className="iap-flips" role="group" aria-label="Flip and black & white">
        <button type="button" className={`iap-toggle ${a.flipH ? 'is-on' : ''}`}
                onClick={() => toggle('flipH')} title="Flip horizontal">
          <Icon as={FlipHorizontal} size={15} /><span>Flip H</span>
        </button>
        <button type="button" className={`iap-toggle ${a.flipV ? 'is-on' : ''}`}
                onClick={() => toggle('flipV')} title="Flip vertical">
          <Icon as={FlipVertical} size={15} /><span>Flip V</span>
        </button>
        <button type="button" className={`iap-toggle ${a.grayscale ? 'is-on' : ''}`}
                onClick={() => toggle('grayscale')} title="Black & white">
          <Icon as={CircleHalf} size={15} /><span className="iap-bw">B/W</span>
        </button>
      </div>

      <div className="iap-sliders">
        {SLIDERS.map((s) => {
          const v = val(s.key, s.neutral);
          const fill = pct(v, s.min, s.max);
          const neutralPct = pct(s.neutral, s.min, s.max);
          const lo = Math.min(neutralPct, fill);
          const hi = Math.max(neutralPct, fill);
          const showNotch = neutralPct > 1 && neutralPct < 99;
          const isDirty = v !== s.neutral;
          return (
            <div key={s.key} className="iap-row">
              <div className="iap-rowtop">
                <span className="iap-label"><Icon as={s.icon} size={13} />{s.label}</span>
                <button type="button" className={`iap-val ${isDirty ? 'is-dirty' : ''}`}
                        title={isDirty ? 'Reset to default' : undefined}
                        onClick={() => { if (isDirty) setField(s.key, s.neutral); }}>
                  {fmtVal(s, v)}
                </button>
              </div>
              <div className="iap-control">
                {showNotch && <span className="iap-notch" aria-hidden="true" />}
                <input type="range" className={`iap-slider ${s.warmth ? 'iap-slider--warmth' : ''}`}
                       min={s.min} max={s.max} step={s.step || 1}
                       value={v}
                       style={{ '--lo': `${lo}%`, '--hi': `${hi}%` }}
                       aria-label={s.label}
                       onChange={(e) => setField(s.key, Number(e.target.value))}
                       onDoubleClick={() => setField(s.key, s.neutral)} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="iap-foot">
        {dirty && onCompareStart && (
          <button type="button" className="iap-btn iap-btn-icon" title="Hold to compare original"
                  onPointerDown={(e) => { e.preventDefault(); onCompareStart?.(); }}
                  onPointerUp={endCompare} onPointerLeave={endCompare} onPointerCancel={endCompare}>
            <Icon as={Eye} size={15} />
          </button>
        )}
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
