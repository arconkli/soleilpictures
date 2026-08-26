// Shared form widgets for the Settings panel.
//
// Every tab under components/settings/ builds out of these, so the panel
// looks like one thing rather than eight. Nothing here talks to the network —
// each widget takes a value and an onChange and lets the tab own persistence.
//
// Lifted verbatim out of SettingsPanel.jsx when that file passed 1900 lines.
import { useEffect, useRef, useState } from 'react';
import { ColorPicker } from '../ColorPicker.jsx';
import { R2Image } from '../R2Image.jsx';

// ── Fonts ───────────────────────────────────────────────────────────────
// Curated quick-pick fonts + a "Custom…" escape hatch that pulls from
// Google Fonts on demand. Each preset's `gf` is the Google Fonts family
// name (or null for system fonts that don't need a remote load).
export const FONT_PRESETS = [
  // System / brand
  { id: 'aileron',  name: 'Aileron (default)', css: 'aileron, -apple-system, system-ui, sans-serif', gf: null },
  { id: 'system',   name: 'System sans',       css: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif', gf: null },
  // Sans
  { id: 'inter',    name: 'Inter',             css: '"Inter", system-ui, sans-serif', gf: 'Inter' },
  { id: 'manrope',  name: 'Manrope',           css: '"Manrope", system-ui, sans-serif', gf: 'Manrope' },
  { id: 'plex-sans',name: 'IBM Plex Sans',     css: '"IBM Plex Sans", sans-serif', gf: 'IBM+Plex+Sans' },
  { id: 'work',     name: 'Work Sans',         css: '"Work Sans", sans-serif', gf: 'Work+Sans' },
  { id: 'dmsans',   name: 'DM Sans',           css: '"DM Sans", sans-serif', gf: 'DM+Sans' },
  { id: 'space',    name: 'Space Grotesk',     css: '"Space Grotesk", sans-serif', gf: 'Space+Grotesk' },
  { id: 'host',     name: 'Host Grotesk',      css: '"Host Grotesk", sans-serif', gf: 'Host+Grotesk' },
  { id: 'archivo',  name: 'Archivo',           css: '"Archivo", sans-serif', gf: 'Archivo' },
  // Serif / editorial
  { id: 'lora',     name: 'Lora',              css: '"Lora", Georgia, serif', gf: 'Lora' },
  { id: 'eb',       name: 'EB Garamond',       css: '"EB Garamond", Georgia, serif', gf: 'EB+Garamond' },
  { id: 'fraunces', name: 'Fraunces',          css: '"Fraunces", Georgia, serif', gf: 'Fraunces' },
  { id: 'crimson',  name: 'Crimson Pro',       css: '"Crimson Pro", Georgia, serif', gf: 'Crimson+Pro' },
  { id: 'plex-serif', name: 'IBM Plex Serif',  css: '"IBM Plex Serif", Georgia, serif', gf: 'IBM+Plex+Serif' },
  { id: 'serif',    name: 'Georgia (system)',  css: 'Georgia, "Times New Roman", serif', gf: null },
  // Display
  { id: 'syne',     name: 'Syne',              css: '"Syne", sans-serif', gf: 'Syne' },
  { id: 'unbounded',name: 'Unbounded',         css: '"Unbounded", sans-serif', gf: 'Unbounded' },
  { id: 'bricolage',name: 'Bricolage Grotesque', css: '"Bricolage Grotesque", sans-serif', gf: 'Bricolage+Grotesque' },
  // Handwritten
  { id: 'caveat',   name: 'Caveat (handwritten)', css: '"Caveat", cursive', gf: 'Caveat' },
  { id: 'kalam',    name: 'Kalam',             css: '"Kalam", cursive', gf: 'Kalam' },
  { id: 'reenie',   name: 'Reenie Beanie',     css: '"Reenie Beanie", cursive', gf: 'Reenie+Beanie' },
  // Mono
  { id: 'plex-mono',name: 'IBM Plex Mono',     css: '"IBM Plex Mono", ui-monospace, monospace', gf: 'IBM+Plex+Mono' },
  { id: 'jetbrains',name: 'JetBrains Mono',    css: '"JetBrains Mono", ui-monospace, monospace', gf: 'JetBrains+Mono' },
  { id: 'mono',     name: 'System mono',       css: 'ui-monospace, "SF Mono", Menlo, monospace', gf: null },
];

// Inject a Google Fonts stylesheet on demand. Idempotent — same family
// only loads once. Used by FontField when the user picks a font that
// isn't already on the page (i.e. anything beyond Aileron + system).
function ensureGoogleFont(family) {
  if (!family || typeof document === 'undefined') return;
  const id = `gf-${family.replace(/[^a-z0-9_-]/gi, '')}`;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${family}:wght@300;400;500;600;700&display=swap`;
  document.head.appendChild(link);
}

// Small picker that supports the curated list AND a free-text custom
// font. Custom mode auto-loads the chosen family from Google Fonts so
// users can paste any name and see it apply live.
export function FontField({ value, onChange, disabled }) {
  const preset = FONT_PRESETS.find(f => f.css === value);
  const initialMode = !value ? '' : (preset ? preset.id : '__custom');
  const [mode, setMode] = useState(initialMode);
  const [custom, setCustom] = useState(preset ? '' : (value || ''));

  // Re-sync if the saved value changes externally (e.g. someone else
  // edits the workspace setting).
  useEffect(() => {
    const p = FONT_PRESETS.find(f => f.css === value);
    if (!value) { setMode(''); setCustom(''); }
    else if (p) { setMode(p.id); setCustom(''); }
    else { setMode('__custom'); setCustom(value); }
  }, [value]);

  const onSelect = (e) => {
    const v = e.target.value;
    setMode(v);
    if (v === '') { onChange(null); return; }
    if (v === '__custom') {
      // Don't write yet — wait for the text input to commit.
      return;
    }
    const p = FONT_PRESETS.find(f => f.id === v);
    if (!p) return;
    if (p.gf) ensureGoogleFont(p.gf);
    onChange(p.css);
  };

  const commitCustom = () => {
    const t = custom.trim();
    if (!t) { onChange(null); return; }
    // Extract the first family name to load from Google Fonts.
    const first = t.split(',')[0].replace(/['"]/g, '').trim();
    const familyParam = first.replace(/\s+/g, '+');
    if (familyParam) ensureGoogleFont(familyParam);
    // Build a CSS font-family string. If the user gave us a bare family
    // name with no fallbacks, append a sensible system fallback chain.
    const cssValue = t.includes(',') ? t : `"${first}", system-ui, sans-serif`;
    onChange(cssValue);
  };

  return (
    <div className="settings-font-row">
      <select className="settings-input"
              value={mode}
              disabled={disabled}
              onChange={onSelect}>
        <option value="">Default</option>
        {FONT_PRESETS.map(f => (
          <option key={f.id} value={f.id} style={{ fontFamily: f.css }}>{f.name}</option>
        ))}
        <option value="__custom">Custom…</option>
      </select>
      {mode === '__custom' && (
        <input className="settings-input settings-font-custom"
               type="text"
               placeholder="e.g. Atkinson Hyperlegible"
               value={custom}
               disabled={disabled}
               onChange={(e) => setCustom(e.target.value)}
               onBlur={commitCustom}
               onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitCustom(); } }} />
      )}
    </div>
  );
}

// ── Accent ──────────────────────────────────────────────────────────────
export const ACCENT_PRESETS = [
  '#ffa500', // soleil (default)
  '#cf6a4f', // terracotta
  '#7c5cc9', // violet
  '#3fa39a', // teal
  '#5b8fc7', // blue
  '#10b981', // emerald
  '#ec4899', // pink
  '#5b574e', // ink
];

// Accent picker — preset dots + a "Custom" chip that opens the full
// ColorPicker modal so the user isn't capped at 8 swatches.
export function AccentPicker({ value, onChange }) {
  const [pickerPos, setPickerPos] = useState(null);
  const customRef = useRef(null);
  const isCustom = value && !ACCENT_PRESETS.includes(value);
  return (
    <div className="settings-accent-row">
      {ACCENT_PRESETS.map(c => (
        <button key={c}
                type="button"
                className={`settings-accent-dot ${value === c ? 'is-active' : ''}`}
                style={{ background: c }}
                title={c}
                onClick={() => onChange(c)} />
      ))}
      <button ref={customRef}
              type="button"
              className={`settings-accent-dot settings-accent-dot-custom ${isCustom ? 'is-active' : ''}`}
              style={isCustom ? { background: value } : undefined}
              title={isCustom ? `Custom — ${value}` : 'Custom color'}
              onClick={() => {
                const r = customRef.current?.getBoundingClientRect();
                if (r) setPickerPos({ x: r.left + r.width / 2, y: r.bottom + 8 });
              }}>
        {isCustom ? '' : '+'}
      </button>
      <button type="button"
              className={`settings-accent-dot settings-accent-dot-clear ${!value ? 'is-active' : ''}`}
              title="Default soleil gold"
              onClick={() => onChange(null)}>×</button>
      {pickerPos && (
        <ColorPicker value={value || '#ffa500'}
                     onChange={onChange}
                     onClose={() => setPickerPos(null)}
                     position={pickerPos}
                     allowTransparent={false} />
      )}
    </div>
  );
}

// ── Colour swatches ─────────────────────────────────────────────────────
// Visual preview of a color setting. `color` is the resolved fill (string)
// or null. When it's null/'transparent', renders a checker pattern instead
// of pretending — so the chip in Settings actually matches what shows up
// on the board.
export function SwatchChip({ color, label, dimmed, disabled, onClick, refProp }) {
  const isEmpty = !color || color === 'transparent';
  return (
    <button ref={refProp}
            type="button"
            className={`settings-swatch-chip ${disabled ? 'is-disabled' : ''}`}
            disabled={disabled}
            onClick={onClick}>
      <span className={`settings-swatch-chip-block ${isEmpty ? 'is-empty' : ''}`}
            style={isEmpty ? undefined : { background: color }} />
      <span className={`settings-swatch-chip-label ${dimmed ? 'is-default' : ''}`}>
        {label}
      </span>
    </button>
  );
}

export function SwatchInput({ value, fallback, onChange, disabled, allowTransparent = false }) {
  const [pickerPos, setPickerPos] = useState(null);
  const ref = useRef(null);
  const effective = value ?? fallback;
  const isEmpty = effective == null || effective === 'transparent';
  let label;
  if (value) label = value.toUpperCase();
  else if (isEmpty) label = 'No fill';
  else label = `Default · ${String(fallback).toUpperCase()}`;
  return (
    <div className="settings-color-row">
      <SwatchChip
        refProp={ref}
        color={effective}
        label={label}
        dimmed={!value}
        disabled={disabled}
        onClick={() => {
          const r = ref.current?.getBoundingClientRect();
          if (r) setPickerPos({ x: r.left + r.width / 2, y: r.top });
        }} />
      {value && (
        <button type="button" className="settings-link-btn"
                onClick={() => onChange(null)}
                disabled={disabled}>Reset</button>
      )}
      {pickerPos && (
        <ColorPicker
          value={isEmpty ? '#888888' : effective}
          onChange={onChange}
          onClose={() => setPickerPos(null)}
          position={pickerPos}
          allowTransparent={allowTransparent} />
      )}
    </div>
  );
}

// ── Image upload ────────────────────────────────────────────────────────
// Avatar / icon preview + file picker + remove button. Used for both
// the profile picture and the workspace icon — same shape, same flow,
// just different consumers wiring up state.
export function AvatarUploadRow({ src, fallbackColor, fallbackInitial, uploading, disabled, onPick, onRemove, shape = 'circle' }) {
  const fileRef = useRef(null);
  const previewClass = `settings-avatar-preview settings-avatar-${shape}`;
  return (
    <div className="settings-avatar-row">
      <div className={previewClass}
           style={src ? undefined : { background: fallbackColor }}
           aria-hidden="true">
        {src
          ? <R2Image src={src} alt="" className="settings-avatar-img" />
          : <span>{fallbackInitial}</span>}
      </div>
      <div className="settings-avatar-actions">
        <button type="button" className="settings-btn"
                onClick={() => fileRef.current?.click()}
                disabled={disabled || uploading}>
          {uploading ? 'Uploading…' : (src ? 'Replace' : 'Upload')}
        </button>
        {src && (
          <button type="button" className="settings-link-btn"
                  onClick={onRemove}
                  disabled={disabled || uploading}>
            Remove
          </button>
        )}
      </div>
      <input ref={fileRef}
             type="file"
             accept="image/*"
             style={{ display: 'none' }}
             onChange={(e) => {
               const f = e.target.files?.[0];
               // Reset value so picking the same file twice still fires onChange.
               e.target.value = '';
               if (f) onPick(f);
             }} />
    </div>
  );
}

// ── Layout primitives ───────────────────────────────────────────────────
export function SettingsCategory({ title, desc, children }) {
  return (
    <div className="settings-cat">
      <div className="settings-cat-head">
        <span className="settings-cat-title">{title}</span>
        {desc && <span className="settings-cat-desc">{desc}</span>}
      </div>
      <div className="settings-cat-body">
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <div className="settings-field">
      <span className="settings-field-label">{label}</span>
      <div className="settings-field-control">{children}</div>
    </div>
  );
}

export function Toggle({ label, desc, value, onChange }) {
  return (
    <label className="settings-toggle">
      <span className="settings-toggle-text">
        <span className="settings-toggle-label">{label}</span>
        {desc && <span className="settings-toggle-desc">{desc}</span>}
      </span>
      <span className={`settings-toggle-switch ${value ? 'is-on' : ''}`}
            onClick={() => onChange(!value)}
            onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onChange(!value); } }}
            role="switch"
            tabIndex={0}
            aria-checked={value}>
        <span className="settings-toggle-thumb" />
      </span>
    </label>
  );
}
