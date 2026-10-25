// A video or audio file every browser can play.
//
// Browsers decode a handful of formats and each a different handful: Chrome
// shows ProRes as sound with no picture and won't open AVI, WMV, FLV or MPEG;
// Safari won't open MKV or AV1; Firefox misses HEVC, which is what an iPhone
// records. A card holding one of those was a player that said it couldn't
// play. Now the converter (media/, on Fly) makes a COPY in H.264/AAC MP4 (or
// AAC for audio) next to the original, and the player uses the copy. Download
// still gives the original, byte for byte.
//
// The copy is named after its original, so anything that holds the original's
// key can find it without asking anyone:
//
//   <ws>/<name>.<ext>  →  <ws>/previews/<name>.play.mp4    a video's copy
//                         <ws>/previews/<name>.play.m4a    an audio file's copy
//                         <ws>/previews/<name>.poster.webp a video's frame
//
// Each copy has its own images row (same workspace, cluster and uploader as the
// original, retention-locked, no size). That row is what lets /sign-reads and
// the share bundles sign it. Under previews/ it is a derivative like an image's
// previews: storage usage (_image_counts) never counts it, and the party's
// preview presign can't overwrite it (that takes `<uuid>.webp` only). Copies
// go when their original does (the R2 sweep's forgetPlayCopies in
// worker-playCopy.js), and with a deleted workspace.
//
// Pure, no imports: the Worker, the converter box and the app share it, and
// node tests it.

// Ceilings on what the converter takes on. Over them the original still
// plays where it can and downloads everywhere; the card says why there is no
// copy. The docs quote these through {{fact:}}.
export const PLAY_COPY_MAX_SECONDS = 4 * 60 * 60;
export const PLAY_COPY_MAX_BYTES = 20 * 1024 * 1024 * 1024;
// The copy's long edge. 1080p is what review tools stream: it plays smoothly
// on an ordinary connection, and the original is one click away.
export const PLAY_COPY_MAX_EDGE = 1920;
// An H.264 file browsers can decode but can't stream: over this bitrate, or
// bigger than 4K, it buffers more than it plays, so it gets a copy too.
export const PLAY_COPY_HEAVY_BPS = 40_000_000;
const MAX_PLAYABLE_EDGE = 3840;
const MAX_PLAYABLE_SHORT_EDGE = 2160;

const EXT_RE = /\.([A-Za-z0-9]{1,8})$/;
const COPY_RE = /\/previews\/[^/]+\.(play\.(mp4|m4a)|poster\.webp)$/i;
// The video extensions fileIngest routes to a video card, plus the camera and
// broadcast containers that arrive typed (video/mp2t, application/mxf).
const VIDEO_EXTS = new Set(['mov', 'qt', 'mp4', 'm4v', 'webm', 'mkv', 'avi', 'wmv', 'flv', 'mpg', 'mpeg',
  'm2ts', 'mts', 'ts', '3gp', '3g2', 'ogv', 'mxf', 'vob', 'f4v', 'asf', 'dv']);
const AUDIO_EXTS = new Set(['wav', 'aif', 'aiff', 'aifc', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'mp3',
  'caf', 'wma', 'amr', 'ac3', 'eac3', 'alac', 'ape', 'wv', 'mka', 'm4b', 'mp2', 'au', 'snd']);

export function extOfKey(key) {
  const m = typeof key === 'string' ? key.match(EXT_RE) : null;
  return m ? m[1].toLowerCase() : '';
}

// True for a key the converter wrote. Never an original: nothing converts a
// copy, and the sweep never treats one as its own file.
export function isCopyKey(key) {
  return typeof key === 'string' && COPY_RE.test(key);
}

// 'video' | 'audio' | null, from the key's extension.
export function mediaKindOfKey(key) {
  if (typeof key !== 'string' || !key || isCopyKey(key)) return null;
  const ext = extOfKey(key);
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  return null;
}

// The keys of an original's copies: beside it, in a previews/ folder. A name
// with no extension gets the suffix appended rather than losing anything.
export function copyKeys(key) {
  const s = String(key || '');
  const cut = s.lastIndexOf('/');
  const dir = cut >= 0 ? s.slice(0, cut + 1) : '';
  const base = `${dir}previews/${s.slice(cut + 1).replace(EXT_RE, '')}`;
  return { video: `${base}.play.mp4`, audio: `${base}.play.m4a`, poster: `${base}.poster.webp` };
}

// The copy a card of this kind plays.
export function copyKeyFor(key, kind) {
  const k = copyKeys(key);
  return kind === 'audio' ? k.audio : k.video;
}

// The copy to play for a card's `src`, from its `playSrc`: only when that is
// this src's own copy (a version switch or a move leaves a stale one behind,
// which would play another file). The kind is the key's, as the converter's.
export function knownCopy(src, playSrc) {
  const key = typeof src === 'string' && src.startsWith('r2:') ? src.slice(3) : '';
  const kind = mediaKindOfKey(key);
  if (!kind || typeof playSrc !== 'string') return null;
  return playSrc === `r2:${copyKeyFor(key, kind)}` ? playSrc : null;
}

// ── Before the converter sees it ──────────────────────────────────────────
//
// Whether an upload is worth sending to the converter. True unless the file is
// one we KNOW every browser plays: the converter decides for real (ffprobe),
// so this only spares it the files that are obviously fine — the H.264 MP4 a
// phone set to "Most Compatible" records, an MP3, a WAV. `media` is the card's
// facts from mediaProbe (codec fourcc, profile, audio fourcc, bitrate).
const UNIVERSAL_VIDEO_EXTS = new Set(['mp4', 'm4v', 'mov']);
const UNIVERSAL_AUDIO_EXTS = new Set(['mp3', 'wav', 'flac', 'aac']);
export function copyHint({ kind, ext, media = null } = {}) {
  const e = String(ext || '').toLowerCase();
  if (kind === 'audio') return !UNIVERSAL_AUDIO_EXTS.has(e);
  if (kind !== 'video') return false;
  if (!UNIVERSAL_VIDEO_EXTS.has(e) || !media) return true;
  if (media.codec !== 'avc1' && media.codec !== 'avc3') return true;
  if (/10|4:2:2|4:4:4/.test(media.prof || '')) return true;
  if (media.audio && media.audio.codec !== 'mp4a' && media.audio.codec !== '.mp3') return true;
  if (media.bitrate > PLAY_COPY_HEAVY_BPS) return true;
  const long = Math.max(media.w || 0, media.h || 0);
  const short = Math.min(media.w || 0, media.h || 0);
  return long > MAX_PLAYABLE_EDGE || short > MAX_PLAYABLE_SHORT_EDGE;
}

// ── The converter's decision, from ffprobe ────────────────────────────────
//
// `probe` is `ffprobe -show_format -show_streams` JSON; `ext` the original's
// extension (ffprobe names every ISO-BMFF file "mov,mp4,m4a,3gp,3g2,mj2", so
// the name is what tells an .mp4 from a .3gp). Returns:
//   { action: 'none' }                       every browser plays it as it is
//   { action: 'convert', video, audio, hdr } make the copy; video/audio are
//                                            'copy' (as is) | 'encode' | null
//   { action: 'refuse', reason }             over a ceiling, or nothing to play
const PLAYABLE_PIX = new Set(['yuv420p', 'yuvj420p']);
const PLAYABLE_AUDIO_IN_MP4 = new Set(['aac', 'mp3']);
const PLAYABLE_AUDIO_FILE = new Set(['mp3', 'aac', 'flac']);
const PLAYABLE_PCM_RE = /^pcm_(s16le|s24le|s32le|f32le|u8)$/;
const HDR_TRANSFERS = new Set(['smpte2084', 'arib-std-b67']);

function streamsOf(probe, type) {
  // Cover art travels as a one-frame video stream (attached_pic); it is not
  // the video, and an MP3 with a cover is still just audio.
  return (probe?.streams || []).filter((s) => s?.codec_type === type && !(s.disposition?.attached_pic));
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function probeDuration(probe) {
  const v = streamsOf(probe, 'video')[0];
  const a = streamsOf(probe, 'audio')[0];
  return num(probe?.format?.duration) ?? num(v?.duration) ?? num(a?.duration);
}

function videoPlaysEverywhere(v, probe) {
  if (v.codec_name !== 'h264') return false;
  if (!PLAYABLE_PIX.has(v.pix_fmt)) return false;
  if (/10|4:2:2|4:4:4/.test(v.profile || '')) return false;
  const w = num(v.width) || 0;
  const h = num(v.height) || 0;
  if (Math.max(w, h) > MAX_PLAYABLE_EDGE || Math.min(w, h) > MAX_PLAYABLE_SHORT_EDGE) return false;
  const bps = num(v.bit_rate) ?? num(probe?.format?.bit_rate);
  return !(bps > PLAY_COPY_HEAVY_BPS);
}

export function playPlan(probe, { ext = '', kind = null } = {}) {
  const dur = probeDuration(probe);
  const size = num(probe?.format?.size);
  if (dur != null && dur > PLAY_COPY_MAX_SECONDS) return { action: 'refuse', reason: 'too_long' };
  if (size != null && size > PLAY_COPY_MAX_BYTES) return { action: 'refuse', reason: 'too_large' };
  const v = streamsOf(probe, 'video')[0] || null;
  const a = streamsOf(probe, 'audio')[0] || null;
  if (!v && !a) return { action: 'refuse', reason: 'no_streams' };
  const e = String(ext || '').toLowerCase();
  const format = String(probe?.format?.format_name || '');

  // An audio file (or a video card whose file turned out to hold only sound).
  if (!v) {
    const plays = PLAYABLE_AUDIO_FILE.has(a.codec_name)
      || (format === 'wav' && PLAYABLE_PCM_RE.test(a.codec_name || ''));
    if (plays && kind !== 'video') return { action: 'none' };
    return { action: 'convert', video: null, audio: PLAYABLE_AUDIO_IN_MP4.has(a.codec_name) ? 'copy' : 'encode', hdr: false };
  }

  const video = videoPlaysEverywhere(v, probe) ? 'copy' : 'encode';
  const audio = a ? (PLAYABLE_AUDIO_IN_MP4.has(a.codec_name) ? 'copy' : 'encode') : null;
  const container = format.startsWith('mov,mp4') && UNIVERSAL_VIDEO_EXTS.has(e);
  if (video === 'copy' && audio !== 'encode' && container) return { action: 'none' };
  return { action: 'convert', video, audio, hdr: video === 'encode' && HDR_TRANSFERS.has(v.color_transfer) };
}

// The copy's size for a video of w×h shown upright: the long edge at most
// PLAY_COPY_MAX_EDGE, both sides even (H.264 4:2:0 needs it), never enlarged.
export function copyDims(w, h) {
  if (!(w > 0) || !(h > 0)) return null;
  const k = Math.min(1, PLAY_COPY_MAX_EDGE / Math.max(w, h));
  const even = (n) => Math.max(2, Math.round((n * k) / 2) * 2);
  return { w: even(w), h: even(h) };
}
