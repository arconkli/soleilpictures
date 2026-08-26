// Notifications — per-user email toggles, default-on. Each key in
// profiles.notification_prefs is consulted by 0075 triggers via
// _email_pref_enabled() before firing.
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useFeedback } from '../AppFeedback.jsx';
import { Toggle } from './fields.jsx';

export function NotificationsTab({ user }) {
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

      <Toggle
        label="Schedule changes"
        desc="When a day you can see moves, or its call sheet is published. Only sent if you're not already in the app."
        value={isOn('email_schedule')}
        onChange={(v) => togglePref('email_schedule', v)} />

      <Toggle
        label="Share link activity"
        desc="When someone opens a cluster you shared. A count, never who they were — they never signed in. At most one a day, and only if you're not already in the app."
        value={isOn('email_share_activity')}
        onChange={(v) => togglePref('email_share_activity', v)} />

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
