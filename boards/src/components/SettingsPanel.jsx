// Settings panel — tabbed home for everything user/workspace-scoped.
// Replaces the old single-purpose AccountSettings modal:
//
//   Profile   — display_name + presence color (per-user, today's UI)
//   Defaults  — note/board/doc/shape/palette defaults (workspace OR per-user)
//   Theme     — light/dark, accent color, font picks (per-user)
//   Templates — list / rename / delete saved board templates
//   Display   — clean-mode + sidebar default (per-user)
//
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
} from '../lib/boardsApi.js';
import { supabase } from '../lib/supabase.js';
import { useFeedback } from './AppFeedback.jsx';
import { useMyTier } from '../hooks/useMyTier.js';
import { PricingModal } from './PricingModal.jsx';
import { ColorPicker } from './ColorPicker.jsx';
import { COVER_TINTS } from './primitives.jsx';
import { HARDCODED_FALLBACKS } from '../hooks/useResolvedDefaults.js';
import {
  listBoardTemplates, deleteBoardTemplate, renameBoardTemplate,
} from '../lib/templatesApi.js';

const TABS = [
  { id: 'profile',   label: 'Profile' },
  { id: 'billing',   label: 'Billing' },
  { id: 'defaults',  label: 'Defaults' },
  { id: 'theme',     label: 'Theme' },
  { id: 'templates', label: 'Templates' },
  { id: 'display',   label: 'Display' },
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
  workspaceId, onWorkspacesChanged,
  onSaved,
  // 'account' = avatar-style identity-only modal (Profile tab + sign out).
  // 'workspace' = the cog-style settings (Defaults/Theme/Templates/Display).
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
}) {
  // Filter tabs by mode + pick the first as default.
  //   account   = personal identity stuff (Profile + Billing)
  //   workspace = cog-style settings (Defaults/Theme/Templates/Display)
  //   full      = every tab
  const visibleTabs = mode === 'account'
    ? TABS.filter(t => t.id === 'profile' || t.id === 'billing')
    : mode === 'workspace'
      ? TABS.filter(t => t.id !== 'profile' && t.id !== 'billing')
      : TABS;
  const [tab, setTab] = useState(visibleTabs[0]?.id || 'profile');
  // If the user reopens the panel in a different mode, the previously
  // selected tab can be invalid — snap back to the first visible.
  useEffect(() => {
    if (!visibleTabs.find(t => t.id === tab)) setTab(visibleTabs[0]?.id || 'profile');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
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
              <ProfileTab user={user} onSaved={onSaved} />
            )}
            {tab === 'billing' && (
              <BillingTab user={user} />
            )}
            {tab === 'defaults' && (
              <DefaultsTab workspaceId={workspaceId}
                           role={role}
                           workspaceSettings={workspaceSettings}
                           mySettings={mySettings}
                           refresh={refresh}
                           onOpenRecovery={onOpenRecovery} />
            )}
            {tab === 'theme' && (
              <ThemeTab mySettings={mySettings} refresh={refresh} />
            )}
            {tab === 'templates' && (
              <TemplatesTab workspaceId={workspaceId} role={role} />
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
function ProfileTab({ user, onSaved }) {
  const feedback = useFeedback();
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [initial, setInitial] = useState({ name: '', color: '' });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pickerPos, setPickerPos] = useState(null);
  const chipRef = useRef(null);

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
        setName(n); setColor(c);
        setInitial({ name: n, color: c });
      })
      .catch(err => {
        feedback.toast({ type: 'error', message: 'Could not load profile.' });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user?.id]);

  const dirty = name.trim() !== initial.name.trim() || (color || '') !== (initial.color || '');

  const onSave = async () => {
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
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Save failed: ' + (err.message || err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Profile</h3>
      <Field label="Display name">
        <input className="settings-input"
               value={name}
               placeholder={user?.email?.split('@')[0] || 'Your name'}
               onChange={(e) => setName(e.target.value)}
               disabled={loading || saving} />
      </Field>
      <Field label="Presence color">
        <div className="settings-color-row">
          <button ref={chipRef}
                  type="button"
                  className="settings-color-chip"
                  style={{ background: color || '#4f8df8' }}
                  onClick={() => {
                    const r = chipRef.current?.getBoundingClientRect();
                    if (r) setPickerPos({ x: r.left + r.width / 2, y: r.top });
                  }}
                  disabled={loading || saving}>
            <span>{color ? color.toUpperCase() : 'Pick'}</span>
          </button>
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
          value={color || '#4f8df8'}
          onChange={(c) => setColor(c)}
          onClose={() => setPickerPos(null)}
          position={pickerPos}
          allowTransparent={false} />
      )}
    </div>
  );
}

// ── Defaults tab — workspace-wide defaults for new cards ─────────────────
// Editable by workspace editors and owners only. Viewers see the values
// for context but the inputs are disabled. Changes apply to every member
// when they create a new card next.
function DefaultsTab({ workspaceId, role, workspaceSettings, refresh, onOpenRecovery }) {
  const feedback = useFeedback();
  const canEdit = role === 'editor' || role === 'owner';
  const isOwner = role === 'owner';
  const disabled = !canEdit;
  // "Saved ✓" flash that fades after each successful save.
  const [savedAt, setSavedAt] = useState(0);
  const flashSaved = () => setSavedAt(Date.now());
  useEffect(() => {
    if (!savedAt) return;
    const t = setTimeout(() => setSavedAt(0), 1600);
    return () => clearTimeout(t);
  }, [savedAt]);

  const settings = workspaceSettings;
  const setKey = (cat, key, value) => savePatch(cat, { [key]: value });
  const savePatch = async (cat, patch) => {
    if (!canEdit || !workspaceId) return;
    const merged = { ...(settings[cat] || {}), ...patch };
    // Prune empties so the hardcoded fallback shines through.
    for (const k of Object.keys(merged)) {
      if (merged[k] === null || merged[k] === undefined || merged[k] === '') delete merged[k];
    }
    try {
      await updateWorkspaceSettings(workspaceId, { [cat]: merged });
      refresh?.();
      flashSaved();
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Save failed: ' + (err.message || err) });
    }
  };

  return (
    <div className="settings-section">
      <div className="settings-section-headrow">
        <h3 className="settings-section-title">Workspace defaults</h3>
        <span className={`settings-saved-flash ${savedAt ? 'is-on' : ''}`}>Saved ✓</span>
      </div>
      <p className="settings-section-hint">
        These set the starting look of every new card on this workspace.
        {canEdit
          ? ' Anyone you create now will pick these up; existing cards aren’t changed.'
          : ' You have viewer access — only editors and owners can change them.'}
      </p>

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
function BillingTab({ user }) {
  const feedback = useFeedback();
  const { tier, demoCardCount, subscriptionStatus, currentPeriodEnd, loading } =
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
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error('Not signed in.');
      const url = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/create-portal-session';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) throw new Error(body.error || `HTTP ${res.status}`);
      window.location.assign(body.url);
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Could not open billing portal: ' + (e?.message || e) });
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="settings-section"><div className="settings-empty">Loading…</div></div>;
  }

  const planLabel =
    tier === 'admin' ? 'Admin · Unlimited'
    : tier === 'paid' ? (sub?.plan === 'annual' ? 'Creator · Annual ($240/yr)' : 'Creator · Monthly ($25/mo)')
    : tier === 'demo' ? `Free Demo · ${demoCardCount}/100 cards`
    : 'Waitlist · not yet active';

  const periodLabel = currentPeriodEnd || sub?.current_period_end
    ? new Date(currentPeriodEnd || sub?.current_period_end).toLocaleDateString(undefined,
        { month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Billing</h3>
      <p className="settings-section-hint">
        Your current plan and payment management.
      </p>

      <Field label="Plan">
        <div className="settings-readonly">{planLabel}</div>
      </Field>

      {tier === 'paid' && (
        <>
          <Field label="Status">
            <div className="settings-readonly">{subscriptionStatus || sub?.status || '—'}</div>
          </Field>
          {periodLabel && (
            <Field label={sub?.cancel_at_period_end ? 'Ends' : 'Renews'}>
              <div className="settings-readonly">{periodLabel}</div>
            </Field>
          )}
        </>
      )}

      {tier === 'admin' && (
        <p className="settings-section-hint" style={{ marginTop: 8 }}>
          You have unlimited admin access — no subscription needed.
        </p>
      )}

      <div className="settings-row-actions">
        <span style={{ flex: 1 }} />
        {tier === 'paid' && (
          <button type="button"
                  className="settings-btn settings-btn-primary"
                  disabled={busy}
                  onClick={openPortal}>
            {busy ? 'Opening…' : 'Manage billing →'}
          </button>
        )}
        {tier === 'demo' && (
          <button type="button"
                  className="settings-btn settings-btn-primary"
                  onClick={() => setPricingOpen(true)}>
            Upgrade to Creator →
          </button>
        )}
      </div>

      {pricingOpen && <PricingModal onClose={() => setPricingOpen(false)} />}
    </div>
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

function SwatchInput({ value, fallback, onChange, disabled, allowTransparent = false }) {
  const [pickerPos, setPickerPos] = useState(null);
  const ref = useRef(null);
  const showing = value || fallback || '#4f8df8';
  return (
    <div className="settings-color-row">
      <button ref={ref}
              type="button"
              className="settings-color-chip"
              style={{ background: showing }}
              disabled={disabled}
              onClick={() => {
                const r = ref.current?.getBoundingClientRect();
                if (r) setPickerPos({ x: r.left + r.width / 2, y: r.top });
              }}>
        <span>{value ? value.toUpperCase() : <em>default</em>}</span>
      </button>
      {value && (
        <button type="button" className="settings-link-btn"
                onClick={() => onChange(null)}
                disabled={disabled}>Reset</button>
      )}
      {pickerPos && (
        <ColorPicker
          value={showing}
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
      feedback.toast({ type: 'error', message: 'Save failed: ' + (err.message || err) });
    }
  };

  // Apply theme attribute live on change so the user sees it instantly.
  const applyTheme = (theme) => {
    if (!theme) return;
    document.documentElement.setAttribute('data-theme', theme);
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

// ── Templates tab ───────────────────────────────────────────────────────
function TemplatesTab({ workspaceId, role }) {
  const feedback = useFeedback();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const canManage = role === 'editor' || role === 'owner';

  const refetch = async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const list = await listBoardTemplates(workspaceId);
      setItems(list || []);
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Could not load templates.' });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { refetch(); }, [workspaceId]);

  const onRename = async (t) => {
    const next = await feedback.prompt({
      title: 'Rename template',
      label: 'Name',
      defaultValue: t.name || '',
      confirmLabel: 'Rename',
    });
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === t.name) return;
    try {
      await renameBoardTemplate(t.id, trimmed);
      refetch();
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Rename failed: ' + (err.message || err) });
    }
  };

  const onDelete = async (t) => {
    const ok = await feedback.confirm({
      title: 'Delete template',
      message: `Delete "${t.name || 'Untitled'}"? This can't be undone.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await deleteBoardTemplate(t.id);
      refetch();
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Delete failed: ' + (err.message || err) });
    }
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Templates</h3>
      <p className="settings-section-hint">
        Saved board templates show up when you create a new board.
        Save a template from any board's right-click menu.
      </p>
      {loading && <div className="settings-empty">Loading…</div>}
      {!loading && items.length === 0 && (
        <div className="settings-empty">No templates yet.</div>
      )}
      <div className="settings-templates-grid">
        {items.map(t => {
          const tint = COVER_TINTS[t.cover || 'neutral'] || COVER_TINTS.neutral;
          return (
            <div key={t.id} className="settings-template-tile">
              <div className="settings-template-cover" style={{ background: tint }}>
                <span className="settings-template-tag">{t.scope === 'user' ? 'PERSONAL' : 'WORKSPACE'}</span>
              </div>
              <div className="settings-template-meta">
                <span className="settings-template-name">{t.name || 'Untitled'}</span>
                {canManage && (
                  <div className="settings-template-actions">
                    <button type="button" className="settings-link-btn"
                            onClick={() => onRename(t)}>Rename</button>
                    <button type="button" className="settings-link-btn settings-link-btn-danger"
                            onClick={() => onDelete(t)}>Delete</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
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
      feedback.toast({ type: 'error', message: 'Save failed: ' + (err.message || err) });
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
            role="switch"
            aria-checked={value}>
        <span className="settings-toggle-thumb" />
      </span>
    </label>
  );
}
