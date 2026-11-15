// Read the name, colour and picture of the given user ids — yours and anyone
// you share a workspace with. member_profiles (migration 0382) holds only
// those columns; the rest of someone's profile is theirs. Returns a Map<uid,row>.
//
// A module of its own, importing nothing but the client, because a face
// (PersonFace → userProfiles) needs it on pages that never load the canvas:
// the public file share and the doc share view. From boardsApi.js it would
// pull that whole module (yjs, the card index, the cap rules) into a chunk
// those pages share with the app. boardsApi.js re-exports it for everyone else.
import { supabase } from './supabase.js';

export async function getProfilesByIds(userIds) {
  if (!userIds || userIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('member_profiles')
    .select('user_id, display_name, color, avatar_url')
    .in('user_id', userIds);
  if (error) throw error;
  const m = new Map();
  (data || []).forEach(p => m.set(p.user_id, p));
  return m;
}
