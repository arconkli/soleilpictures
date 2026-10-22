// teamPreview — Settings › Preview's "Open a test team as…" (the owner,
// 2026-10-21: "give me a way as an admin to go into like a 'team view'").
// Preview host and dev only, per browser, look only: the test team
// (lib/teamSample.js) shows at the top of the workspace menu and on its team
// page, and nothing it does leaves the browser.
//
// Whether the team page is open is memory only (openTeamPage below): a reload
// is always the app as it is, with the menu's team row one click away.
import { useSyncExternalStore } from 'react';
import { editorLimitPreviewAvailable } from './editorLimitPreview.js';

export const TEAM_PREVIEW_KEY = 'soleil.preview.teamAs';
export const TEAM_PREVIEW_EVENT = 'soleil:team-preview';
export const TEAM_PREVIEW_ROLES = ['owner', 'admin', 'member', 'unpaid'];

export function teamPreviewAvailable() {
  return editorLimitPreviewAvailable();
}

export function readTeamPreview() {
  if (!teamPreviewAvailable()) return null;
  try {
    const v = window.localStorage.getItem(TEAM_PREVIEW_KEY);
    return TEAM_PREVIEW_ROLES.includes(v) ? v : null;
  } catch (_) { return null; }
}

export function writeTeamPreview(as) {
  try {
    if (TEAM_PREVIEW_ROLES.includes(as)) window.localStorage.setItem(TEAM_PREVIEW_KEY, as);
    else window.localStorage.removeItem(TEAM_PREVIEW_KEY);
  } catch (_) {}
  if (!TEAM_PREVIEW_ROLES.includes(as)) closeTeamPage();
  try { window.dispatchEvent(new Event(TEAM_PREVIEW_EVENT)); } catch (_) {}
}

function subscribePreview(fn) {
  window.addEventListener(TEAM_PREVIEW_EVENT, fn);
  window.addEventListener('storage', fn);
  return () => {
    window.removeEventListener(TEAM_PREVIEW_EVENT, fn);
    window.removeEventListener('storage', fn);
  };
}

export function useTeamPreview() {
  return useSyncExternalStore(subscribePreview, readTeamPreview, () => null);
}

// ── The team page: open or not, and on which tab ───────────────────────────
let page = null; // null, or { tab }
const listeners = new Set();

export const TEAM_PAGE_TABS = ['people', 'billing', 'joining'];

export function openTeamPage(tab = 'people') {
  page = { tab: TEAM_PAGE_TABS.includes(tab) ? tab : 'people' };
  for (const fn of listeners) { try { fn(); } catch (_) {} }
}

export function closeTeamPage() {
  if (!page) return;
  page = null;
  for (const fn of listeners) { try { fn(); } catch (_) {} }
}

export function teamPageState() {
  return page;
}

function subscribePage(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useTeamPage() {
  return useSyncExternalStore(subscribePage, teamPageState, () => null);
}
