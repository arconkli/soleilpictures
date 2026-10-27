// teamsApi.js — one wrapper per client-callable Team RPC (0530, 0532-0535, 0538, 0540).
// Each throws the PostgrestError, which keeps `hint` and `details`: pass it to
// teamRefusal() (teamHints.js). Callers: teamActions.js and hooks/useTeam.js
// (the Team page, S4). The HTTP calls (team-billing, the domain check) are in
// teamBillingApi.js.
// Never .catch() a supabase.rpc() builder: it is a thenable, not a promise.
import { supabase } from './supabase.js';

export async function myWorkspaceRole({ p_workspace_id } = {}) {
  const { data, error } = await supabase.rpc('my_workspace_role', { p_workspace_id });
  if (error) throw error;
  return data;
}

export async function createTeam({ p_name, p_color, p_workspace_ids, p_seats } = {}) {
  const { data, error } = await supabase.rpc('create_team', { p_name, p_color, p_workspace_ids, p_seats });
  if (error) throw error;
  return data;
}

export async function renameTeam({ p_org_id, p_name, p_color } = {}) {
  const { data, error } = await supabase.rpc('rename_team', { p_org_id, p_name, p_color });
  if (error) throw error;
  return data;
}

export async function createTeamWorkspace({ p_org_id, p_name, p_root_name, p_private } = {}) {
  const { data, error } = await supabase.rpc('create_team_workspace', { p_org_id, p_name, p_root_name, p_private });
  if (error) throw error;
  return data;
}

export async function previewMoveIntoTeam({ p_workspace_id, p_org_id } = {}) {
  const { data, error } = await supabase.rpc('preview_move_into_team', { p_workspace_id, p_org_id });
  if (error) throw error;
  return data;
}

export async function moveWorkspaceIntoTeam({ p_workspace_id, p_org_id, p_add_seats } = {}) {
  const { data, error } = await supabase.rpc('move_workspace_into_team', { p_workspace_id, p_org_id, p_add_seats });
  if (error) throw error;
  return data;
}

export async function moveWorkspaceOutOfTeam({ p_workspace_id, p_to_user } = {}) {
  const { data, error } = await supabase.rpc('move_workspace_out_of_team', { p_workspace_id, p_to_user });
  if (error) throw error;
  return data;
}

export async function setTeamWorkspacePrivate({ p_workspace_id, p_private } = {}) {
  const { data, error } = await supabase.rpc('set_team_workspace_private', { p_workspace_id, p_private });
  if (error) throw error;
  return data;
}

export async function closeTeam({ p_org_id } = {}) {
  const { data, error } = await supabase.rpc('close_team', { p_org_id });
  if (error) throw error;
  return data;
}

export async function inviteToTeam({ p_org_id, p_emails, p_role, p_add_seats } = {}) {
  const { data, error } = await supabase.rpc('invite_to_team', { p_org_id, p_emails, p_role, p_add_seats });
  if (error) throw error;
  return data;
}

export async function revokeTeamInvite({ p_invite_id } = {}) {
  const { data, error } = await supabase.rpc('revoke_team_invite', { p_invite_id });
  if (error) throw error;
  return data;
}

// 0541: 'sent' | 'too_soon' (once a day) | 'closed' (claimed, revoked or expired).
export async function resendTeamInvite({ p_invite_id } = {}) {
  const { data, error } = await supabase.rpc('resend_team_invite', { p_invite_id });
  if (error) throw error;
  return data;
}

export async function acceptTeamInvite({ p_token } = {}) {
  const { data, error } = await supabase.rpc('accept_team_invite', { p_token });
  if (error) throw error;
  return data;
}

export async function claimMyTeamInvites() {
  const { data, error } = await supabase.rpc('claim_my_team_invites', {});
  if (error) throw error;
  return data;
}

export async function setTeamRole({ p_org_id, p_user_id, p_role, p_add_seats } = {}) {
  const { data, error } = await supabase.rpc('set_team_role', { p_org_id, p_user_id, p_role, p_add_seats });
  if (error) throw error;
  return data;
}

export async function removeFromTeam({ p_org_id, p_user_id } = {}) {
  const { data, error } = await supabase.rpc('remove_from_team', { p_org_id, p_user_id });
  if (error) throw error;
  return data;
}

export async function leaveTeam({ p_org_id } = {}) {
  const { data, error } = await supabase.rpc('leave_team', { p_org_id });
  if (error) throw error;
  return data;
}

export async function addTeamSeats({ p_org_id, p_n } = {}) {
  const { data, error } = await supabase.rpc('add_team_seats', { p_org_id, p_n });
  if (error) throw error;
  return data;
}

export async function removeTeamSeat({ p_org_id } = {}) {
  const { data, error } = await supabase.rpc('remove_team_seat', { p_org_id });
  if (error) throw error;
  return data;
}

export async function setTeamWhenFull({ p_org_id, p_mode, p_monthly_limit } = {}) {
  const { data, error } = await supabase.rpc('set_team_when_full', { p_org_id, p_mode, p_monthly_limit });
  if (error) throw error;
  return data;
}

export async function setTeamSeatPerk({ p_org_id, p_on } = {}) {
  const { data, error } = await supabase.rpc('set_team_seat_perk', { p_org_id, p_on });
  if (error) throw error;
  return data;
}

export async function setTeamLink({ p_org_id, p_on, p_role } = {}) {
  const { data, error } = await supabase.rpc('set_team_link', { p_org_id, p_on, p_role });
  if (error) throw error;
  return data;
}

export async function resetTeamLink({ p_org_id } = {}) {
  const { data, error } = await supabase.rpc('reset_team_link', { p_org_id });
  if (error) throw error;
  return data;
}

export async function peekTeamLink({ p_token } = {}) {
  const { data, error } = await supabase.rpc('peek_team_link', { p_token });
  if (error) throw error;
  return data;
}

export async function claimTeamLink({ p_token } = {}) {
  const { data, error } = await supabase.rpc('claim_team_link', { p_token });
  if (error) throw error;
  return data;
}

export async function addTeamDomain({ p_org_id, p_domain } = {}) {
  const { data, error } = await supabase.rpc('add_team_domain', { p_org_id, p_domain });
  if (error) throw error;
  return data;
}

export async function setTeamDomainOn({ p_org_id, p_domain, p_on } = {}) {
  const { data, error } = await supabase.rpc('set_team_domain_on', { p_org_id, p_domain, p_on });
  if (error) throw error;
  return data;
}

export async function removeTeamDomain({ p_org_id, p_domain } = {}) {
  const { data, error } = await supabase.rpc('remove_team_domain', { p_org_id, p_domain });
  if (error) throw error;
  return data;
}

export async function myTeamOffers() {
  const { data, error } = await supabase.rpc('my_team_offers', {});
  if (error) throw error;
  return data;
}

export async function answerTeamOffer({ p_org_id, p_join } = {}) {
  const { data, error } = await supabase.rpc('answer_team_offer', { p_org_id, p_join });
  if (error) throw error;
  return data;
}

export async function askTeamForEdit({ p_workspace_id, p_board_id } = {}) {
  const { data, error } = await supabase.rpc('ask_team_for_edit', { p_workspace_id, p_board_id });
  if (error) throw error;
  return data;
}

export async function approveTeamRequest({ p_request_id, p_add_seat } = {}) {
  const { data, error } = await supabase.rpc('approve_team_request', { p_request_id, p_add_seat });
  if (error) throw error;
  return data;
}

export async function keepTeamRequestViewer({ p_request_id } = {}) {
  const { data, error } = await supabase.rpc('keep_team_request_viewer', { p_request_id });
  if (error) throw error;
  return data;
}

export async function getTeam({ p_org_id } = {}) {
  const { data, error } = await supabase.rpc('get_team', { p_org_id });
  if (error) throw error;
  return data;
}

export async function listMyTeams() {
  const { data, error } = await supabase.rpc('list_my_teams', {});
  if (error) throw error;
  return data;
}

export async function listMyTeamWorkspaces() {
  const { data, error } = await supabase.rpc('list_my_team_workspaces', {});
  if (error) throw error;
  return data;
}

export async function getTeamBilling({ p_org_id } = {}) {
  const { data, error } = await supabase.rpc('get_team_billing', { p_org_id });
  if (error) throw error;
  return data;
}

export async function previewTeamSeats({ p_workspace_ids } = {}) {
  const { data, error } = await supabase.rpc('preview_team_seats', { p_workspace_ids });
  if (error) throw error;
  return data;
}
