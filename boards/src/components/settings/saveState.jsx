// One save indicator and one error path for the whole Settings panel.
//
// Before this, five tabs each hand-rolled the same catch block with the same
// string, and exactly one of them — Workspace defaults — showed a
// "Saving… → Saved ✓" flash. So whether a change had landed depended on which
// tab you happened to be looking at. The shell owns the state now and every
// tab reports through the same call.
//
// The flash matters on a slow connection: without it, a settings write that
// takes a second reads as "did that do anything?" and people click twice.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useFeedback } from '../AppFeedback.jsx';

// Default is a passthrough so a tab rendered outside the panel (tests, a
// future standalone page) still works rather than throwing on a missing
// provider — it just loses the indicator.
const SettingsSaveContext = createContext(async (fn) => { await fn(); return true; });

export function useSettingsSave() {
  return useContext(SettingsSaveContext);
}

export function SettingsSaveProvider({ value, children }) {
  return (
    <SettingsSaveContext.Provider value={value}>{children}</SettingsSaveContext.Provider>
  );
}

// Shell-side half. Returns the `save` to provide plus the two flags the
// indicator reads.
export function useSettingsSaveState() {
  const feedback = useFeedback();
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  // Counted, not boolean: a tab can fire two writes at once (flip a toggle,
  // then a colour) and the first to finish must not clear the indicator while
  // the second is still in flight.
  const pending = useRef(0);

  useEffect(() => {
    if (!savedAt) return;
    const t = setTimeout(() => setSavedAt(0), 1600);
    return () => clearTimeout(t);
  }, [savedAt]);

  const save = useCallback(async (fn) => {
    pending.current += 1;
    setSaving(true);
    try {
      await fn();
      setSavedAt(Date.now());
      return true;
    } catch (err) {
      feedback.toast({
        type: 'error',
        message: 'Save failed — check your connection and try again. (' + (err.message || err) + ')',
      });
      return false;
    } finally {
      pending.current = Math.max(0, pending.current - 1);
      if (pending.current === 0) setSaving(false);
    }
  }, [feedback]);

  return { save, saving, savedAt };
}

export function SettingsSavedFlash({ saving, savedAt }) {
  return (
    <span className={`settings-saved-flash ${saving || savedAt ? 'is-on' : ''}`}
          aria-live="polite">
      {saving ? 'Saving…' : 'Saved ✓'}
    </span>
  );
}
