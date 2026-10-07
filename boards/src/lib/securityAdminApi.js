// The admin RPCs behind Settings → Security (migrations 0369/0370).
//
// Every one is gated server-side by _require_admin(); the tab only showing up
// for an admin is cosmetic. Awaited and destructured, never given a catch
// handler: a supabase.rpc() builder is a thenable, and a catch on it swallows
// the query.
import { supabase } from './supabase.js';

async function call(fn, args) {
  if (!supabase) throw new Error('Not connected.');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data;
}

export const securityOverview = () => call('admin_security_overview');
export const releaseBreaker = () => call('admin_outbound_release_breaker');
export const sendHeldMail = (actor) => call('admin_outbound_release_held', { p_actor: actor });
export const dropHeldMail = (actor) => call('admin_outbound_drop_held', { p_actor: actor });
export const liftSendingHold = (userId) => call('admin_release_sending', { p_user: userId });
export const ackAlert = (id) => call('admin_ops_alert_ack', { p_id: id });
export const sendTestAlert = () => call('admin_ops_alert_test');
