// teamBillingApi — the Team page's money and domain calls: the team-billing
// edge function (S3) and the Worker's domain check. Every amount comes from
// the function's own answer, never one computed here. None of these throws:
// each resolves { ok:false, error } on failure ('auth required', 'network',
// 'http_<status>' or the server's own code, with its other fields kept).
// teamsApi.js stays purely RPC; the HTTP calls live here.

import { supabase } from './supabase.js';
import { makeTeamCalls } from './teamCalls.js';

// Run where the database is, as storageAddon.js does.
const BILLING_URL = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/team-billing?forceFunctionRegion=us-west-2';

const calls = makeTeamCalls({
  getToken: async () => (await supabase.auth.getSession()).data?.session?.access_token,
  fetchImpl: (...a) => fetch(...a),
  billingUrl: BILLING_URL,
  domainCheckUrl: '/api/team/domain-check',
  getOrigin: () => globalThis.location?.origin,
});

// Stripe Checkout for a new team (orgId null) or a lapsed one.
export function startTeamCheckout({ name, color, workspaceIds, seats, plan, endCreator, orgId } = {}) {
  return calls.teamBilling('checkout', {
    name, color, workspace_ids: workspaceIds, seats, plan, end_creator: endCreator, org_id: orgId,
  });
}

// The success page finishing the checkout, if the webhook hasn't.
export function verifyTeamCheckout(sessionId) {
  return calls.teamBilling('verify', { session_id: sessionId });
}

// The team's Stripe Customer Portal (the owner only).
export function openTeamPortal(orgId) {
  return calls.teamBilling('portal', { org_id: orgId });
}

// What buying up to `seats` (the TOTAL wanted) costs today.
export function previewTeamSeatsCost(orgId, seats) {
  return calls.teamBilling('seats_preview', { org_id: orgId, seats });
}

// Buy up to `seats` at the preview's price: its request id and proration date.
export function addTeamSeats(orgId, seats, { requestId, prorationDate } = {}) {
  return calls.teamBilling('seats_add', {
    org_id: orgId, seats, request_id: requestId, proration_date: prorationDate,
  });
}

// Put the team's seats on Stripe now.
export function syncTeam(orgId) {
  return calls.teamBilling('sync', { org_id: orgId });
}

// One id per confirmed preview: retrying that preview reuses it.
export function newSeatRequestId() {
  return crypto.randomUUID();
}

// The Worker's DNS check of a domain's TXT record → { ok, verified }.
export function checkTeamDomain(orgId, domain) {
  return calls.domainCheck(orgId, domain);
}
