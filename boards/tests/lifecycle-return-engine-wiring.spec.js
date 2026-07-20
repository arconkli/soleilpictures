// Source-guard for the reason-to-return engine (Slice 1: migration 0194):
//   • the lifecycle CTA is now a real (bulletproof) button, not a bare text
//     link — the founder notes opened well but almost nobody clicked through;
//   • two new lifecycle reasons, board_waiting + nudge_dormant_early, are wired
//     end to end across the three places a lifecycle type must be registered
//     (templates.ts, send-transactional-email, the cron dispatcher) plus the
//     migration RPCs — a type registered in only some of them silently 400s or
//     over-sends. None of this runs in the Playwright harness (edge functions +
//     Postgres), so this mirrors email-thumb-wiring.spec's "it's wired" style.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const repo = new URL('../../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, repo), 'utf8');
const templates = () => read('supabase/functions/_shared/email/templates.ts');
const sender = () => read('supabase/functions/send-transactional-email/index.ts');
const cron = () => read('supabase/functions/lifecycle-email-cron/index.ts');
const migration = () => read('supabase/migrations/0194_lifecycle_return_engine.sql');

const NEW_TYPES = ['board_waiting', 'nudge_dormant_early'];

test.describe('reason-to-return engine wiring (0194)', () => {
  test('the lifecycle CTA renders as a bulletproof button, not a bare text link', () => {
    const s = templates();
    // noteBtn is the single CTA helper every lifecycle note uses. It must emit
    // a table-based button (Gmail/Outlook/Apple render the shape) — the old
    // inline underlined <a> was the 2.8%-click drag.
    const fn = s.split('function noteBtn(')[1]?.split('\nfunction ')[0] || '';
    expect(fn).toContain('role="presentation"');
    expect(fn).toContain('bgcolor="#1a1a1a"');
    expect(fn).toMatch(/display:inline-block/);
    // The lapsed-session reassurance so a click that lands on the OTP wall
    // isn't read as a dead end.
    expect(fn).toContain('6-digit code');
    // The retired bare-link form must not linger as the CTA.
    expect(fn).not.toMatch(/margin:2px 0 18px;[^`]*text-decoration:underline/);
  });

  test('templates.ts registers both new types in the union, list, and switch', () => {
    const s = templates();
    for (const t of NEW_TYPES) {
      expect(s).toContain(`"${t}"`);            // TemplateName + TEMPLATE_NAMES
      expect(s).toContain(`case "${t}":`);       // renderTemplate switch
    }
    // The builders exist and reuse the shared shapes (not a parallel machinery).
    expect(s).toMatch(/function boardWaiting\(d: WelcomeBoardData\)/);
    expect(s).toMatch(/function nudgeDormantEarly\(d: ActivateNudgeData\)/);
    // board_waiting is a picture win-back — it must reuse the own-thumbnail pull.
    const bw = s.split('function boardWaiting(')[1]?.split('\nfunction ')[0] || '';
    expect(bw).toContain('EMAIL_THUMB_PREFIX');
    expect(bw).toContain('noteImg(');
  });

  test('send-transactional-email routes both as lifecycle (From, unsub, category)', () => {
    const s = sender();
    for (const t of NEW_TYPES) {
      expect(s).toContain(`case "${t}":`);        // fromAddress → FROM_LIFECYCLE
    }
    // One-click List-Unsubscribe (RFC 8058) is required on bulk/lifecycle mail.
    expect(s).toMatch(/LIST_UNSUB_TEMPLATES = new Set\(\[[^\]]*"board_waiting"[^\]]*"nudge_dormant_early"/);
    // The dashboard bucket must classify them as lifecycle, not transactional.
    expect(s).toMatch(/emailCategory[\s\S]{0,200}board_waiting[\s\S]{0,40}nudge_dormant_early[\s\S]{0,40}return "lifecycle"/);
  });

  test('the cron dispatches both, in the right priority slot', () => {
    const s = cron();
    // board_waiting must run AFTER welcome_board and BEFORE reengage_1; the
    // gap-filler AFTER reengage_1 and BEFORE the activation nudges — priority
    // order is what lets the most-perishable reason win the one-per-day slot.
    const iWelcome = s.indexOf('runType("welcome_board"');
    const iBoardWaiting = s.indexOf('runType("board_waiting"');
    const iReengage = s.indexOf('runType("reengage_1"');
    const iDormant = s.indexOf('runType("nudge_dormant_early"');
    const iNudge2 = s.indexOf('runType("activate_nudge_2"');
    expect(iWelcome).toBeGreaterThan(-1);
    expect(iBoardWaiting).toBeGreaterThan(iWelcome);
    expect(iReengage).toBeGreaterThan(iBoardWaiting);
    expect(iDormant).toBeGreaterThan(iReengage);
    expect(iNudge2).toBeGreaterThan(iDormant);
    // board_waiting must compute the signed thumb URL (own-board picture).
    const bw = s.split('runType("board_waiting"')[1]?.split('runType("reengage_1"')[0] || '';
    expect(bw).toContain('emailThumbUrl(');
    // And the test-hook preview path must sign a thumb for board_waiting too.
    expect(s).toMatch(/type === "welcome_board" \|\| type === "board_waiting"/);
  });

  test('the migration defines both RPCs (granted to service_role) + extends the CHECK + bandit', () => {
    const s = migration();
    expect(s).toContain('create or replace function public.lifecycle_due_board_waiting(');
    expect(s).toContain('create or replace function public.lifecycle_due_nudge_dormant_early(');
    expect(s).toMatch(/grant execute on function public\.lifecycle_due_board_waiting\([^)]*\) to service_role/);
    expect(s).toMatch(/grant execute on function public\.lifecycle_due_nudge_dormant_early\([^)]*\) to service_role/);
    // The type CHECK must admit the new values (drop + re-add, per 0184).
    expect(s).toMatch(/add constraint lifecycle_email_log_email_type_check[\s\S]*'board_waiting'[\s\S]*'nudge_dormant_early'/);
    // Bandit config entries so the copy A/B optimizer covers them.
    for (const t of NEW_TYPES) expect(s).toContain(`'${t}', jsonb_build_object(`);
    // The gap-filler must be disjoint from the win-backs by construction:
    // board_waiting requires activation, nudge_dormant_early requires its
    // absence — so a user can never match both.
    expect(s).toContain('and p.first_populated_board_at is not null');  // board_waiting
    expect(s).toContain('and p.first_populated_board_at is null');      // nudge_dormant_early
  });
});
