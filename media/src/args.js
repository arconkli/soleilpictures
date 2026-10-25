// Pure argument builders and small helpers for the converter. No I/O here so
// node can test every flag. The DECISION (copy, encode or refuse) is not made
// here: it comes from boards/src/lib/playCopy.js, shared with the Worker.

import { copyDims, PLAY_COPY_MAX_EDGE } from '../../boards/src/lib/playCopy.js';
import { INPUT_GUARD } from './ffmpeg.js';

// HDR (PQ or HLG) to SDR BT.709. Without this an HDR clip encoded to 8-bit
// SDR comes out grey and flat. `hable` with no desaturation keeps highlights
// from clipping to white.
export const TONEMAP = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p';

function realVideo(probe) {
  // Cover art travels as a one-frame video stream; it is not the video.
  return (probe?.streams || []).find((s) => s?.codec_type === 'video' && !s.disposition?.attached_pic) || null;
}

// Rotation in degrees, from a side-data matrix or a stream tag depending on
// the container (as in scout/src/ffmpeg.js). 0 when there is none.
function rotationOf(stream) {
  const side = stream?.side_data_list?.find((s) => s?.rotation != null)?.rotation;
  const n = Number(side ?? stream?.tags?.rotate ?? stream?.rotation ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// Pixels that aren't square (DV, anamorphic broadcast): "40:33" as a number,
// or 1 when square or unknown.
function sarOf(stream) {
  const m = String(stream?.sample_aspect_ratio || '').match(/^(\d+):(\d+)$/);
  const r = m ? Number(m[1]) / Number(m[2]) : 1;
  return r > 0 && Number.isFinite(r) ? r : 1;
}

// The video's size as a viewer sees it. A portrait iPhone clip is stored
// landscape with a 90 degree rotation; ffmpeg rotates the pixels, so the copy
// must be sized from the upright shape. Non-square pixels are widened to
// square ones (the copy is square-pixel: setsar=1). null with no video.
export function displayDims(probe) {
  const v = realVideo(probe);
  const h = Number(v?.height);
  const w = Math.round(Number(v?.width) * sarOf(v));
  if (!(w > 0) || !(h > 0)) return null;
  const swap = Math.abs(rotationOf(v)) % 180 === 90;
  return swap ? { w: h, h: w } : { w, h };
}

// Interlaced footage (DV, MPEG-2 broadcast, some MXF) shows combing on every
// moving edge if encoded as it is.
function interlaced(probe) {
  return /^(tt|bb|tb|bt)$/.test(String(realVideo(probe)?.field_order || ''));
}

// The source is our own Worker over https: ride out a dropped connection on a
// long encode instead of failing an hour in. Nothing for a local file.
function inputOpts(input) {
  return /^https:\/\//.test(String(input))
    ? ['-reconnect', '1', '-reconnect_on_network_error', '1', '-reconnect_on_http_error', '5xx', '-reconnect_delay_max', '30']
    : [];
}

export function probeArgs(url) {
  return ['-v', 'error', ...INPUT_GUARD, ...inputOpts(url), '-print_format', 'json', '-show_format', '-show_streams', url];
}

const num = (v) => (v == null || v === '' ? undefined : (Number.isFinite(Number(v)) ? Number(v) : v));

// What we keep of an ffprobe result: codecs and shapes, which is all the
// decision and the admin need. NEVER tags (title, encoder, GPS, comments) or
// filenames (format.filename is the source URL, token and all): this object
// is stored, and it is a customer's file.
export function trimProbe(probe) {
  const f = probe?.format || {};
  const out = {
    format: {
      format_name: f.format_name,
      duration: num(f.duration),
      size: num(f.size),
      bit_rate: num(f.bit_rate),
    },
    streams: (probe?.streams || []).map((s) => ({
      index: s.index,
      codec_type: s.codec_type,
      codec_name: s.codec_name,
      profile: s.profile,
      pix_fmt: s.pix_fmt,
      width: s.width,
      height: s.height,
      bit_rate: num(s.bit_rate),
      color_transfer: s.color_transfer,
      field_order: s.field_order,
      sample_aspect_ratio: s.sample_aspect_ratio,
      sample_rate: num(s.sample_rate),
      channels: s.channels,
      disposition: { attached_pic: s.disposition?.attached_pic ? 1 : 0 },
      rotation: rotationOf(s),
    })),
  };
  return JSON.parse(JSON.stringify(out)); // drop undefined keys
}

// `plan` is a playPlan() 'convert' result. Returns the whole ffmpeg argv.
export function copyArgs({ plan, probe, kind, input, output, zscale = false }) {
  const args = ['-nostdin', '-v', 'error', ...INPUT_GUARD, ...inputOpts(input), '-i', input];
  const audioJob = kind === 'audio';

  if (audioJob || !plan.video) {
    // No picture in the copy. -vn also drops cover art.
    args.push('-vn');
  } else if (plan.video === 'copy') {
    // Already H.264 a browser plays: only the container (or the audio) was
    // the problem. No filters, and the rotation metadata stays with it.
    // 0:V (capital) is the first real video stream: never cover art.
    args.push('-map', '0:V:0', '-c:v', 'copy');
  } else {
    const filters = [];
    if (interlaced(probe)) filters.push('bwdif=mode=send_frame');
    if (plan.hdr && zscale) filters.push(TONEMAP);
    const dims = displayDims(probe);
    const to = dims && copyDims(dims.w, dims.h);
    // H.264 4:2:0 needs even sides; with no size to go on, round down.
    filters.push(to ? `scale=${to.w}:${to.h}:flags=lanczos` : 'scale=trunc(iw/2)*2:trunc(ih/2)*2', 'setsar=1');
    args.push('-map', '0:V:0', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21',
      '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-fps_mode', 'passthrough');
    if (filters.length) args.push('-vf', filters.join(','));
    // ffmpeg autorotates the pixels; this drops the matrix so a player does
    // not apply the rotation a second time.
    args.push('-metadata:s:v:0', 'rotate=0');
  }

  if (plan.audio === 'encode') {
    args.push('-map', '0:a:0?', '-c:a', 'aac', '-b:a', audioJob ? '256k' : '160k');
    if (!audioJob) args.push('-ac', '2');
  } else if (plan.audio === 'copy') {
    args.push('-map', '0:a:0?', '-c:a', 'copy');
  } else {
    args.push('-an');
  }

  // The copy is for playing: no tags (a phone's location rides in them), no
  // chapters, and no timecode track, which the MP4 muxer would otherwise write
  // from a camera file's timecode tag. The original keeps all of it.
  args.push('-map_metadata', '-1', '-map_chapters', '-1', '-write_tmcd', '0');
  args.push('-movflags', '+faststart', '-max_muxing_queue_size', '1024', '-y', output);
  return args;
}

// A frame to stand for the video on its card. `at` seconds in (-ss before -i
// seeks by keyframe without decoding up to it). Cut from the original so an
// HDR clip tone-maps the same way as the copy; autorotate makes it upright.
export function posterArgs({ input, output, at = 0, hdr = false, zscale = false }) {
  const filters = [];
  if (hdr && zscale) filters.push(TONEMAP);
  filters.push("scale='min(1024,iw)':-2");
  return ['-nostdin', '-v', 'error', ...INPUT_GUARD, ...inputOpts(input),
    '-ss', String(at), '-i', input,
    '-frames:v', '1', '-vf', filters.join(','),
    '-c:v', 'libwebp', '-quality', '80', '-y', output];
}

// The poster's size, from the scale above (ffprobe cannot read it back: webp
// is deliberately outside INPUT_GUARD's formats). `-2` rounds to even.
export function posterDims(dims) {
  if (!dims) return null;
  const w = Math.min(1024, dims.w);
  return { w, h: Math.max(2, Math.round((dims.h * w) / dims.w / 2) * 2) };
}

// An error message that is safe to store and show: no URLs (the source URL
// carries a job token), no query strings, at most 300 characters.
export function scrubError(msg) {
  return String(msg ?? 'failed')
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[url]')
    .replace(/\/api\/media\/\S+/gi, '[url]')
    .replace(/[?&][a-z_]+=[A-Za-z0-9._~%+\-=]{8,}/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300) || 'failed';
}

export { PLAY_COPY_MAX_EDGE };
