#!/usr/bin/env node
// Product shots and demo clips, from a committed shot list.
//
//   npm run shots                       — every shot, every profile
//   npm run shots -- canvas-hero        — one shot by name
//   npm run shots -- --list             — what's in the list
//   npm run shots -- --origin https://clusters.soleilpictures.com
//
// The point of a shot LIST rather than a set of instructions in someone's head
// is that the tenth re-shoot is identical to the first. Copy changes, the
// canvas gets a new card kind, a colour moves — re-run this and every asset is
// regenerated at every size, framed the same way, with the same staging.
//
// ── How the staging gets applied ───────────────────────────────────────────
// Capture Mode rehydrates its flags from sessionStorage on arm, so each shot's
// `capture` block is written there by an init script BEFORE the page loads.
// That is the whole mechanism — no special headless mode in the app, no second
// code path to keep in step with what a human sees when they shoot by hand.
//
// ── Why it waits on an attribute ───────────────────────────────────────────
// networkidle never really settles on a live canvas (images stream in tiers,
// presence keeps a socket warm), which is why shootLanding.mjs has to paper
// over it with a flat 5s sleep. The app sets data-capture-ready once it has
// applied the flags, so a run keys off "the app is staged" instead of a guess.

import { mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit, devices } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';

// Playwright starts recording when the CONTEXT is created and cannot be paused,
// so every clip opens with however long the page took to load and settle —
// several seconds of nothing before the first move. There is no API to trim it.
//
// So trim it afterwards, and while we are re-encoding anyway, land on mp4/h264:
// Playwright writes webm, and every platform you would actually post this to
// prefers mp4. If ffmpeg is not on PATH the webm is kept as-is and the offset
// is printed, so the clip is still usable — just cut it yourself.
const HAS_FFMPEG = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

function trimToMp4(src, dest, startMs) {
  const r = spawnSync('ffmpeg', [
    '-v', 'error', '-y',
    '-ss', (Math.max(0, startMs) / 1000).toFixed(3),
    '-i', src,
    // h264 needs even dimensions and yuv420p to play everywhere, including
    // in-feed players that silently refuse anything else.
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'medium',
    '-movflags', '+faststart', '-an',
    dest,
  ], { stdio: 'ignore' });
  return r.status === 0;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

// Device profiles. Named for what the asset is FOR, not for the hardware —
// "phone" is the thing you post vertically, whatever Playwright calls it.
const PROFILES = {
  desktop: { engine: chromium, viewport: { width: 1440, height: 900 }, dsf: 2 },
  wide:    { engine: chromium, viewport: { width: 1920, height: 1080 }, dsf: 2 },
  phone:   { engine: webkit, ...devices['iPhone 13'], dsf: 3 },
  android: { engine: chromium, ...devices['Pixel 5'], dsf: 3 },
  tablet:  { engine: chromium, ...devices['iPad Pro 11'], dsf: 2 },
};

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);
const names = args.filter(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--origin'
                                                   && args[args.indexOf(a) - 1] !== '--list-file');

const LIST = resolve(ROOT, flag('list-file', 'scripts/shots/product-v1.json'));
const list = JSON.parse(readFileSync(LIST, 'utf8'));
const ORIGIN = (flag('origin', process.env.SHOT_ORIGIN || 'http://127.0.0.1:5174')).replace(/\/$/, '');
const OUT = resolve(ROOT, 'shots', list.version || 'v1');

if (has('list')) {
  for (const s of list.shots) {
    console.log(`${s.name.padEnd(24)} ${(s.profiles || list.defaults?.profiles || ['desktop']).join(',')}  ${s.path}`);
  }
  process.exit(0);
}

const wanted = names.length ? list.shots.filter(s => names.includes(s.name)) : list.shots;
if (!wanted.length) {
  console.error(`No shots matched. Try --list.`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

// A rounded, bezelled treatment for the shots that get posted on their own.
// Drawn rather than composited from a bitmap so there is no asset to lose and
// no vendor's hardware to imply.
async function frame(buf, { width, height, radius = 44, pad = 18 }) {
  const w = width + pad * 2;
  const h = height + pad * 2;
  const mask = Buffer.from(
    `<svg width="${width}" height="${height}">
       <rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="#fff"/>
     </svg>`);
  const rounded = await sharp(buf)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
  return sharp({
    create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: rounded, top: pad, left: pad }])
    .png()
    .toBuffer();
}

async function runActions(page, actions = []) {
  for (const a of actions) {
    if (a.wait) { await page.waitForTimeout(a.wait); continue; }
    if (a.key) { await page.keyboard.press(a.key); continue; }
    if (a.click) { await page.locator(a.click).first().click({ timeout: 10000 }).catch(() => {}); continue; }
    if (a.camera) {
      // The same event the HUD dispatches, so a scripted move is the move a
      // person would make by hand rather than a second implementation.
      await page.evaluate(({ target, ms }) => {
        document.dispatchEvent(new CustomEvent('soleil-capture-camera', { detail: { target, ms } }));
      }, { target: a.camera, ms: a.ms });
      await page.waitForTimeout((a.ms || 900) + 250);
      continue;
    }
    if (a.take) {
      // A named sequence — the same ones the HUD offers. The app reports the
      // duration back so the wait comes from the take's own arithmetic rather
      // than a number copied into the shot list that then drifts.
      const ms = await page.evaluate((id) => {
        document.dispatchEvent(new CustomEvent('soleil-capture-camera', { detail: { take: id } }));
        return window.__soleilCapture?.takeMs?.(id) ?? 6000;
      }, a.take);
      await page.waitForTimeout(ms + 400);
      continue;
    }
    if (a.moves) {
      await page.evaluate((moves) => {
        document.dispatchEvent(new CustomEvent('soleil-capture-camera', { detail: { moves } }));
      }, a.moves);
      await page.waitForTimeout(a.moves.reduce((s, m) => s + (m.ms ?? 900), 0) + 400);
      continue;
    }
    if (a.capture) {
      // Change staging mid-take — e.g. bring the cast in after the first beat.
      await page.evaluate((patch) => window.__soleilCapture?.set(patch), a.capture);
      await page.waitForTimeout(250);
    }
  }
}

let made = 0;
let skipped = 0;

for (const shot of wanted) {
  const profiles = shot.profiles || list.defaults?.profiles || ['desktop'];
  for (const profileName of profiles) {
    const p = PROFILES[profileName];
    if (!p) { console.error(`  ! unknown profile "${profileName}"`); skipped++; continue; }

    const { engine, dsf, ...device } = p;
    const browser = await engine.launch();
    const videoDir = shot.video ? join(OUT, `.video-${shot.name}-${profileName}`) : null;
    const context = await browser.newContext({
      ...device,
      deviceScaleFactor: shot.video ? 1 : (shot.dpr || list.defaults?.dpr || dsf),
      ...(videoDir ? { recordVideo: { dir: videoDir, size: device.viewport } } : {}),
    });

    // Staging, written before the app boots. captureState reads exactly this
    // key when an admin tier arms it.
    if (shot.capture) {
      await context.addInitScript((cap) => {
        try { sessionStorage.setItem('soleil.capture', JSON.stringify(cap)); } catch (_) {}
      }, shot.capture);
    }
    // The tool's own furniture, out of the tool's own output.
    //
    // The HUD: a person shooting by hand dismisses it with its ✕; an automated
    // run has no hands and never wants its controls in the asset.
    //
    // The aspect mask: it is a VIEWFINDER — it exists so a human can see what
    // will be cropped. Baking the letterbox into the file would be shipping the
    // guide instead of the picture. The shot's `aspect` still does its real
    // job, which is telling the reframe how many cards should read across.
    await context.addInitScript(() => {
      const hide = () => {
        const el = document.createElement('style');
        el.textContent = '.capture-hud,.capture-hud-dot,.capture-mask{display:none !important}';
        document.head.appendChild(el);
      };
      if (document.head) hide();
      else document.addEventListener('DOMContentLoaded', hide, { once: true });
    });

    const page = await context.newPage();
    const url = `${ORIGIN}${shot.path}`;
    // Recording is already running by now — the clock for the lead-in trim
    // starts with the context, not with the first move.
    const startedAt = Date.now();
    process.stdout.write(`${shot.name} @ ${profileName} … `);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      // Staged pages announce themselves; public pages just need their content.
      const ready = shot.capture?.on
        ? page.locator('html[data-capture-ready="1"]')
        : page.locator(shot.readySelector || 'body');
      await ready.first().waitFor({ state: 'attached', timeout: 30000 });
      if (shot.readySelector) await page.locator(shot.readySelector).first().waitFor({ timeout: 30000 });

      // Re-apply the full staging block through the app's own control surface.
      // The seeded sessionStorage above gets the page booting already staged
      // (no flash of unstaged UI), but it deliberately cannot carry `persona`
      // or `cast` — those are never restored from storage, because a fake
      // identity must not outlive a tab. This is where they land.
      if (shot.capture) {
        await page.evaluate((cap) => window.__soleilCapture?.set(cap), shot.capture);
      }
      await page.waitForTimeout(shot.settle ?? list.defaults?.settle ?? 1500);

      // Everything before this point is page load and staging — dead air in a
      // recording. Remember where the shot actually starts.
      const leadInMs = Date.now() - startedAt;

      await runActions(page, shot.actions);

      if (shot.video) {
        await context.close();
        await browser.close();
        // Playwright names the file itself; take the one it produced.
        const produced = readdirSync(videoDir).find(f => f.endsWith('.webm'));
        if (produced) {
          const raw = join(videoDir, produced);
          const mp4 = join(OUT, `${shot.name}@${profileName}.mp4`);
          if (HAS_FFMPEG && trimToMp4(raw, mp4, leadInMs)) {
            console.log(`→ ${shot.name}@${profileName}.mp4  (trimmed ${(leadInMs / 1000).toFixed(1)}s of lead-in)`);
          } else {
            const dest = join(OUT, `${shot.name}@${profileName}.webm`);
            writeFileSync(dest, readFileSync(raw));
            console.log(`→ ${shot.name}@${profileName}.webm  (cut the first ${(leadInMs / 1000).toFixed(1)}s — no ffmpeg)`);
          }
          rmSync(videoDir, { recursive: true, force: true });
          made++;
        } else {
          console.log('! no video produced');
          skipped++;
        }
        continue;
      }

      // Park the pointer off-canvas before the shutter. Playwright leaves it at
      // 0,0 or wherever the last action put it, and a card under the cursor
      // renders its hover affordances — an image toolbar or a resize handle
      // sitting in the middle of an otherwise clean product shot.
      await page.mouse.move(-50, -50).catch(() => {});
      await page.waitForTimeout(250);

      const clip = shot.selector
        ? await page.locator(shot.selector).first().boundingBox()
        : null;
      let buf = await page.screenshot({ type: 'png', ...(clip ? { clip } : {}) });

      if (shot.frame) {
        const meta = await sharp(buf).metadata();
        buf = await frame(buf, { width: meta.width, height: meta.height });
      }

      const base = join(OUT, `${shot.name}@${profileName}`);
      writeFileSync(`${base}.png`, await sharp(buf).png({ compressionLevel: 9 }).toBuffer());
      writeFileSync(`${base}.webp`, await sharp(buf).webp({ quality: 92 }).toBuffer());
      console.log(`→ ${shot.name}@${profileName}.{png,webp}`);
      made++;
    } catch (err) {
      console.log(`! ${err.message.split('\n')[0]}`);
      skipped++;
    } finally {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
      if (videoDir) rmSync(videoDir, { recursive: true, force: true });
    }
  }
}

console.log(`\n${made} asset${made === 1 ? '' : 's'} in shots/${list.version || 'v1'}/${skipped ? `, ${skipped} skipped` : ''}`);
process.exit(skipped && !made ? 1 : 0);
