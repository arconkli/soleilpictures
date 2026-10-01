// feedbackEnv — the browser half of feedbackContext: the ambient record every
// ask attaches. Kept apart so feedbackContext.js stays pure and node-testable
// (analytics.js reads import.meta.env and cannot load under node).

import { getAnalyticsContext } from './analytics.js';
import { getDeviceInfo } from './device.js';
import { BUILD_SHA } from './buildInfo.js';

export function feedbackEnv() {
  const env = {};
  try {
    const a = getAnalyticsContext();
    env.surface = a.surface;
    env.board_id = a.board_id;
    env.tier = a.tier;
  } catch (_) { /* no analytics context yet */ }
  try {
    const d = getDeviceInfo();
    env.device = d.device_type;
    env.os = d.os;
    env.browser = d.browser;
  } catch (_) {}
  // 'dev' is an unstamped local build — the same rule analytics.js applies.
  if (BUILD_SHA && BUILD_SHA !== 'dev' && BUILD_SHA !== 'unknown') env.build = BUILD_SHA;
  try { env.path = window.location.pathname; } catch (_) {}
  return env;
}
