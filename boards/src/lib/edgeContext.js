// edgeContext.js — the region and network kind the Worker saw, handed to the
// page as one meta tag, and read back by the app.
//
//   <meta name="soleil-ctx" content="r=US-CA;n=isp">
//
// The Worker already rewrites every HTML response it serves (the CSP nonce in
// worker.js withSecurityHeaders), and page requests are never answered 304, so
// the tag is fresh on every load and costs no request of its own. The app reads
// it into the once-a-session session_context row (sessionContext.js).
//
// What it may carry, and nothing else:
//   r  the ISO 3166-2 region, country first: "US-CA", "GB-ENG". Only when the
//      edge knows both halves. Never a city, never coordinates.
//   n  a kind from netKind.js. Never the network's name.
//
// Both halves of the format live here so the writer and the reader cannot drift.
// The Worker appends the tag with html:true, which does not escape, so every
// value is checked against a pattern that admits no quote, angle bracket or
// ampersand, on the way out and again on the way in.

import { netKind, NET_KINDS } from './netKind.js';

export const CTX_META_NAME = 'soleil-ctx';

const COUNTRY_RE = /^[A-Z]{2}$/;
const SUBDIVISION_RE = /^[A-Z0-9]{1,3}$/;
const REGION_RE = /^[A-Z]{2}-[A-Z0-9]{1,3}$/;
const KINDS = new Set(NET_KINDS);

/** request.cf → "r=US-CA;n=isp", or '' when the edge said nothing usable. */
export function edgeContext(cf) {
  if (!cf || typeof cf !== 'object') return '';
  const parts = [];
  const country = typeof cf.country === 'string' ? cf.country.toUpperCase() : '';
  const sub = typeof cf.regionCode === 'string' ? cf.regionCode.toUpperCase() : '';
  if (COUNTRY_RE.test(country) && SUBDIVISION_RE.test(sub)) parts.push(`r=${country}-${sub}`);
  const kind = netKind(cf.asn, cf.asOrganization);
  if (kind) parts.push(`n=${kind}`);
  return parts.join(';');
}

/** The tag itself, or '' when there is nothing to say. */
export function edgeContextMeta(cf) {
  const v = edgeContext(cf);
  return v ? `<meta name="${CTX_META_NAME}" content="${v}">` : '';
}

/** "r=US-CA;n=isp" → { region: 'US-CA', net_kind: 'isp' }; unknown parts are null. */
export function parseEdgeContext(content) {
  const out = { region: null, net_kind: null };
  if (typeof content !== 'string' || content.length > 64) return out;
  for (const part of content.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i);
    const v = part.slice(i + 1);
    if (k === 'r' && REGION_RE.test(v)) out.region = v;
    else if (k === 'n' && KINDS.has(v)) out.net_kind = v;
  }
  return out;
}
