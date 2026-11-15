// "Manage fonts" modal — opened from any font picker. Lets the user add a
// font by name (system), Google Font, or font-file URL. Persists to
// localStorage so every font picker in the app sees the new family.

import { useRef, useState } from 'react';
import { Modal } from './Modal.jsx';
import { addCustomFont, removeCustomFont } from '../lib/customFonts.js';
import { useCustomFonts } from '../hooks/useCustomFonts.js';
import { t, ph } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

export function CustomFontsModal({ open, onClose }) {
  const fonts = useCustomFonts();
  const [name, setName] = useState('');
  const [kind, setKind] = useState('system'); // 'system' | 'google' | 'url'
  const [value, setValue] = useState('');
  const nameRef = useRef(null);

  const reset = () => { setName(''); setValue(''); setKind('system'); };
  const submit = (e) => {
    e?.preventDefault?.();
    const n = name.trim();
    if (!n) return;
    const css = `'${n}', sans-serif`;
    addCustomFont({ name: n, css, source: { kind, value: kind === 'system' ? null : value.trim() || null } });
    reset();
  };

  return (
    <Modal open={open} onClose={onClose} className="cfont" backdropClassName="cfont-back"
           labelledBy="cfont-title" initialFocusRef={nameRef}>
      <div className="cfont-head">
        <div>
          <div className="cfont-kicker"><Trans>Fonts</Trans></div>
          <div className="cfont-title" id="cfont-title"><Trans>Custom fonts</Trans></div>
        </div>
        <button className="cfont-x" onClick={onClose} aria-label={t`Close`}>×</button>
      </div>

      <div className="cfont-body">
        {fonts.length > 0 && (
          <>
            <div className="cfont-section"><Trans>In your library</Trans></div>
            <div className="cfont-list">
              {fonts.map(f => (
                <div key={f.id} className="cfont-row">
                  <div className="cfont-row-name" style={{ fontFamily: f.css }}>{f.name}</div>
                  <div className="cfont-row-meta">
                    {f.source?.kind === 'google' && t`Google Fonts`}
                    {f.source?.kind === 'url'    && t`URL`}
                    {f.source?.kind === 'system' && t`System`}
                  </div>
                  <button className="cfont-row-x" onClick={() => removeCustomFont(f.id)} title={t`Remove`} aria-label={t`Remove ${ph({ name: f.name })}`}>×</button>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="cfont-section"><Trans>Add a font</Trans></div>
        <form className="cfont-add" onSubmit={submit}>
          <label className="cfont-field">
            <span><Trans>Name</Trans> <span className="field-required" aria-hidden="true">*</span></span>
            <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)}
                   required aria-required="true"
                   placeholder={t`e.g. Söhne, Inter, Crimson Pro`} />
          </label>
          <div className="cfont-row-2">
            <label className="cfont-field">
              <span><Trans>Source</Trans></span>
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="system">{t`System (already installed)`}</option>
                <option value="google">{t`Google Fonts`}</option>
                <option value="url">{t`Font file URL (.woff2)`}</option>
              </select>
            </label>
            {kind === 'url' && (
              <label className="cfont-field cfont-field-grow">
                <span><Trans>URL</Trans></span>
                <input value={value} onChange={(e) => setValue(e.target.value)}
                       placeholder={t`https://example.com/font.woff2`} />
              </label>
            )}
            {kind === 'google' && (
              <label className="cfont-field cfont-field-grow">
                <span><Trans>Family (defaults to name)</Trans></span>
                <input value={value} onChange={(e) => setValue(e.target.value)}
                       placeholder={t`e.g. Inter`} />
              </label>
            )}
          </div>
          <div className="cfont-actions">
            <span style={{ flex: 1 }} />
            <button type="submit" className="cfont-btn-primary" disabled={!name.trim()}><Trans>Add font</Trans></button>
          </div>
        </form>

        {name.trim() && (
          <div className="cfont-preview" style={{ fontFamily: `'${name.trim()}', sans-serif` }}>
            <Trans>The quick brown fox jumps over the lazy dog · 0123456789</Trans>
          </div>
        )}
      </div>
    </Modal>
  );
}
