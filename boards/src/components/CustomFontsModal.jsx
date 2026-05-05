// "Manage fonts" modal — opened from any font picker. Lets the user add a
// font by name (system), Google Font, or font-file URL. Persists to
// localStorage so every font picker in the app sees the new family.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { addCustomFont, getCustomFonts, removeCustomFont } from '../lib/customFonts.js';
import { useCustomFonts } from '../hooks/useCustomFonts.js';

export function CustomFontsModal({ open, onClose }) {
  const fonts = useCustomFonts();
  const [name, setName] = useState('');
  const [kind, setKind] = useState('system'); // 'system' | 'google' | 'url'
  const [value, setValue] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const reset = () => { setName(''); setValue(''); setKind('system'); };
  const submit = (e) => {
    e?.preventDefault?.();
    const n = name.trim();
    if (!n) return;
    let css;
    if (kind === 'google' || kind === 'url') css = `'${n}', sans-serif`;
    else css = `'${n}', sans-serif`;
    addCustomFont({ name: n, css, source: { kind, value: kind === 'system' ? null : value.trim() || null } });
    reset();
  };

  return createPortal(
    <div className="cfont-back" onClick={onClose}>
      <div className="cfont" ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="cfont-head">
          <div>
            <div className="cfont-kicker">Fonts</div>
            <div className="cfont-title">Custom fonts</div>
          </div>
          <button className="cfont-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="cfont-body">
          {fonts.length > 0 && (
            <>
              <div className="cfont-section">In your library</div>
              <div className="cfont-list">
                {fonts.map(f => (
                  <div key={f.id} className="cfont-row">
                    <div className="cfont-row-name" style={{ fontFamily: f.css }}>{f.name}</div>
                    <div className="cfont-row-meta">
                      {f.source?.kind === 'google' && 'Google Fonts'}
                      {f.source?.kind === 'url'    && 'URL'}
                      {f.source?.kind === 'system' && 'System'}
                    </div>
                    <button className="cfont-row-x" onClick={() => removeCustomFont(f.id)} title="Remove">×</button>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="cfont-section">Add a font</div>
          <form className="cfont-add" onSubmit={submit}>
            <label className="cfont-field">
              <span>Name</span>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
                     placeholder="e.g. Söhne, Inter, Crimson Pro" />
            </label>
            <div className="cfont-row-2">
              <label className="cfont-field">
                <span>Source</span>
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="system">System (already installed)</option>
                  <option value="google">Google Fonts</option>
                  <option value="url">Font file URL (.woff2)</option>
                </select>
              </label>
              {kind === 'url' && (
                <label className="cfont-field cfont-field-grow">
                  <span>URL</span>
                  <input value={value} onChange={(e) => setValue(e.target.value)}
                         placeholder="https://example.com/font.woff2" />
                </label>
              )}
              {kind === 'google' && (
                <label className="cfont-field cfont-field-grow">
                  <span>Family (defaults to name)</span>
                  <input value={value} onChange={(e) => setValue(e.target.value)}
                         placeholder="e.g. Inter" />
                </label>
              )}
            </div>
            <div className="cfont-actions">
              <span style={{ flex: 1 }} />
              <button type="submit" className="cfont-btn-primary" disabled={!name.trim()}>Add font</button>
            </div>
          </form>

          {name.trim() && (
            <div className="cfont-preview" style={{ fontFamily: `'${name.trim()}', sans-serif` }}>
              The quick brown fox jumps over the lazy dog · 0123456789
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
