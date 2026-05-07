// Account settings modal — edit the user's display name + presence color.
// Reads/writes the public.profiles table directly. Mounted from a sidebar
// click and used to override the email-derived defaults that ship with
// every fresh session.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from '../lib/icons.js';
import { Icon } from './Icon.jsx';
import { getOwnProfile, saveOwnProfile } from '../lib/boardsApi.js';
import { useFeedback } from './AppFeedback.jsx';
import { ColorPicker } from './ColorPicker.jsx';

export function AccountSettings({ open, onClose, user, onSaved, onSignOut }) {
  const feedback = useFeedback();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [name, setName]       = useState('');
  const [color, setColor]     = useState('');
  const [initial, setInitial] = useState({ name: '', color: '' });
  // ColorPicker anchor — when set, the standard picker pops open
  // anchored to the chip the user clicked. Same modal we use for every
  // other color affordance in the app (shape stroke, palette swatch,
  // board background, etc.) so users don't relearn anything.
  const [pickerPos, setPickerPos] = useState(null);
  const chipRef = useRef(null);

  useEffect(() => {
    if (!open || !user?.id) return;
    let cancelled = false;
    setLoading(true);
    getOwnProfile()
      .then(p => {
        if (cancelled) return;
        const fallbackName = user.user_metadata?.full_name
                          || user.email?.split('@')[0] || '';
        const n = p?.display_name || fallbackName;
        const c = p?.color || '';
        setName(n);
        setColor(c);
        setInitial({ name: n, color: c });
      })
      .catch(err => {
        console.warn('[account] getOwnProfile failed', err);
        feedback.toast({ type: 'error', message: 'Could not load profile.' });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, user?.id]);

  if (!open) return null;

  const dirty = name.trim() !== initial.name.trim() || (color || '') !== (initial.color || '');

  const onSave = async (e) => {
    e?.preventDefault();
    if (!user?.id || saving) return;
    setSaving(true);
    try {
      await saveOwnProfile({
        userId: user.id,
        displayName: name.trim() || null,
        color: color || null,
      });
      feedback.toast({ type: 'success', message: 'Profile saved.' });
      onSaved?.({ name: name.trim(), color });
      onClose?.();
    } catch (err) {
      console.error('[account] saveOwnProfile failed', err);
      feedback.toast({ type: 'error', message: 'Save failed: ' + (err.message || err) });
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="account-modal-bg" onMouseDown={onClose}>
      <form className="account-modal"
            onMouseDown={(e) => e.stopPropagation()}
            onSubmit={onSave}>
        <div className="account-modal-head">
          <span className="account-modal-title">Account</span>
          <button type="button" className="account-modal-x"
                  onClick={onClose} aria-label="Close">
            <Icon as={X} size={14} />
          </button>
        </div>
        <div className="account-modal-body">
          <label className="account-field">
            <span className="account-field-label">Display name</span>
            <input className="account-input"
                   value={name}
                   placeholder={user?.email?.split('@')[0] || 'Your name'}
                   onChange={(e) => setName(e.target.value)}
                   disabled={loading || saving}
                   autoFocus />
          </label>

          <div className="account-field">
            <span className="account-field-label">Presence color</span>
            <div className="account-color-row">
              <button ref={chipRef}
                      type="button"
                      className="account-color-chip"
                      style={{ background: color || '#4f8df8' }}
                      disabled={loading || saving}
                      onClick={() => {
                        const r = chipRef.current?.getBoundingClientRect();
                        if (r) setPickerPos({ x: r.left + r.width / 2, y: r.top });
                      }}
                      title="Pick a presence color">
                <span className="account-color-chip-label">
                  {color ? color.toUpperCase() : 'Pick color'}
                </span>
              </button>
              {color && (
                <button type="button"
                        className="account-sw-clear"
                        disabled={loading || saving}
                        onClick={() => setColor('')}>Reset</button>
              )}
            </div>
          </div>

          <div className="account-field">
            <span className="account-field-label">Email</span>
            <div className="account-readonly">{user?.email || '—'}</div>
          </div>
        </div>
        <div className="account-modal-foot">
          {onSignOut && (
            <button type="button"
                    className="account-btn account-btn-signout"
                    onClick={async () => {
                      const ok = await feedback.confirm({
                        title: 'Sign out',
                        message: `Sign out of ${user?.email || 'this account'}?`,
                        confirmLabel: 'Sign out',
                      });
                      if (ok) { onClose?.(); onSignOut?.(); }
                    }}
                    disabled={saving}>Sign out</button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" className="account-btn"
                  onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="account-btn account-btn-primary"
                  disabled={!dirty || loading || saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
      {pickerPos && (
        <ColorPicker
          value={color || '#4f8df8'}
          onChange={(c) => setColor(c)}
          onClose={() => setPickerPos(null)}
          position={pickerPos}
          allowTransparent={false}
        />
      )}
    </div>,
    document.body,
  );
}
