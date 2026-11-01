// firstVisitTip.js — the little how-to-get-around tip a signed-out visitor sees
// once, on a /share page. Pure: the component (components/FirstVisitTip.jsx)
// owns the DOM, this owns the steps.
//
//   cluster with clusters inside:  open  ->  back  ->  done
//   cluster with nothing inside:   move  ->  done
//
// Events: 'opened_cluster' (the visitor opened one), 'went_back' (they came
// back up, by the crumb or the browser's back), 'tap' (any tap on the board),
// 'dismiss' (the Got it button).
//
// A step is finished two ways and the event stream tells them apart: DONE when
// the visitor did the thing the tip asked, SKIPPED when they pressed Got it or
// tapped something else. Neither shows the tip again.

export const TIP_KEY = 'soleil.firstVisitTip.v1';

export function initialTipState({ hasSubClusters = false, isPhone = false, seen = false } = {}) {
  return {
    step: seen ? 'done' : (hasSubClusters ? 'open' : 'move'),
    hasSubClusters: !!hasSubClusters,
    isPhone: !!isPhone,
  };
}

// The sub-cluster map can arrive after the tip mounts. Until the visitor has
// done anything, the starting step follows it: 'open' with clusters inside,
// 'move' without. Returns the same object when nothing changes.
export function retargetTip(state, hasSubClusters) {
  if (!state || (state.step !== 'open' && state.step !== 'move')) return state;
  const has = !!hasSubClusters;
  if (state.hasSubClusters === has) return state;
  return { ...state, step: has ? 'open' : 'move', hasSubClusters: has };
}

// The step after `event`. Returns the same object when nothing changed, so a
// caller can tell by identity.
export function tipReducer(state, event) {
  if (!state || state.step === 'done') return state;
  const done = { ...state, step: 'done' };
  switch (state.step) {
    case 'open':
      if (event === 'opened_cluster') return { ...state, step: 'back' };
      if (event === 'tap' || event === 'dismiss') return done;
      return state;
    case 'back':
      if (event === 'went_back' || event === 'tap' || event === 'dismiss') return done;
      return state;
    case 'move':
      if (event === 'tap' || event === 'dismiss') return done;
      return state;
    default:
      return state;
  }
}

// What an event meant for the step it ended: { step, action } for the event
// 'share_tip', or null when the event changed nothing.
export function tipOutcome(state, event) {
  const next = tipReducer(state, event);
  if (next === state) return null;
  const did = (state.step === 'open' && event === 'opened_cluster')
    || (state.step === 'back' && event === 'went_back')
    // Dragging or tapping the board IS what the last tip asked for.
    || (state.step === 'move' && event === 'tap');
  return { step: state.step, action: did ? 'done' : 'skipped' };
}

// The words. `parentName` is the cluster the back step points at.
export function tipCopy(state, parentName = '') {
  const phone = !!state?.isPhone;
  const verb = phone ? 'Tap' : 'Click';
  switch (state?.step) {
    case 'open':
      return {
        title: `${verb} a cluster to open it`,
        hint: phone ? 'Drag to move around, pinch to zoom.' : 'Clusters can hold more clusters inside.',
      };
    case 'back':
      return {
        title: parentName ? `${verb} ${parentName} to go back` : `${verb} the cluster above to go back`,
        hint: 'Your browser’s back button works too.',
      };
    case 'move':
      return {
        title: phone ? 'Drag to move around, pinch to zoom' : 'Drag to look around, scroll to zoom',
        hint: '',
      };
    default:
      return { title: '', hint: '' };
  }
}

// Dots under the text: two for a cluster with clusters inside, none otherwise.
export function tipDots(state) {
  if (!state?.hasSubClusters || state.step === 'done') return null;
  return { total: 2, on: state.step === 'back' ? 1 : 0 };
}

// Once per device. A storage that throws counts as "not seen", and the
// component then shows it once per page load.
export function readTipSeen(storage) {
  try { return storage?.getItem(TIP_KEY) === 'done'; } catch (_) { return false; }
}

export function markTipSeen(storage) {
  try { storage?.setItem(TIP_KEY, 'done'); } catch (_) { /* once per page load */ }
}
