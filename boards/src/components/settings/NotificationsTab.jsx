// Notifications — per-user email toggles, default-on. Each key in
// profiles.notification_prefs is consulted by 0075 triggers via
// _email_pref_enabled() before firing.
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useFeedback } from '../AppFeedback.jsx';
import { Toggle } from './fields.jsx';
import { useSettingsSave } from './saveState.jsx';

export function NotificationsTab({ user }) {
  const feedback = useFeedback();
  const save = useSettingsSave();
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
    const prev = prefs;
    const next = { ...(prefs || {}), [key]: value };
    setPrefs(next);
    const ok = await save(async () => {
      const { error } = await supabase
        .from('profiles')
        .update({ notification_prefs: next })
        .eq('user_id', user.id);
      if (error) throw error;
    });
    // Roll back the optimistic flip. A switch that reads "on" for an email
    // that will not send is worse than a switch that snaps back.
    if (!ok) setPrefs(prev);
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
        desc="When someone @-mentions you in a cluster, DM, or workspace chat."
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
        desc="When a cluster is shared with you."
        value={isOn('email_board_shared')}
        onChange={(v) => togglePref('email_board_shared', v)} />

      {/* The other half of the same trigger as Board shares (0189): 'share'
          fires that one, 'joined' fires this one. It shipped gated on a
          preference key that had no switch, and a missing key reads as
          enabled — so this was an email nobody could turn off, on a screen
          whose whole promise is which emails we send you. */}
      <Toggle
        label="Invite accepted"
        desc="When someone you invited opens your link and joins a cluster. Only sent if you're not already in the app."
        value={isOn('email_invite_accepted')}
        onChange={(v) => togglePref('email_invite_accepted', v)} />

      <Toggle
        label="Schedule changes"
        desc="When a day you can see moves, or its call sheet is published. Only sent if you're not already in the app."
        value={isOn('email_schedule')}
        onChange={(v) => togglePref('email_schedule', v)} />

      <Toggle
        label="Product tips & check-ins"
        desc="Occasional nudges to help you get started and get back in when it's been a while."
        value={isOn('email_lifecycle')}
        onChange={(v) => togglePref('email_lifecycle', v)} />

      <p className="settings-section-hint" style={{ marginTop: 16 }}>
        Sign-in codes and account-critical emails always send, regardless of these settings.
      </p>
    </div>
  );
}
