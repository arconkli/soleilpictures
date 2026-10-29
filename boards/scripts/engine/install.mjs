#!/usr/bin/env node
// install.mjs — sets the boards engine up to run every morning on this Mac.
//
//   node scripts/engine/install.mjs            the checkout + the 06:00 launchd job
//   node scripts/engine/install.mjs --remove   unloads and deletes the job (the checkout stays)
//
// 1. A checkout of its own at ENGINE_REPO (default ~/soleil-engine): a detached
//    git worktree of this repo at origin/main, which daily.sh moves to the
//    newest main before each run. Never a worktree someone works in.
// 2. Its scripts/.env: a link to this checkout's (git-ignored, holds the
//    service-role key, never leaves the Mac).
// 3. ~/Library/LaunchAgents/com.soleil.boards-engine.plist: daily.sh at 06:00,
//    logging to ~/Library/Logs/boards-engine.log. launchd runs a missed 06:00
//    when the Mac wakes.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, symlinkSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BOARDS = resolve(HERE, '../..');
const REPO = resolve(process.env.ENGINE_REPO || join(homedir(), 'soleil-engine'));
const LABEL = 'com.soleil.boards-engine';
const PLIST = join(homedir(), 'Library/LaunchAgents', `${LABEL}.plist`);
const LOG = join(homedir(), 'Library/Logs/boards-engine.log');
const uid = process.getuid();

const git = (...a) => execFileSync('git', a, { cwd: BOARDS, encoding: 'utf8' }).trim();
const launchctl = (...a) => { try { execFileSync('launchctl', a, { stdio: 'ignore' }); } catch (_) { /* not loaded */ } };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

if (process.argv.includes('--remove')) {
  launchctl('bootout', `gui/${uid}/${LABEL}`);
  rmSync(PLIST, { force: true });
  console.log(`removed ${LABEL} (the checkout at ${REPO} stays)`);
  process.exit(0);
}

if (!existsSync(REPO)) {
  git('fetch', '-q', 'origin', 'main');
  git('worktree', 'add', '--detach', REPO, 'origin/main');
  console.log(`checkout: ${REPO}`);
}
const env = join(REPO, 'boards/scripts/.env');
if (!existsSync(env)) {
  const mine = join(BOARDS, 'scripts/.env');
  if (!existsSync(mine)) throw new Error(`no ${mine} to link: fill it in from .env.example first`);
  symlinkSync(mine, env);
}
if (!existsSync(join(REPO, 'boards/node_modules'))) {
  execFileSync('npm', ['ci', '--no-audit', '--no-fund', '--cache', join(process.env.TMPDIR || '/tmp', 'boards-engine-npm')],
    { cwd: join(REPO, 'boards'), stdio: 'inherit' });
}
const daily = join(REPO, 'boards/scripts/engine/daily.sh');
if (!existsSync(daily)) throw new Error(`${daily} is missing: main doesn't have the engine yet`);
chmodSync(daily, 0o755);

const path = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin', join(homedir(), '.local/bin')].join(':');
mkdirSync(dirname(PLIST), { recursive: true });
mkdirSync(dirname(LOG), { recursive: true });
writeFileSync(PLIST, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- The boards engine's morning run. Written by boards/scripts/engine/install.mjs. -->
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>/bin/zsh</string><string>${esc(daily)}</string></array>
  <key>WorkingDirectory</key><string>${esc(REPO)}</string>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>0</integer></dict>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${esc(path)}</string>
    <key>HOME</key><string>${esc(homedir())}</string>
    <key>ENGINE_REPO</key><string>${esc(REPO)}</string>
  </dict>
  <key>StandardOutPath</key><string>${esc(LOG)}</string>
  <key>StandardErrorPath</key><string>${esc(LOG)}</string>
</dict>
</plist>
`);
launchctl('bootout', `gui/${uid}/${LABEL}`);
execFileSync('launchctl', ['bootstrap', `gui/${uid}`, PLIST], { stdio: 'inherit' });
console.log(`installed ${LABEL}: daily.sh at 06:00, log ${LOG}`);
