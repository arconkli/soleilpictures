// Profile — who you are to everyone else: picture, display name, the colour
// your cursor wears, and the address you sign in with.
import { useEffect, useRef, useState } from 'react';
import { getOwnProfile, saveOwnProfile } from '../../lib/boardsApi.js';
import { uploadImage } from '../../lib/uploads.js';
import { pickPresenceColor } from '../../lib/presenceColor.js';
import { useFeedback } from '../AppFeedback.jsx';
import { useMyTier } from '../../hooks/useMyTier.js';
import { ColorPicker } from '../ColorPicker.jsx';
import { StorageMeter } from './BillingTab.jsx';
import { Field, SwatchChip, AvatarUploadRow } from './fields.jsx';

export function ProfileTab({ user, workspaceId, onSaved }) {
  const feedback = useFeedback();
  // Storage is a paid feature; surface the gauge here (the default account
  // view) so paid users see it without digging into the Billing tab.
  const { tier } = useMyTier({ userId: user?.id });
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [initial, setInitial] = useState({ name: '', color: '', avatarUrl: '' });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [pickerPos, setPickerPos] = useState(null);
  const chipRef = useRef(null);
  // What other people see when you haven't picked a presence color yourself.
  // Matches what cursors/avatars actually render on the board.
  const presenceFallback = pickPresenceColor(user?.id || user?.email || '');

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    setLoading(true);
    getOwnProfile()
      .then(p => {
        if (cancelled) return;
        const fallbackName = user.user_metadata?.full_name
                          || user.email?.split('@')[0] || '';
        const n = p?.display_name || fallbackName;
        const c = p?.color || '';
        const a = p?.avatar_url || '';
        setName(n); setColor(c); setAvatarUrl(a);
        setInitial({ name: n, color: c, avatarUrl: a });
      })
      .catch(() => {
        feedback.toast({ type: 'error', message: 'Could not load profile.' });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user?.id]);

  const dirty =
    name.trim() !== initial.name.trim()
    || (color || '') !== (initial.color || '')
    || (avatarUrl || '') !== (initial.avatarUrl || '');

  const onAvatarPick = async (file) => {
    if (!file || !user?.id) return;
    if (!workspaceId) {
      // Uploader uses presign-by-workspace because R2 keys are scoped
      // to a workspace for RLS. Without an active workspace we can't
      // ask for an upload URL.
      feedback.toast({ type: 'error', message: 'Open a workspace before uploading a profile picture.' });
      return;
    }
    setUploadingAvatar(true);
    try {
      const { src } = await uploadImage({
        file,
        workspaceId,
        boardId: null,
        userId: user.id,
      });
      setAvatarUrl(src || '');
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Upload failed: ' + (err.message || err) });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const onSave = async () => {
    if (!user?.id || saving) return;
    setSaving(true);
    try {
      await saveOwnProfile({
        userId: user.id,
        displayName: name.trim() || null,
        color: color || null,
        avatarUrl: avatarUrl || null,
      });
      feedback.toast({ type: 'success', message: 'Profile saved.' });
      setInitial({ name: name.trim(), color, avatarUrl });
      onSaved?.({ name: name.trim(), color, avatarUrl });
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Save failed — check your connection and try again. (' + (err.message || err) + ')' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Profile</h3>
      <Field label="Profile picture">
        <AvatarUploadRow
          src={avatarUrl}
          fallbackColor={color || pickPresenceColor(user.id)}
          fallbackInitial={(name || user?.email || '?').trim().charAt(0).toUpperCase() || '?'}
          uploading={uploadingAvatar}
          disabled={loading || saving}
          onPick={onAvatarPick}
          onRemove={() => setAvatarUrl('')}
        />
      </Field>
      <Field label="Display name">
        <input className="settings-input"
               value={name}
               placeholder={user?.email?.split('@')[0] || 'Your name'}
               onChange={(e) => setName(e.target.value)}
               disabled={loading || saving} />
      </Field>
      <Field label="Presence color">
        <div className="settings-color-row">
          <SwatchChip
            refProp={chipRef}
            color={color || presenceFallback}
            label={color ? color.toUpperCase() : `Default · ${presenceFallback.toUpperCase()}`}
            dimmed={!color}
            disabled={loading || saving}
            onClick={() => {
              const r = chipRef.current?.getBoundingClientRect();
              if (r) setPickerPos({ x: r.left + r.width / 2, y: r.top });
            }} />
          {color && (
            <button type="button" className="settings-link-btn"
                    onClick={() => setColor('')}
                    disabled={loading || saving}>Reset</button>
          )}
        </div>
      </Field>
      <Field label="Email">
        <div className="settings-readonly">{user?.email || '—'}</div>
      </Field>
      {tier === 'paid' && <StorageMeter />}
      <div className="settings-row-actions">
        <span style={{ flex: 1 }} />
        <button type="button" className="settings-btn settings-btn-primary"
                onClick={onSave}
                disabled={!dirty || loading || saving}>
          {saving ? 'Saving…' : 'Save profile'}
        </button>
      </div>
      {pickerPos && (
        <ColorPicker
          value={color || presenceFallback}
          onChange={(c) => setColor(c)}
          onClose={() => setPickerPos(null)}
          position={pickerPos}
          allowTransparent={false} />
      )}
    </div>
  );
}
