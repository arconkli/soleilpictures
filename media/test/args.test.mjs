import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playPlan } from '../../boards/src/lib/playCopy.js';
import { INPUT_GUARD } from '../src/ffmpeg.js';
import { copyArgs, posterArgs, probeArgs, displayDims, trimProbe, scrubError, TONEMAP } from '../src/args.js';

const vstream = (o = {}) => ({ index: 0, codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', width: 1920, height: 1080, ...o });
const astream = (o = {}) => ({ index: 1, codec_type: 'audio', codec_name: 'aac', ...o });
const probeOf = (streams, format = {}) => ({ streams, format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '10', ...format } });
const arg = (args, flag) => args[args.indexOf(flag) + 1];
const convert = (probe, ext, kind = 'video') => {
  const plan = playPlan(probe, { ext, kind });
  assert.equal(plan.action, 'convert');
  return plan;
};
const build = (probe, ext, kind, zscale = true) => copyArgs({
  plan: convert(probe, ext, kind), probe, kind, input: 'https://x/y', output: '/t/out', zscale,
});

test('HEVC HDR: libx264, tone map, 1920 long edge', () => {
  const probe = probeOf([vstream({ codec_name: 'hevc', pix_fmt: 'yuv420p10le', profile: 'Main 10', width: 3840, height: 2160, color_transfer: 'smpte2084' }), astream()]);
  const a = build(probe, 'mov');
  assert.equal(arg(a, '-c:v'), 'libx264');
  assert.equal(arg(a, '-vf'), `${TONEMAP},scale=1920:1080:flags=lanczos,setsar=1`);
  assert.equal(arg(a, '-c:a'), 'copy');
  assert.ok(a.includes('+faststart'));
});

test('rotated portrait iPhone: stored 3840x2160, rotation -90 -> 1080:1920', () => {
  const probe = probeOf([vstream({ codec_name: 'hevc', width: 3840, height: 2160, side_data_list: [{ rotation: -90 }] }), astream()]);
  assert.deepEqual(displayDims(probe), { w: 2160, h: 3840 });
  const a = build(probe, 'mov');
  assert.equal(arg(a, '-vf'), 'scale=1080:1920:flags=lanczos,setsar=1');
  assert.ok(a.includes('rotate=0'));
});

test('rotate tag also counts', () => {
  assert.deepEqual(displayDims(probeOf([vstream({ width: 1920, height: 1080, tags: { rotate: '270' } })])), { w: 1080, h: 1920 });
});

test('mkv H.264 + AAC: both copied, no filter', () => {
  const probe = probeOf([vstream(), astream()], { format_name: 'matroska,webm' });
  const a = build(probe, 'mkv');
  assert.equal(arg(a, '-c:v'), 'copy');
  assert.equal(arg(a, '-c:a'), 'copy');
  assert.ok(!a.includes('-vf'));
});

test('mov H.264 + pcm: video copied, audio to aac 160k stereo', () => {
  const probe = probeOf([vstream(), astream({ codec_name: 'pcm_s16le' })]);
  const a = build(probe, 'avi');
  assert.equal(arg(a, '-c:v'), 'copy');
  assert.equal(arg(a, '-c:a'), 'aac');
  assert.equal(arg(a, '-b:a'), '160k');
  assert.equal(arg(a, '-ac'), '2');
});

test('AIFF audio job: -vn, aac 256k', () => {
  const probe = probeOf([astream({ codec_name: 'pcm_s16be' })], { format_name: 'aiff' });
  const a = build(probe, 'aif', 'audio');
  assert.ok(a.includes('-vn'));
  assert.equal(arg(a, '-c:a'), 'aac');
  assert.equal(arg(a, '-b:a'), '256k');
  assert.ok(!a.includes('-ac'));
  assert.ok(!a.includes('-c:v'));
});

test('HDR without zscale: no zscale in the filter', () => {
  const probe = probeOf([vstream({ codec_name: 'hevc', width: 3840, height: 2160, color_transfer: 'arib-std-b67' })]);
  const a = build(probe, 'mov', 'video', false);
  assert.ok(!arg(a, '-vf').includes('zscale'));
  assert.ok(!posterArgs({ input: 'x', output: 'y', hdr: true, zscale: false }).join(' ').includes('zscale'));
  assert.ok(posterArgs({ input: 'x', output: 'y', hdr: true, zscale: true }).join(' ').includes('zscale'));
});

test('INPUT_GUARD is on probe, copy and poster; https only', () => {
  const plan = { action: 'convert', video: 'encode', audio: null, hdr: false };
  const probe = probeOf([vstream({ codec_name: 'prores' })]);
  for (const args of [probeArgs('https://x/y'), copyArgs({ plan, probe, kind: 'video', input: 'i', output: 'o' }), posterArgs({ input: 'i', output: 'o' })]) {
    const i = args.indexOf('-protocol_whitelist');
    assert.ok(i >= 0);
    assert.deepEqual(args.slice(i, i + 4), [...INPUT_GUARD]);
    assert.ok(args.includes('-nostdin') || args[0] === '-v');
  }
  const protos = arg([...INPUT_GUARD], '-protocol_whitelist').split(',');
  assert.ok(protos.includes('https'));
  assert.ok(!protos.includes('http'));
  assert.ok(!arg([...INPUT_GUARD], '-format_whitelist').split(',').some((f) => ['hls', 'dash', 'concat', 'image2'].includes(f)));
});

test('trimProbe drops tags and filenames', () => {
  const t = trimProbe({
    format: { filename: 'https://x/y?t=abc', format_name: 'mov,mp4', duration: '3.5', size: '100', bit_rate: '9', tags: { title: 'Secret' } },
    streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', width: 10, height: 20, tags: { handler_name: 'x' }, side_data_list: [{ rotation: 90 }], disposition: { attached_pic: 0, default: 1 } }],
  });
  const s = JSON.stringify(t);
  assert.ok(!s.includes('Secret') && !s.includes('filename') && !s.includes('abc') && !s.includes('handler'));
  assert.equal(t.format.duration, 3.5);
  assert.equal(t.streams[0].rotation, 90);
});

test('scrubError strips URLs and tokens, caps length', () => {
  const m = scrubError('ffmpeg exited 1: https://main.example.workers.dev/api/media/copy/source?key=a%2Fb&t=abcDEF123456 Server returned 403');
  assert.ok(!m.includes('https://') && !m.includes('abcDEF') && !m.includes('workers.dev'));
  assert.ok(m.includes('403'));
  assert.ok(scrubError('x'.repeat(1000)).length <= 300);
});

test('interlaced footage is deinterlaced before anything else', () => {
  const p = probeOf([vstream({ codec_name: 'mpeg2video', field_order: 'tt', width: 1920, height: 1080 }), astream({ codec_name: 'mp2' })], { format_name: 'mpegts' });
  assert.match(arg(build(p, 'mts', 'video'), '-vf'), /^bwdif=mode=send_frame,scale=1920:1080/);
});

test('non-square pixels come out square at the shape they were meant to be', () => {
  // NTSC DV widescreen: 720x480 stored, 40:33 pixels → 873x480 upright.
  const p = probeOf([vstream({ codec_name: 'dvvideo', pix_fmt: 'yuv411p', width: 720, height: 480, sample_aspect_ratio: '40:33', field_order: 'bb' })], { format_name: 'dv' });
  assert.deepEqual(displayDims(p), { w: 873, h: 480 });
  assert.match(arg(build(p, 'dv', 'video'), '-vf'), /scale=874:480:flags=lanczos,setsar=1$/);
});

test('cover art is never mapped as the picture', () => {
  const p = probeOf([vstream({ codec_name: 'mjpeg', disposition: { attached_pic: 1 } }), vstream({ index: 1, codec_name: 'hevc' }), astream()]);
  const a = build(p, 'mov', 'video');
  assert.equal(arg(a, '-map'), '0:V:0');
});

test('the Worker source rides out a dropped connection; a local file needs nothing', () => {
  const p = probeOf([vstream({ codec_name: 'hevc' }), astream()]);
  const a = build(p, 'mov', 'video');
  assert.ok(a.indexOf('-reconnect') > -1 && a.indexOf('-reconnect') < a.indexOf('-i'), 'before -i: an input option');
  assert.ok(!probeArgs('/tmp/copy.mp4').includes('-reconnect'));
  assert.ok(probeArgs('https://x/y').includes('-reconnect_on_network_error'));
});
