// Shared photo-adjustment controls (Lightroom-style). Pure & presentational —
// the host (compact popover or full-screen modal) wires the callbacks to the
// canvas mutators. Compact mode shows a curated essentials subset + a "Full
// screen" button; full mode shows all controls grouped into Light/Color/Detail.
//
// It operates on the NORMALIZED adjust (so editing a legacy v1 card migrates it)
// and stamps the v2 schema marker on every write.

import { Icon } from './Icon.jsx';
import { RotateCcw, Maximize2, X, SquareSplitHorizontal, FlipHorizontal, FlipVertical, CircleHalf } from '../lib/icons.js';
import { isAdjusted, normalizeAdjust, ADJUST_VERSION } from '../lib/imageAdjust.js';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

const SLIDERS = [
  { key: 'exposure',    get label() { return t`Exposure`; },    group: 'light' },
  { key: 'contrast',    get label() { return t`Contrast`; },    group: 'light' },
  { key: 'highlights',  get label() { return t`Highlights`; },  group: 'light' },
  { key: 'shadows',     get label() { return t`Shadows`; },     group: 'light' },
  { key: 'whites',      get label() { return t`Whites`; },      group: 'light' },
  { key: 'blacks',      get label() { return t`Blacks`; },      group: 'light' },
  { key: 'temperature', get label() { return t`Temperature`; }, group: 'color', track: 'temp' },
  { key: 'tint',        get label() { return t`Tint`; },        group: 'color', track: 'tint' },
  { key: 'vibrance',    get label() { return t`Vibrance`; },    group: 'color' },
  { key: 'saturation',  get label() { return t`Saturation`; },  group: 'color' },
  { key: 'clarity',     get label() { return t`Clarity`; },     group: 'detail' },
  { key: 'sharpness',   get label() { return t`Sharpness`; },   group: 'detail', min: 0, max: 100, plain: true },
];
const ESSENTIALS = ['exposure', 'contrast', 'highlights', 'shadows', 'temperature', 'vibrance'];
const groups = () => [['light', t`Light`], ['color', t`Color`], ['detail', t`Detail`]];

const pct = (v, min, max) => ((v - min) / (max - min)) * 100;

export function ImageAdjustPanel({ adjust, onChange, onReset, onExpand, onClose,
                                   onCompareStart, onCompareEnd, mode = 'compact' }) {
  const a = normalizeAdjust(adjust) || {};
  const val = (key, neutral) => (a[key] == null ? neutral : Number(a[key]));
  const dirty = isAdjusted(adjust);

  // Stamp the v2 marker so normalizeAdjust reads the new shape; spreading the
  // normalized `a` migrates a legacy card to v2 on first edit.
  const setField = (key, value) => onChange?.({ ...a, v: ADJUST_VERSION, [key]: value });
  const toggle = (key) => onChange?.({ ...a, v: ADJUST_VERSION, [key]: !a[key] });

  const endCompare = () => onCompareEnd?.();

  const fmtVal = (s, v) => (s.plain ? String(v) : (v === 0 ? '0' : (v > 0 ? `+${v}` : `${v}`)));

  const renderRow = (s) => {
    const min = s.min ?? -100, max = s.max ?? 100, neutral = s.neutral ?? 0;
    const v = val(s.key, neutral);
    const fill = pct(v, min, max);
    const neutralPct = pct(neutral, min, max);
    const lo = Math.min(neutralPct, fill), hi = Math.max(neutralPct, fill);
    const showNotch = neutralPct > 1 && neutralPct < 99;
    const isDirty = v !== neutral;
    const trackClass = s.track === 'temp' ? 'iap-slider--temp' : s.track === 'tint' ? 'iap-slider--tint' : '';
    return (
      <div key={s.key} className="iap-row">
        <div className="iap-rowtop">
          <span className="iap-label">{s.label}</span>
          <button type="button" className={`iap-val ${isDirty ? 'is-dirty' : ''}`}
                  title={isDirty ? t`Reset to default` : undefined}
                  onClick={() => { if (isDirty) setField(s.key, neutral); }}>
            {fmtVal(s, v)}
          </button>
        </div>
        <div className="iap-control">
          {showNotch && <span className="iap-notch" aria-hidden="true" />}
          <input type="range" className={`iap-slider ${trackClass}`}
                 min={min} max={max} step={1} value={v}
                 style={{ '--lo': `${lo}%`, '--hi': `${hi}%` }}
                 aria-label={s.label}
                 onChange={(e) => setField(s.key, Number(e.target.value))}
                 onDoubleClick={() => setField(s.key, neutral)} />
        </div>
      </div>
    );
  };

  return (
    <div className={`iap iap-${mode}`}>
      <div className="iap-head">
        <span className="iap-eyebrow"><Trans>Edit photo</Trans></span>
        <div className="iap-head-actions">
          {mode === 'compact' && onExpand && (
            <button type="button" className="iap-iconbtn" title={t`Full screen`} onClick={onExpand}>
              <Icon as={Maximize2} size={15} />
            </button>
          )}
          {mode === 'full' && onClose && (
            <button type="button" className="iap-iconbtn" title={t`Done`} onClick={onClose}>
              <Icon as={X} size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="iap-flips" role="group" aria-label={t`Flip and black & white`}>
        <button type="button" className={`iap-toggle ${a.flipH ? 'is-on' : ''}`}
                onClick={() => toggle('flipH')} title={t`Flip horizontal`}>
          <Icon as={FlipHorizontal} size={15} /><span><Trans>Flip H</Trans></span>
        </button>
        <button type="button" className={`iap-toggle ${a.flipV ? 'is-on' : ''}`}
                onClick={() => toggle('flipV')} title={t`Flip vertical`}>
          <Icon as={FlipVertical} size={15} /><span><Trans>Flip V</Trans></span>
        </button>
        <button type="button" className={`iap-toggle ${a.grayscale ? 'is-on' : ''}`}
                onClick={() => toggle('grayscale')} title={t`Black & white`}>
          <Icon as={CircleHalf} size={15} /><span className="iap-bw">B/W</span>
        </button>
      </div>

      <div className="iap-sliders">
        {mode === 'compact'
          ? SLIDERS.filter((s) => ESSENTIALS.includes(s.key)).map(renderRow)
          : groups().map(([g, label]) => (
              <div key={g} className="iap-group">
                <div className="iap-eyebrow iap-group-label">{label}</div>
                {SLIDERS.filter((s) => s.group === g).map(renderRow)}
              </div>
            ))}
      </div>

      <div className="iap-foot">
        {dirty && onCompareStart && (
          <button type="button" className="iap-btn iap-btn-icon" title={t`Hold to compare original`}
                  onPointerDown={(e) => { e.preventDefault(); onCompareStart?.(); }}
                  onPointerUp={endCompare} onPointerLeave={endCompare} onPointerCancel={endCompare}>
            <Icon as={SquareSplitHorizontal} size={15} />
          </button>
        )}
        <button type="button" className="iap-btn" disabled={!dirty} onClick={onReset}>
          <Icon as={RotateCcw} size={14} /><span><Trans>Reset</Trans></span>
        </button>
      </div>
    </div>
  );
}

export default ImageAdjustPanel;
