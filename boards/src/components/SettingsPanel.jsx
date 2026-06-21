// Settings panel — tabbed home for everything user/workspace-scoped.
// Workspace defaults are editable by editors AND owners, read-only for
// viewers. Per-user defaults are always editable (it's your account).
// Settings persist via the merge_*_settings RPCs which do atomic
// jsonb || patch so two clients can save different keys at once.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from '../lib/icons.js';
import { Icon } from './Icon.jsx';
import {
  getOwnProfile, saveOwnProfile,
  updateWorkspaceSettings,
  updateOwnSettings,
  getOrCreateMyReferralCode, getMyReferralStats,
} from '../lib/boardsApi.js';
import { logEvent, logEventNow } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { supabase } from '../lib/supabase.js';
import { uploadImage } from '../lib/uploads.js';
import { useFeedback } from './AppFeedback.jsx';
import { useMyTier } from '../hooks/useMyTier.js';
import { useStorageUsage } from '../hooks/useStorageUsage.js';
import { PricingModal } from './PricingModal.jsx';
import { ColorPicker } from './ColorPicker.jsx';
import { R2Image } from './R2Image.jsx';
import { HARDCODED_FALLBACKS } from '../hooks/useResolvedDefaults.js';
import { applyThemeNow } from '../lib/theme.js';
import { pickPresenceColor } from '../lib/presenceColor.js';
import { planLabel, formatPeriodEnd, grantCopy } from '../lib/billingCopy.js';
import { startPortal } from '../lib/checkout.js';

const TABS = [
  { id: 'profile',       label: 'Profile' },
  { id: 'invite',        label: 'Invite & earn' },
  { id: 'billing',       label: 'Billing' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'defaults',      label: 'Defaults' },
  { id: 'theme',         label: 'Theme' },
  { id: 'display',       label: 'Display' },
];

// Curated quick-pick fonts + a "Custom…" escape hatch that pulls from
// Google Fonts on demand. Each preset's `gf` is the Google Fonts family
// name (or null for system fonts that don't need a remote load).
const FONT_PRESETS = [
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
function FontField({ value, onChange, disabled }) {
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

const ACCENT_PRESETS = [
  '#ffa500', // soleil (default)
  '#cf6a4f', // terracotta
  '#7c5cc9', // violet
  '#3fa39a', // teal
  '#5b8fc7', // blue
  '#10b981', // emerald
  '#ec4899', // pink
  '#5b574e', // ink
];

export function SettingsPanel({
  open, onClose,
  user, onSignOut,
  workspaceId, workspaceName, onWorkspacesChanged,
  onSaved,
  // 'account' = avatar-style identity modal (Profile / Billing / Notifications + sign out).
  // 'workspace' = the cog-style settings (Defaults / Theme / Display).
  // 'full' = legacy / dev — show every tab in one panel.
  mode = 'full',
  // Settings hook output — passed in so the panel and the rest of the
  // app share one source of truth and refresh together.
  defaults, role, refresh, workspaceSettings, mySettings,
  // Opens the WorkspaceRecoveryModal (catastrophic rewind). Wired into
  // the Defaults tab as a low-key entry for owners. Primary entry point
  // for recovery is the top-of-app alert banner that fires automatically
  // when a mass-delete is detected; this is the manual fallback.
  onOpenRecovery,
  initialTab = null,
}) {
  // Filter tabs by mode + pick the first as default.
  //   account   = personal identity stuff (Profile + Billing + Notifications)
  //   workspace = cog-style settings (Defaults/Theme/Display)
  //   full      = every tab
  const visibleTabs = mode === 'account'
    ? TABS.filter(t => t.id === 'profile' || t.id === 'invite' || t.id === 'billing' || t.id === 'notifications')
    : mode === 'workspace'
      ? TABS.filter(t => t.id !== 'profile' && t.id !== 'invite' && t.id !== 'billing' && t.id !== 'notifications')
      : TABS;
  const [tab, setTab] = useState(visibleTabs[0]?.id || 'profile');
  // If the user reopens the panel in a different mode, the previously
  // selected tab can be invalid — snap back to the first visible.
  useEffect(() => {
    if (!visibleTabs.find(t => t.id === tab)) setTab(visibleTabs[0]?.id || 'profile');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  // Deep-link: when opened with an initialTab (e.g. returning from the Stripe
  // portal straight to Billing), select it. The panel persists `tab` across
  // open/close, so only force the tab while `open` is true.
  useEffect(() => {
    if (open && initialTab && visibleTabs.find(t => t.id === initialTab)) setTab(initialTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTab]);
  const feedback = useFeedback();

  if (!open) return null;

  // Show tab rail whenever there's more than one tab to switch between.
  const showTabRail = visibleTabs.length > 1;
  const headTitle = mode === 'account' ? 'Account' : 'Settings';

  return createPortal(
    <div className={`settings-bg ${mode === 'account' ? 'is-account-mode' : ''}`}
         onMouseDown={onClose}>
      <div className={`settings-modal ${mode === 'account' ? 'settings-modal-narrow' : ''}`}
           onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <span className="settings-title">{headTitle}</span>
          <span style={{ flex: 1 }} />
          {onSignOut && mode === 'account' && (
            <button type="button" className="settings-link-btn settings-head-signout"
                    onClick={async () => {
                      const ok = await feedback.confirm({
                        title: 'Sign out',
                        message: `Sign out of ${user?.email || 'this account'}?`,
                        confirmLabel: 'Sign out',
                      });
                      if (ok) { onClose?.(); onSignOut?.(); }
                    }}>Sign out</button>
          )}
          <button type="button" className="settings-x"
                  onClick={onClose} aria-label="Close">
            <Icon as={X} size={14} />
          </button>
        </div>
        <div className="settings-body">
          {showTabRail && (
            <nav className="settings-tabs" role="tablist">
              {visibleTabs.map(t => (
                <button key={t.id}
                        type="button"
                        role="tab"
                        className={`settings-tab ${tab === t.id ? 'is-active' : ''}`}
                        onClick={() => setTab(t.id)}>
                  {t.label}
                </button>
              ))}
            </nav>
          )}
          <div className="settings-pane">
            {tab === 'profile' && (
              <ProfileTab user={user} workspaceId={workspaceId} onSaved={onSaved} />
            )}
            {tab === 'invite' && (
              <InviteTab user={user} />
            )}
            {tab === 'billing' && (
              <BillingTab user={user} />
            )}
            {tab === 'notifications' && (
              <NotificationsTab user={user} />
            )}
            {tab === 'defaults' && (
              <DefaultsTab workspaceId={workspaceId}
                           workspaceName={workspaceName}
                           user={user}
                           role={role}
                           workspaceSettings={workspaceSettings}
                           mySettings={mySettings}
                           refresh={refresh}
                           onWorkspacesChanged={onWorkspacesChanged}
                           onOpenRecovery={onOpenRecovery} />
            )}
            {tab === 'theme' && (
              <ThemeTab mySettings={mySettings} refresh={refresh} />
            )}
            {tab === 'display' && (
              <DisplayTab mySettings={mySettings} refresh={refresh} />
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Profile tab (today's AccountSettings, lifted in) ────────────────────
function ProfileTab({ user, workspaceId, onSaved }) {
  const feedback = useFeedback();
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

// Avatar / icon preview + file picker + remove button. Used for both
// the profile picture and the workspace icon — same shape, same flow,
// just different consumers wiring up state.
function AvatarUploadRow({ src, fallbackColor, fallbackInitial, uploading, disabled, onPick, onRemove, shape = 'circle' }) {
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

// ── Defaults tab — workspace-wide defaults for new cards ─────────────────
// Editable by workspace editors and owners only. Viewers see the values
// for context but the inputs are disabled. Changes apply to every member
// when they create a new card next.
function DefaultsTab({ workspaceId, workspaceName, user, role, workspaceSettings, refresh, onWorkspacesChanged, onOpenRecovery }) {
  const feedback = useFeedback();
  const canEdit = role === 'editor' || role === 'owner';
  const isOwner = role === 'owner';
  const disabled = !canEdit;
  // "Saving… → Saved ✓" indicator: visible while the RPC is in flight so a
  // slow network doesn't read as "did my change take?", then flashes Saved.
  const [savedAt, setSavedAt] = useState(0);
  const [saving, setSaving] = useState(false);
  const flashSaved = () => setSavedAt(Date.now());
  useEffect(() => {
    if (!savedAt) return;
    const t = setTimeout(() => setSavedAt(0), 1600);
    return () => clearTimeout(t);
  }, [savedAt]);

  // Workspace icon upload — top-level key on workspaces.settings so the
  // sidebar can read it from the workspace row without an extra query.
  // Owner-only edit; viewers and editors see the section read-only so
  // the icon is at least visible.
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const iconSrc = workspaceSettings?.icon_url || '';
  const setIcon = async (nextSrc) => {
    if (!isOwner || !workspaceId) return;
    try {
      await updateWorkspaceSettings(workspaceId, { icon_url: nextSrc || null });
      await refresh?.();
      await onWorkspacesChanged?.();
      flashSaved();
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Could not update icon: ' + (err.message || err) });
    }
  };
  const onIconPick = async (file) => {
    if (!file || !workspaceId || !user?.id) return;
    setUploadingIcon(true);
    try {
      const { src } = await uploadImage({
        file, workspaceId, boardId: null, userId: user.id,
      });
      await setIcon(src);
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Upload failed: ' + (err.message || err) });
    } finally {
      setUploadingIcon(false);
    }
  };

  const settings = workspaceSettings;
  const setKey = (cat, key, value) => savePatch(cat, { [key]: value });
  const savePatch = async (cat, patch) => {
    if (!canEdit || !workspaceId) return;
    const merged = { ...(settings[cat] || {}), ...patch };
    // Prune empties so the hardcoded fallback shines through.
    for (const k of Object.keys(merged)) {
      if (merged[k] === null || merged[k] === undefined || merged[k] === '') delete merged[k];
    }
    setSaving(true);
    try {
      await updateWorkspaceSettings(workspaceId, { [cat]: merged });
      refresh?.();
      flashSaved();
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Save failed — check your connection and try again. (' + (err.message || err) + ')' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-section">
      <div className="settings-section-headrow">
        <h3 className="settings-section-title">Workspace defaults</h3>
        <span className={`settings-saved-flash ${saving || savedAt ? 'is-on' : ''}`}>{saving ? 'Saving…' : 'Saved ✓'}</span>
      </div>
      <p className="settings-section-hint">
        These set the starting look of every new card on this workspace.
        {canEdit
          ? ' Anyone you create now will pick these up; existing cards aren’t changed.'
          : ' You have viewer access — only editors and owners can change them.'}
      </p>

      <SettingsCategory title="Workspace icon" desc={isOwner ? 'Shows in the sidebar and switcher.' : 'Only owners can change the icon.'}>
        <Field label={workspaceName || 'Workspace'}>
          <AvatarUploadRow
            src={iconSrc}
            fallbackColor={pickPresenceColor(workspaceId || '')}
            fallbackInitial={((workspaceName || '?').trim().charAt(0) || '?').toUpperCase()}
            uploading={uploadingIcon}
            disabled={!isOwner}
            shape="square"
            onPick={onIconPick}
            onRemove={() => setIcon('')}
          />
        </Field>
      </SettingsCategory>

      {/* NOTES */}
      <SettingsCategory title="Notes" desc="When you create a sticky note">
        <Field label="Background">
          <SwatchInput
            value={settings.note?.bgColor ?? null}
            fallback={HARDCODED_FALLBACKS.note.bgColor}
            disabled={disabled}
            onChange={(v) => setKey('note', 'bgColor', v)} />
        </Field>
        <Field label="Text color">
          <SwatchInput
            value={settings.note?.textColor ?? null}
            fallback={HARDCODED_FALLBACKS.note.textColor}
            disabled={disabled}
            onChange={(v) => setKey('note', 'textColor', v)} />
        </Field>
        <Field label="Font">
          <FontField value={settings.note?.fontFamily ?? null}
                     disabled={disabled}
                     onChange={(v) => setKey('note', 'fontFamily', v)} />
        </Field>
        <Field label="Font size">
          <input type="number" min="8" max="36"
                 className="settings-input"
                 placeholder="12.5"
                 value={settings.note?.fontSize ?? ''}
                 disabled={disabled}
                 onChange={(e) => {
                   const v = e.target.value;
                   setKey('note', 'fontSize', v === '' ? null : Number(v));
                 }} />
        </Field>
      </SettingsCategory>

      {/* BOARDS */}
      <SettingsCategory title="Boards" desc="When you create a new board">
        <Field label="Default view">
          <select className="settings-input"
                  value={settings.board?.view ?? 'canvas'}
                  disabled={disabled}
                  onChange={(e) => setKey('board', 'view', e.target.value)}>
            <option value="canvas">Canvas</option>
            <option value="list">List</option>
          </select>
        </Field>
      </SettingsCategory>

      {/* DOCS */}
      <SettingsCategory title="Docs" desc="When you create a new doc">
        <Field label="Font">
          <FontField value={settings.doc?.fontFamily ?? null}
                     disabled={disabled}
                     onChange={(v) => setKey('doc', 'fontFamily', v)} />
        </Field>
      </SettingsCategory>

      {/* SHAPES */}
      <SettingsCategory title="Shapes" desc="When you draw a shape">
        <Field label="Stroke">
          <SwatchInput
            value={settings.shape?.stroke ?? null}
            fallback={HARDCODED_FALLBACKS.shape.stroke}
            disabled={disabled}
            onChange={(v) => setKey('shape', 'stroke', v)} />
        </Field>
        <Field label="Fill">
          <SwatchInput
            value={settings.shape?.fill ?? null}
            fallback={HARDCODED_FALLBACKS.shape.fill}
            allowTransparent
            disabled={disabled}
            onChange={(v) => setKey('shape', 'fill', v)} />
        </Field>
        <Field label="Stroke width">
          <input type="number" min="1" max="12"
                 className="settings-input"
                 value={settings.shape?.strokeWidth ?? HARDCODED_FALLBACKS.shape.strokeWidth}
                 disabled={disabled}
                 onChange={(e) => setKey('shape', 'strokeWidth', Number(e.target.value) || 2)} />
        </Field>
      </SettingsCategory>

      {isOwner && onOpenRecovery && (
        <SettingsCategory title="Workspace recovery" subtitle="Owner-only. Rewinds every board in this workspace atomically — useful after an accidental mass-delete. Each board's pre-rewind state is preserved so the operation is reversible.">
          <button type="button" className="settings-link-btn" onClick={onOpenRecovery}>
            Open recovery →
          </button>
        </SettingsCategory>
      )}
    </div>
  );
}

// ── Billing tab ─────────────────────────────────────────────────────────
// Shows the caller's current plan and an action appropriate to their tier:
//   admin     → "Unlimited admin access"
//   paid      → plan + status + next renewal, "Manage billing →" (Stripe Portal)
//   demo      → card count + "Upgrade to Creator" button (opens PricingModal)
//   waitlist  → defensive note (this surface shouldn't be reachable)
// ── Invite & earn tab — the permanent home for the referral link + stats ──
// Two-sided: the friend starts with +25 bonus cards; the referrer earns +25
// when that friend creates their first genuine card (granted server-side).
function ReferralStat({ label, value, highlight }) {
  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1,
                    color: highlight ? 'var(--soleil, #ffa500)' : 'var(--text-1, inherit)',
                    fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div className="settings-billing-label" style={{ marginTop: 2 }}>{label}</div>
    </div>
  );
}

function InviteTab({ user }) {
  const feedback = useFeedback();
  const [code, setCode] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getOrCreateMyReferralCode(), getMyReferralStats()])
      .then(([c, s]) => {
        if (cancelled) return;
        const resolved = c || s?.code || null;
        setCode(resolved);
        setStats(s || null);
        setLoading(false);
        try { logEvent(EV.REFERRAL_TAB_VIEW, { has_code: !!resolved }); } catch (_) {}
      })
      .catch(() => { if (!cancelled) { setErr(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [user?.id]);

  // window.location.origin so the link is correct wherever the app runs
  // (clusters.soleilpictures.com in prod). ?ref flows into signup metadata.
  const link = code ? `${window.location.origin}/?ref=${code}` : '';
  const canNativeShare = typeof navigator !== 'undefined' && !!navigator.share;

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      feedback.toast({ type: 'success', message: 'Invite link copied — share it anywhere.' });
    } catch (_) {
      feedback.toast({ type: 'info', message: link });
    }
    try { logEvent(EV.REFERRAL_LINK_COPIED, { surface: 'account_tab' }); } catch (_) {}
  };

  const share = async () => {
    if (!link) return;
    try { logEventNow(EV.REFERRAL_LINK_SHARED, { surface: 'account_tab' }); } catch (_) {}
    try {
      await navigator.share({
        title: 'Clusters',
        text: 'I’m using Clusters to organize ideas on an infinite canvas — here are 25 free cards to start.',
        url: link,
      });
    } catch (_) { /* user cancelled the share sheet, or it’s unsupported */ }
  };

  if (loading) {
    return <div className="settings-section"><div className="settings-empty">Loading…</div></div>;
  }

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Invite &amp; earn</h3>
      <p className="settings-section-hint">
        Share Clusters and you <b>both</b> get free cards. Your friend starts with
        {' '}<b>25 bonus cards</b>; the moment they place their first card, <b>you earn 25 too</b>.
        {' '}No limit — keep inviting, keep earning.
      </p>

      {err || !code ? (
        <div className="settings-empty">Couldn’t load your invite link. Reopen this tab to try again.</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              readOnly
              value={link}
              onFocus={(e) => e.target.select()}
              aria-label="Your invite link"
              style={{
                flex: '1 1 240px', minWidth: 0, padding: '9px 12px', borderRadius: 10,
                border: '1px solid var(--line-1, rgba(255,255,255,.14))',
                background: 'var(--surface-2, rgba(255,255,255,.04))',
                color: 'var(--text-1, inherit)', fontSize: 13,
              }}
            />
            <button type="button" className="settings-btn settings-btn-primary" onClick={copy}>Copy link</button>
            {canNativeShare && (
              <button type="button" className="settings-btn" onClick={share}>Share…</button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 22, marginTop: 18, flexWrap: 'wrap' }}>
            <ReferralStat label="Friends joined" value={stats?.friendsJoined ?? 0} />
            <ReferralStat label="Got started"    value={stats?.friendsActivated ?? 0} />
            <ReferralStat label="Cards earned"   value={stats?.cardsEarned ?? 0} highlight />
          </div>
          {stats?.pending > 0 && (
            <p className="settings-section-hint" style={{ marginTop: 12 }}>
              {stats.pending} {stats.pending === 1 ? 'friend has' : 'friends have'} joined but
              {' '}haven’t placed their first card yet — you’ll earn 25 cards each when they do.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function BillingTab({ user }) {
  const feedback = useFeedback();
  const { tier, demoCardCount, subscriptionStatus, currentPeriodEnd, cancelAtPeriodEnd,
          grantActive, grantExpiresAt, loading } =
    useMyTier({ userId: user?.id });
  const [sub, setSub] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    supabase.from('subscriptions')
      .select('plan, status, current_period_end, cancel_at_period_end')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setSub(data || null); });
    return () => { cancelled = true; };
  }, [user?.id]);

  const openPortal = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await startPortal({ surface: 'settings' });
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Could not open billing portal: ' + (e?.message || e) });
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="settings-section"><div className="settings-empty">Loading…</div></div>;
  }

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Billing</h3>
      <p className="settings-section-hint">
        Your current plan and payment management.
      </p>

      <BillingSummary
        tier={tier}
        sub={sub}
        subscriptionStatus={subscriptionStatus}
        currentPeriodEnd={currentPeriodEnd}
        cancelAtPeriodEnd={cancelAtPeriodEnd}
        grantActive={grantActive}
        grantExpiresAt={grantExpiresAt}
        demoCardCount={demoCardCount}
        busy={busy}
        onManage={openPortal}
        onUpgrade={() => setPricingOpen(true)} />

      {pricingOpen && <PricingModal onClose={() => setPricingOpen(false)} />}
    </div>
  );
}

// Shared billing block — rows + the primary CTA. Used by the in-modal
// Billing tab and by the standalone /settings/billing page (the Stripe
// Customer Portal return target). Callers own data fetching, error UI,
// and the upgrade modal so each surface can keep its own framing.
function fmtBytes(b) {
  if (b == null) return '—';
  const gb = b / (1024 ** 3);
  if (gb >= 1) return `${gb >= 10 ? Math.round(gb) : gb.toFixed(1)} GB`;
  const mb = b / (1024 ** 2);
  if (mb >= 1) return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
  return `${Math.round(b / 1024)} KB`;
}

// "X / 100 GB" usage meter for paid accounts (storage is a paid feature).
function StorageMeter() {
  const usage = useStorageUsage({ enabled: true });
  const pct = usage.quota ? Math.min(100, (usage.used / usage.quota) * 100) : 0;
  const near = pct >= 90;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span className="settings-billing-label">Storage</span>
        <span className="settings-billing-value" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {usage.loading ? '…' : `${fmtBytes(usage.used)} / ${usage.quota != null ? fmtBytes(usage.quota) : '—'}`}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: 'var(--line-1, rgba(255,255,255,.12))', overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${pct}%`, borderRadius: 999,
          background: near ? '#ef4444' : 'var(--soleil, #ffa500)',
          transition: 'width .3s ease',
        }} />
      </div>
    </div>
  );
}

export function BillingSummary({
  tier, sub, subscriptionStatus, currentPeriodEnd, cancelAtPeriodEnd,
  grantActive, grantExpiresAt, demoCardCount,
  busy, onManage, onUpgrade,
}) {
  const status = subscriptionStatus || sub?.status || null;
  // Paid access via an admin grant (no paying Stripe sub) — there's no portal to
  // manage, so we show the complimentary note instead of Stripe status/renewal.
  const grantBacked = tier === 'paid' && grantActive && !['active', 'trialing'].includes(status || '');
  const plan = planLabel({ tier, plan: sub?.plan, demoCardCount, grantBacked });
  // Prefer the fresh RPC value; fall back to the subscriptions-row query.
  const cancelPending = cancelAtPeriodEnd ?? !!sub?.cancel_at_period_end;
  const period = formatPeriodEnd(currentPeriodEnd || sub?.current_period_end, {
    cancel: cancelPending,
  });
  const grantLine = grantBacked ? grantCopy({ grantActive, grantExpiresAt }) : null;

  return (
    <>
      {tier === 'paid' && !grantBacked && cancelPending && period && (
        <div className="settings-billing-cancel-note">
          Subscription canceled — Creator access stays on until <b>{period.value}</b>.
          You can resubscribe anytime before then.
        </div>
      )}
      <div className="settings-billing-grid">
        <span className="settings-billing-label">Plan</span>
        <span className="settings-billing-value">{plan}</span>

        {tier === 'paid' && !grantBacked && (
          <>
            <span className="settings-billing-label">Status</span>
            <span className="settings-billing-value">{status || '—'}</span>
            {period && (
              <>
                <span className="settings-billing-label">{period.label}</span>
                <span className="settings-billing-value">{period.value}</span>
              </>
            )}
          </>
        )}

        {grantBacked && (
          <>
            <span className="settings-billing-label">Access</span>
            <span className="settings-billing-value">
              {grantExpiresAt ? `Through ${formatPeriodEnd(grantExpiresAt)?.value || '—'}` : 'No end date'}
            </span>
          </>
        )}
      </div>

      {tier === 'paid' && <StorageMeter />}

      {grantLine && (
        <p className="settings-section-hint" style={{ marginTop: 8 }}>
          {grantLine}
        </p>
      )}

      {tier === 'admin' && (
        <p className="settings-section-hint" style={{ marginTop: 8 }}>
          You have unlimited admin access — no subscription needed.
        </p>
      )}

      <div className="settings-row-actions">
        <span style={{ flex: 1 }} />
        {/* Grant-backed users have no Stripe customer — no portal to open. */}
        {tier === 'paid' && !grantBacked && onManage && (
          <button type="button"
                  className="settings-btn settings-btn-primary"
                  disabled={busy}
                  onClick={onManage}>
            {busy ? 'Opening…' : 'Manage billing →'}
          </button>
        )}
        {tier === 'demo' && onUpgrade && (
          <button type="button"
                  className="settings-btn settings-btn-primary"
                  onClick={onUpgrade}>
            Upgrade to Creator →
          </button>
        )}
      </div>
    </>
  );
}

function SettingsCategory({ title, desc, children }) {
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

// Visual preview of a color setting. `color` is the resolved fill (string)
// or null. When it's null/'transparent', renders a checker pattern instead
// of pretending — so the chip in Settings actually matches what shows up
// on the board.
function SwatchChip({ color, label, dimmed, disabled, onClick, refProp }) {
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

function SwatchInput({ value, fallback, onChange, disabled, allowTransparent = false }) {
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

function SizeInput({ w, h, wFallback, hFallback, onChange, disabled }) {
  return (
    <div className="settings-size-row">
      <input type="number" min="40" max="2000"
             className="settings-input settings-size-input"
             value={w ?? wFallback}
             disabled={disabled}
             onChange={(e) => onChange(Number(e.target.value) || wFallback, h ?? hFallback)} />
      <span className="settings-size-x">×</span>
      <input type="number" min="40" max="2000"
             className="settings-input settings-size-input"
             value={h ?? hFallback}
             disabled={disabled}
             onChange={(e) => onChange(w ?? wFallback, Number(e.target.value) || hFallback)} />
    </div>
  );
}

// ── Theme tab ───────────────────────────────────────────────────────────
function ThemeTab({ mySettings, refresh }) {
  const feedback = useFeedback();
  const ui = mySettings.ui || {};
  const setUi = async (patch) => {
    try {
      await updateOwnSettings({ ui: { ...ui, ...patch } });
      refresh?.();
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Save failed — check your connection and try again. (' + (err.message || err) + ')' });
    }
  };

  // Apply theme live on change so the user sees it instantly. applyThemeNow
  // sets data-theme AND mirrors it into the soleil.ui cache synchronously —
  // the same shared path the topbar quick toggle uses — so the two controls
  // and the next remount/cold-load can never disagree. setUi then persists
  // the choice server-side.
  const applyTheme = (theme) => {
    if (!theme) return;
    applyThemeNow(theme);
    setUi({ theme });
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Theme</h3>
      <p className="settings-section-hint">
        These are personal — they only affect how the app looks for you.
      </p>

      <Field label="Mode">
        <div className="settings-pill-row">
          <button type="button"
                  className={`settings-pill ${ui.theme === 'dark' || !ui.theme ? 'is-active' : ''}`}
                  onClick={() => applyTheme('dark')}>Dark</button>
          <button type="button"
                  className={`settings-pill ${ui.theme === 'light' ? 'is-active' : ''}`}
                  onClick={() => applyTheme('light')}>Light</button>
        </div>
      </Field>

      <Field label="Accent">
        <AccentPicker value={ui.accent || null} onChange={(v) => setUi({ accent: v })} />
      </Field>

      <Field label="Body font">
        <FontField value={ui.fontSans || null} onChange={(v) => setUi({ fontSans: v })} />
      </Field>
    </div>
  );
}

// Accent picker — preset dots + a "Custom" chip that opens the full
// ColorPicker modal so the user isn't capped at 8 swatches.
function AccentPicker({ value, onChange }) {
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
              onClick={(e) => {
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

// ── Display tab — clean mode + sidebar default ──────────────────────────
function DisplayTab({ mySettings, refresh }) {
  const feedback = useFeedback();
  const ui = mySettings.ui || {};
  const setUi = async (patch) => {
    try {
      await updateOwnSettings({ ui: { ...ui, ...patch } });
      refresh?.();
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Save failed — check your connection and try again. (' + (err.message || err) + ')' });
    }
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Display</h3>
      <p className="settings-section-hint">
        Personal layout preferences — only apply for you.
      </p>

      <Toggle
        label="Clean mode"
        desc="Hide the sidebar, toolbar, breadcrumb, and overlays. ⌘. toggles."
        value={!!ui.hideChrome}
        onChange={(v) => {
          if (v) document.body.setAttribute('data-clean-mode', '1');
          else document.body.removeAttribute('data-clean-mode');
          setUi({ hideChrome: v });
        }} />

      <Toggle
        label="Sidebar open by default"
        desc="When you launch the app, start with the sidebar expanded."
        value={ui.sidebarOpen !== false}
        onChange={(v) => setUi({ sidebarOpen: v })} />
    </div>
  );
}

// ── Notifications tab ───────────────────────────────────────────────────
// Per-user email toggles, default-on. Each key in profiles.notification_prefs
// is consulted by 0075 triggers via _email_pref_enabled() before firing.
function NotificationsTab({ user }) {
  const feedback = useFeedback();
  const [prefs, setPrefs] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('notification_prefs')
        .eq('user_id', user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        feedback.toast({ type: 'error', message: 'Could not load preferences: ' + (error.message || error) });
      }
      setPrefs(data?.notification_prefs || {});
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  // Missing key = enabled (matches the trigger-side helper).
  const isOn = (key) => (prefs?.[key] ?? true) !== false;

  const togglePref = async (key, value) => {
    const next = { ...(prefs || {}), [key]: value };
    setPrefs(next);
    const { error } = await supabase
      .from('profiles')
      .update({ notification_prefs: next })
      .eq('user_id', user.id);
    if (error) {
      feedback.toast({ type: 'error', message: 'Save failed — check your connection and try again. (' + (error.message || error) + ')' });
      // Roll back optimistic flip
      setPrefs(prefs);
    }
  };

  if (loading || !prefs) {
    return (
      <div className="settings-section">
        <h3 className="settings-section-title">Notifications</h3>
        <p className="settings-section-hint">Loading…</p>
      </div>
    );
  }

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Notifications</h3>
      <p className="settings-section-hint">
        Which emails Clusters should send you. Anything you don't toggle on still shows up in-app.
      </p>

      <Toggle
        label="@-mentions"
        desc="When someone @-mentions you in a board, DM, or workspace chat."
        value={isOn('email_mentions')}
        onChange={(v) => togglePref('email_mentions', v)} />

      <Toggle
        label="Comment replies"
        desc="When someone replies to a comment you left."
        value={isOn('email_comment_replies')}
        onChange={(v) => togglePref('email_comment_replies', v)} />

      <Toggle
        label="Workspace invites"
        desc="When you're added to a new workspace."
        value={isOn('email_workspace_invite')}
        onChange={(v) => togglePref('email_workspace_invite', v)} />

      <Toggle
        label="Board shares"
        desc="When a board is shared with you."
        value={isOn('email_board_shared')}
        onChange={(v) => togglePref('email_board_shared', v)} />

      <p className="settings-section-hint" style={{ marginTop: 16 }}>
        Sign-in codes and account-critical emails always send, regardless of these settings.
      </p>
    </div>
  );
}

// ── Generic field wrappers ──────────────────────────────────────────────
function Field({ label, children }) {
  return (
    <div className="settings-field">
      <span className="settings-field-label">{label}</span>
      <div className="settings-field-control">{children}</div>
    </div>
  );
}

function Toggle({ label, desc, value, onChange }) {
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
