// Profile — who you are to everyone else: picture, display name, the colour
// your cursor wears, and the address you sign in with.
//
// Autosaves, like every other tab. It used to be the one screen in Settings
// with a "Save profile" button, which is how you could upload a picture, close
// the panel, and silently lose it — the upload only set local state and the
// button was the only thing that ever wrote.
//
// Each control commits at the moment its edit is finished, which is different
// per control: a text field on blur or Enter, an upload when it resolves, the
// colour when the picker CLOSES rather than on every drag frame (the same rule
// useRecentColors follows — a drag through the wheel is one decision, not two
// hundred).
import { useEffect, useRef, useState } from 'react';
import { getOwnProfile, saveOwnProfile } from '../../lib/boardsApi.js';
import { uploadImage } from '../../lib/uploads.js';
import { pickPresenceColor } from '../../lib/presenceColor.js';
import { useFeedback } from '../AppFeedback.jsx';
import { ColorPicker } from '../ColorPicker.jsx';
import { Field, SwatchChip, AvatarUploadRow } from './fields.jsx';
import { useSettingsSave } from './saveState.jsx';
import { DeleteAccount } from './DeleteAccount.jsx';

export function ProfileTab({ user, workspaceId, onSaved }) {
  const feedback = useFeedback();
  const save = useSettingsSave();
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  // What the server currently holds. Every commit diffs against this, so a
  // blur that changed nothing is not a write.
  const [saved, setSaved] = useState({ name: '', color: '', avatarUrl: '' });
  const [loading, setLoading] = useState(false);
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
        setSaved({ name: n, color: c, avatarUrl: a });
      })
      .catch(() => {
        feedback.toast({ type: 'error', message: 'Could not load profile.' });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user?.id]);

  // saveOwnProfile writes all three columns, so a patch has to be merged over
  // what the server already holds rather than sent alone.
  const persist = async (patch) => {
    if (!user?.id) return false;
    const next = { ...saved, ...patch, name: (patch.name ?? saved.name).trim() };
    const ok = await save(() => saveOwnProfile({
      userId: user.id,
      displayName: next.name || null,
      color: next.color || null,
      avatarUrl: next.avatarUrl || null,
    }));
    if (ok) { setSaved(next); onSaved?.(next); }
    return ok;
  };

  const commitName = async () => {
    const trimmed = name.trim();
    if (trimmed === saved.name) return;
    // No revert on failure: the field holds what they typed, and blurring it
    // again retries. Throwing away their typing to "stay honest" would cost
    // more than the divergence does — and save() has already toasted.
    await persist({ name: trimmed });
  };

  // Colour and the picture are single-action picks, so a failed write DOES
  // revert — showing a colour that is not stored is a lie, and there is no
  // typing to lose.
  const commitColor = async (nextColor) => {
    if ((nextColor || '') === (saved.color || '')) return;
    const ok = await persist({ color: nextColor || '' });
    if (!ok) setColor(saved.color || '');
  };

  const commitAvatar = async (src) => {
    const ok = await persist({ avatarUrl: src || '' });
    if (!ok) setAvatarUrl(saved.avatarUrl || '');
  };

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
      await commitAvatar(src || '');
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Upload failed: ' + (err.message || err) });
    } finally {
      setUploadingAvatar(false);
    }
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Profile</h3>
      <p className="settings-section-hint">
        What everyone you share a cluster with sees. Changes save as you make them.
      </p>
      <Field label="Profile picture">
        <AvatarUploadRow
          src={avatarUrl}
          fallbackColor={color || presenceFallback}
          fallbackInitial={(name || user?.email || '?').trim().charAt(0).toUpperCase() || '?'}
          uploading={uploadingAvatar}
          disabled={loading}
          onPick={onAvatarPick}
          onRemove={() => { setAvatarUrl(''); commitAvatar(''); }}
        />
      </Field>
      <Field label="Display name">
        <input className="settings-input"
               value={name}
               placeholder={user?.email?.split('@')[0] || 'Your name'}
               onChange={(e) => setName(e.target.value)}
               onBlur={commitName}
               onKeyDown={(e) => {
                 if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
                 if (e.key === 'Escape') { e.preventDefault(); setName(saved.name); }
               }}
               disabled={loading} />
      </Field>
      <Field label="Presence color">
        <div className="settings-color-row">
          <SwatchChip
            refProp={chipRef}
            color={color || presenceFallback}
            label={color ? color.toUpperCase() : `Default · ${presenceFallback.toUpperCase()}`}
            dimmed={!color}
            disabled={loading}
            onClick={() => {
              const r = chipRef.current?.getBoundingClientRect();
              if (r) setPickerPos({ x: r.left + r.width / 2, y: r.top });
            }} />
          {color && (
            <button type="button" className="settings-link-btn"
                    onClick={() => { setColor(''); commitColor(''); }}
                    disabled={loading}>Reset</button>
          )}
        </div>
      </Field>
      <Field label="Email">
        <div className="settings-readonly">{user?.email || '—'}</div>
      </Field>
      {/* Last, and behind a click. Everything above autosaves; this is the one
          thing in the panel that asks twice and cannot be taken back. A Scout
          shell account has no address to re-type, so it gets nothing here —
          the server refuses those too. */}
      {user?.email && <DeleteAccount email={user.email} />}
      {pickerPos && (
        <ColorPicker
          value={color || presenceFallback}
          onChange={(c) => setColor(c)}
          onClose={() => { setPickerPos(null); commitColor(color); }}
          position={pickerPos}
          allowTransparent={false} />
      )}
    </div>
  );
}
