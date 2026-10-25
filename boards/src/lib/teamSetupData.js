// teamSetupData — the pure pieces of the real /team/new walk (TeamSetup.jsx):
// which of the person's workspaces may move in, and the two small rules the
// seats step leans on. No React, so node tests it.
import { TEAM_SEAT_MIN } from './teamModel.js';

const SEAT_MAX = 100;

// The person's own personal workspaces (created by them, in no team): the
// same rule the server applies. `client` is a supabase client, passed in so
// a test can hand over a fake chain. Any error reads as none.
export async function loadOwnPersonalWorkspaces(client, userId) {
  if (!client || !userId) return [];
  try {
    const { data, error } = await client
      .from('workspaces')
      .select('id, name, created_at')
      .eq('created_by', userId)
      .is('org_id', null)
      .order('created_at', { ascending: true });
    if (error || !Array.isArray(data)) return [];
    return data.map((w) => ({ id: w.id, name: w.name }));
  } catch (_) { return []; }
}

// The seats a stepper may start from: the server's answer, within 3..100.
export function seatFloor(needed) {
  return Math.min(SEAT_MAX, Math.max(TEAM_SEAT_MIN, Number(needed) || TEAM_SEAT_MIN));
}

// The Stripe plan for the setup's billing choice ('year' | 'month').
export function checkoutPlan(billing) {
  return billing === 'year' ? 'annual' : 'monthly';
}
