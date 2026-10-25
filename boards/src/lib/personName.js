// A person's name made from their email, for someone who hasn't set one.
// No imports: the app's name cache (lib/userProfiles.js) and the API's comment
// lists (lib/apiComments.js) both name people this way, and the Worker can't
// carry the cache's Supabase client to get at it.

// Convert raw email into a display-friendly name. "andrew@gmail.com"
// → "Andrew" (titlecase the local part, strip dots/numbers). Fall back
// to the bare email if it doesn't look email-y.
export function emailToName(email) {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at <= 0) return email;
  const local = email.slice(0, at);
  // "andrew.conklin" / "andrew_conklin" / "andrewconklin1234" → "Andrew Conklin" / "Andrew"
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return email;
  return parts
    .map(p => p.replace(/\d+$/, ''))             // strip trailing digits
    .filter(Boolean)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ');
}
