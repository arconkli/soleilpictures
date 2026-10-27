// teamProbe — mounts the Team page on the test team, for tests/team-preview.spec.js.
//
// Why a probe: ?local=1 renders its own simplified shell, so the page is mounted
// directly over it. Lives in src/ for the same reason as shareWorkspaceProbe.js
// (Vite only rewrites bare module specifiers in files it transforms). Imported by
// NOTHING in the app; the spec reaches it over the dev server by path, so it is
// in no chunk and ships nowhere.
import React from 'react';
import * as ReactDOM from 'react-dom/client';

import TeamPage from '../components/team/TeamPage.jsx';
import { WorkspaceMenu } from '../components/WorkspaceMenu.jsx';
import TeamSetup from '../components/team/TeamSetup.jsx';
import { PricingPageView } from '../auth/PricingPageView.jsx';
import { sampleTeam } from '../lib/teamSample.js';
import { teamHeroLine } from '../lib/teamModel.js';
import { EDITOR_LIMIT } from '../lib/editorLimit.js';
import { writeTeamPreview } from '../lib/teamPreview.js';

// Records what the page asked the app to do on window.__team.
export function mountTeamPage({ as = 'owner', tab = 'people' } = {}) {
  window.__team = { closed: 0, toasts: [] };
  const el = document.createElement('div');
  el.className = 'team-probe-host';
  document.body.appendChild(el);
  ReactDOM.createRoot(el).render(React.createElement(TeamPage, {
    team: sampleTeam(as),
    initialTab: tab,
    onClose: () => { window.__team.closed += 1; },
    onToast: (m) => window.__team.toasts.push(m),
  }));
  return true;
}

// The workspace switcher with the team's section on top, two plain workspaces
// under it. Records what the menu asked for on window.__teamMenu.
export function mountTeamMenu({ as = 'owner' } = {}) {
  const t = sampleTeam(as);
  const calls = { openPage: 0, picked: [], close: 0 };
  window.__teamMenu = calls;
  const el = document.createElement('div');
  el.className = 'team-probe-host';
  el.style.cssText = 'position:fixed;left:12px;top:12px;width:300px;height:0;z-index:9999';
  document.body.appendChild(el);
  const ws = (id, name) => ({ id, name, created_by: 'me', created_at: id });
  ReactDOM.createRoot(el).render(React.createElement(WorkspaceMenu, {
    workspaces: [ws('w1', 'Pitch decks'), ws('w2', 'Scratch')],
    activeWorkspaceId: 'w1',
    personalWorkspaceId: 'w1',
    selfUserId: 'me',
    triggerSelector: null,
    onSelect: () => {},
    onAddNew: () => {},
    onClose: () => { calls.close += 1; },
    team: {
      name: t.name,
      workspaces: t.workspaces,
      manage: t.me.role !== 'member',
      viewOnly: t.status === 'view_only',
      onOpenPage: () => { calls.openPage += 1; },
      onPickWorkspace: (w) => calls.picked.push(w.id),
    },
  }));
  return true;
}

// /pricing as a signed-in demo user sees it, with the team preview's third card.
// Records what the card asked for on window.__teamBuy.
function PricingProbe({ initialPlan }) {
  const [plan, setPlan] = React.useState(initialPlan);
  const [seats, setSeats] = React.useState(12);
  const [talkNote, setTalkNote] = React.useState(false);
  return React.createElement(PricingPageView, {
    plan,
    onPlanToggle: setPlan,
    freeCta: null,
    creatorCta: { label: 'Get Creator', onClick: () => {}, disabled: false, busy: false },
    teamCard: {
      plan, seats, setSeats, talkNote, heroLine: teamHeroLine(EDITOR_LIMIT), editorLimit: EDITOR_LIMIT,
      onStart: () => window.__teamBuy.started.push({ seats, plan }),
      onTalk: () => { window.__teamBuy.talks += 1; setTalkNote(true); },
    },
  });
}

export function mountPricingTeam({ plan = 'monthly' } = {}) {
  window.__teamBuy = { started: [], talks: 0, nav: [] };
  const el = document.createElement('div');
  el.className = 'team-probe-host';
  document.body.appendChild(el);
  ReactDOM.createRoot(el).render(React.createElement(PricingProbe, { initialPlan: plan }));
  return true;
}

// The buying walk-through's setup at /team/new, reading ?seats= and ?billing=
// from `search`. Navigation goes through the page's `navigate` prop and is
// recorded on window.__teamBuy.nav.
export function mountTeamSetup({ search = '' } = {}) {
  // The walk-through's sample, as Settings › Preview starts it (PreviewTab):
  // on dev teamsAllowed() is true, so without a sample role the setup is real.
  writeTeamPreview('owner');
  window.history.replaceState(null, '', '/team/new' + search);
  window.__teamBuy = { started: [], talks: 0, nav: [] };
  const el = document.createElement('div');
  el.className = 'team-probe-host';
  document.body.appendChild(el);
  ReactDOM.createRoot(el).render(React.createElement(TeamSetup, {
    user: { email: 'alex@northlight.studio' },
    navigate: (u) => window.__teamBuy.nav.push(u),
  }));
  return true;
}
