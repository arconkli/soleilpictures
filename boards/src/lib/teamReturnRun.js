// teamReturnRun — what landing on /team does, once App has read the URL
// (readTeamReturn, at its first render) and the person's teams have loaded:
// Stripe's success (?checkout=cs_…) verifies, retrying while Stripe finishes;
// a backed-out checkout lands on the team's billing, or back in setup; the
// Customer Portal's return (?billing=1) opens billing; the plain link opens
// the page, or setup when there's no team yet. Loaded on demand, so the app's
// own bundle carries none of it.
import { verifyWithRetry } from './teamReturn.js';
import { verifyTeamCheckout } from './teamBillingApi.js';
import { refusalLine } from './teamCopy.js';
import { teamsAllowed } from './appHost.js';

const urlTo = (path) => { try { window.history.replaceState({}, '', path); } catch (_) {} };

// deps: { hasTeam, toast(message), reloadTeams(), refreshWorkspaces(), open(tab) }.
// open(tab) waits for the team to be in the list (after a checkout it arrives
// with the reload).
export async function runTeamReturn(ret, deps) {
  if (ret.kind === 'checkout') {
    let answer;
    try { answer = await verifyWithRetry(verifyTeamCheckout, ret.sessionId); }
    catch (_) { answer = { ok: false, error: 'network' }; }
    if (answer?.ok) {
      urlTo('/team');
      deps.reloadTeams();
      deps.refreshWorkspaces();
      try { window.dispatchEvent(new Event('soleil:teams-changed')); } catch (_) {}
      deps.toast(answer.created ? 'Your team is ready. Invite your people.'
        : answer.kind === 'renew' ? 'The team is paid up. Editing is back on.' : 'Payment received.');
      deps.open(answer.created ? 'joining' : 'billing');
    } else if (answer?.gaveUp) {
      deps.toast("Stripe is still confirming the payment. We'll open your team as soon as it's through.");
      deps.reloadTeams();
      urlTo('/');
    } else {
      deps.toast(refusalLine({ code: answer?.error }));
      urlTo('/');
    }
  } else if (ret.kind === 'canceled') {
    // App's checkout-canceled notice says nothing was charged; this only lands the person.
    if (deps.hasTeam) deps.open('billing');
    else if (teamsAllowed()) window.location.assign('/team/new');
  } else if (ret.kind === 'billing') {
    if (deps.hasTeam) deps.open('billing');
    urlTo('/team');
  } else if (deps.hasTeam) {
    deps.open('people');
  } else if (teamsAllowed()) {
    window.location.assign('/team/new');
  } else {
    urlTo('/');
  }
}
