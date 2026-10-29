// useSignupBoxArm — which arm of the visitor test signup_box this page shows
// (experiments.js; the box is components/public/SignupBox.jsx).
//
// Decided during render, before any effect, so the page's lp_view (fired from
// useLandingEngagement's mount effect) already carries exp_signup_box. Only a
// page that can show the box enrolls (`eligible`), so the test holds only
// devices that saw one of its pages. 'A' — today's page — for everyone not in
// the test: crawlers, signed-in people, before the start date.
//
// ?preview=signupbox (production too) shows B to anyone, signed in included,
// without enrolling; analytics.js marks those events synthetic, so the read
// never sees them (visitorArms.js isBoxPreview).
//
// Dev only: ?sbox=A or ?sbox=B forces an arm without enrolling. Behind the
// literal import.meta.env.DEV guard, so production builds drop it.
import { useMemo } from 'react';
import { getDeviceId } from '../lib/analytics.js';
import { isBoxPreview } from '../lib/visitorArms.js';
import { getDeviceInfo } from '../lib/device.js';
import { enrollVisitor } from '../lib/visitorEnroll.js';

// This device's arm, or null when it is not in the test; enrolled here, before
// the page's view event, so that event already carries the arm.
function enrollVisitorArm(key) {
  let bot = false;
  try { bot = !!getDeviceInfo().bot; } catch (_) { bot = true; }
  let storage = null;
  try { storage = localStorage; } catch (_) {}
  return enrollVisitor(storage, key, { deviceId: getDeviceId(), bot });
}

export function useSignupBoxArm(eligible = true) {
  return useMemo(() => {
    if (!eligible) return 'A';
    if (isBoxPreview()) return 'B';
    if (import.meta.env.DEV) {
      try {
        const forced = new URLSearchParams(window.location.search).get('sbox');
        if (forced === 'A' || forced === 'B') return forced;
      } catch (_) {}
    }
    try { return enrollVisitorArm('signup_box') || 'A'; } catch (_) { return 'A'; }
  }, [eligible]);
}
