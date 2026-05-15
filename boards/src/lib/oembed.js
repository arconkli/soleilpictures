// Embed detection for popular media URLs.
//
// Given a raw URL, `detectEmbed` returns either null (no embed) or
// { provider, id, type?, embedUrl, defaultW, defaultH, aspect }.
// The `embedUrl` is the iframe `src`. Sizing defaults are tuned per
// provider; the user can resize freely afterwards.

const VIDEO_ASPECT = 9 / 16; // height/width

function safeUrl(input) {
  try {
    if (!input) return null;
    const u = input.startsWith('http') ? input : `https://${input}`;
    return new URL(u);
  } catch (_) { return null; }
}

function youtube(u) {
  const host = u.hostname.replace(/^www\./, '');
  let id = null;
  if (host === 'youtu.be') {
    id = u.pathname.split('/').filter(Boolean)[0] || null;
  } else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else if (u.pathname.startsWith('/shorts/')) id = u.pathname.split('/')[2] || null;
    else if (u.pathname.startsWith('/embed/')) id = u.pathname.split('/')[2] || null;
    else if (u.pathname.startsWith('/live/')) id = u.pathname.split('/')[2] || null;
  }
  if (!id) return null;
  // Strip query stuff like ? from URLs but keep ID clean.
  id = id.split('?')[0].split('&')[0];
  const start = parseInt(u.searchParams.get('t') || u.searchParams.get('start') || '', 10);
  const startParam = Number.isFinite(start) && start > 0 ? `?start=${start}` : '';
  return {
    provider: 'youtube',
    id,
    embedUrl: `https://www.youtube.com/embed/${id}${startParam}`,
    defaultW: 560,
    defaultH: Math.round(560 * VIDEO_ASPECT),
    aspect: VIDEO_ASPECT,
    allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
  };
}

function spotify(u) {
  const host = u.hostname.replace(/^www\./, '');
  if (host !== 'open.spotify.com' && host !== 'spotify.com') return null;
  // /track/<id>, /album/<id>, /playlist/<id>, /show/<id>, /episode/<id>, /artist/<id>
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const [type, id] = parts;
  const valid = ['track', 'album', 'playlist', 'show', 'episode', 'artist'];
  if (!valid.includes(type)) return null;
  const h = (type === 'track' || type === 'episode') ? 152 : 380;
  return {
    provider: 'spotify',
    id,
    type,
    embedUrl: `https://open.spotify.com/embed/${type}/${id}`,
    defaultW: 320,
    defaultH: h,
    aspect: h / 320,
    allow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture',
  };
}

function vimeo(u) {
  const host = u.hostname.replace(/^www\./, '');
  if (host !== 'vimeo.com' && host !== 'player.vimeo.com') return null;
  const parts = u.pathname.split('/').filter(Boolean);
  // vimeo.com/<id> or vimeo.com/showcase/<...>/video/<id> or player.vimeo.com/video/<id>
  let id = null;
  if (host === 'player.vimeo.com' && parts[0] === 'video') id = parts[1] || null;
  else if (/^\d+$/.test(parts[0] || '')) id = parts[0];
  else {
    const videoIdx = parts.indexOf('video');
    if (videoIdx >= 0 && /^\d+$/.test(parts[videoIdx + 1] || '')) id = parts[videoIdx + 1];
  }
  if (!id) return null;
  return {
    provider: 'vimeo',
    id,
    embedUrl: `https://player.vimeo.com/video/${id}`,
    defaultW: 560,
    defaultH: Math.round(560 * VIDEO_ASPECT),
    aspect: VIDEO_ASPECT,
    allow: 'autoplay; fullscreen; picture-in-picture; clipboard-write',
  };
}

function tiktok(u) {
  const host = u.hostname.replace(/^www\./, '');
  if (host !== 'tiktok.com' && host !== 'vm.tiktok.com' && host !== 'm.tiktok.com') return null;
  // tiktok.com/@user/video/<id>  — id is digits.
  const parts = u.pathname.split('/').filter(Boolean);
  const videoIdx = parts.indexOf('video');
  let id = null;
  if (videoIdx >= 0 && parts[videoIdx + 1]) id = parts[videoIdx + 1].split('?')[0];
  if (!id || !/^\d+$/.test(id)) {
    // Short URLs (vm.tiktok.com/<code>) can't be resolved client-side
    // without a fetch. Surface as link for now.
    return null;
  }
  return {
    provider: 'tiktok',
    id,
    embedUrl: `https://www.tiktok.com/embed/v2/${id}`,
    defaultW: 360,
    defaultH: 640,
    aspect: 640 / 360,
    allow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture',
  };
}

function instagram(u) {
  const host = u.hostname.replace(/^www\./, '');
  if (host !== 'instagram.com' && host !== 'm.instagram.com') return null;
  const parts = u.pathname.split('/').filter(Boolean);
  // /p/<code>, /reel/<code>, /tv/<code>
  const kindMap = { p: 'p', reel: 'reel', tv: 'tv', reels: 'reel' };
  const k = kindMap[parts[0]];
  if (!k || !parts[1]) return null;
  const id = parts[1].split('?')[0];
  return {
    provider: 'instagram',
    id,
    type: k,
    embedUrl: `https://www.instagram.com/${k}/${id}/embed`,
    defaultW: 400,
    defaultH: 600,
    aspect: 600 / 400,
    allow: 'autoplay; clipboard-write; encrypted-media; picture-in-picture',
  };
}

function twitter(u) {
  const host = u.hostname.replace(/^www\./, '');
  if (host !== 'twitter.com' && host !== 'x.com' && host !== 'mobile.twitter.com') return null;
  const parts = u.pathname.split('/').filter(Boolean);
  const statusIdx = parts.indexOf('status');
  if (statusIdx < 0) return null;
  const id = (parts[statusIdx + 1] || '').split('?')[0];
  if (!id || !/^\d+$/.test(id)) return null;
  // Twitter's first-party embed is via the platform iframe; works without auth.
  return {
    provider: 'twitter',
    id,
    embedUrl: `https://platform.twitter.com/embed/Tweet.html?id=${id}`,
    defaultW: 480,
    defaultH: 520,
    aspect: 520 / 480,
    allow: 'autoplay; clipboard-write; encrypted-media',
  };
}

const DETECTORS = [youtube, spotify, vimeo, tiktok, instagram, twitter];

export function detectEmbed(url) {
  const u = safeUrl(url);
  if (!u) return null;
  for (const det of DETECTORS) {
    try {
      const hit = det(u);
      if (hit) return hit;
    } catch (_) { /* continue */ }
  }
  return null;
}

// Convenience: text → first URL → embed.
export function detectEmbedFromText(text) {
  if (!text) return null;
  const m = String(text).match(/https?:\/\/[^\s)\]>]+/i);
  if (!m) return null;
  return detectEmbed(m[0]);
}
