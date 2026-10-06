// A link someone typed, made safe for an <a href>.
//
// React writes a javascript: URL into href untouched (it only warns), so a
// typed link was one click away from running script in the viewer's session on
// our origin. Every site that rendered one used target="_blank", which happens
// to neutralise javascript: in today's browsers; this no longer relies on that
// (2026-10-06 security audit).
//
// The rule is the one the link card's own open handler already used: http(s)
// passes, and anything else is treated as a bare host and gets https:// in
// front — so "javascript:alert(1)" becomes a harmless broken https link rather
// than a script, whatever spacing or casing tricks it uses. mailto: is kept.
export function safeExternalHref(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^mailto:\S/i.test(s)) return s;
  return `https://${s}`;
}
