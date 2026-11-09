// One invariant test over every email Clusters sends.
//
// What it guards: every template in TEMPLATE_NAMES, plus the trial-ending
// email and the Supabase magic-link template, keeps the one dark look
// ("Darkroom", supabase/functions/_shared/email/theme.ts) and its safety
// furniture (preheader, alt text, bulletproof buttons, postal address and
// unsubscribe link on lifecycle mail).
//
// Why: gold (#ffa500 and friends) is for app focus states only and must never
// reach an inbox; emoji are banned everywhere; Gmail clips a message at about
// 102KB, which hides the footer and the unsubscribe link, so html stays under
// 100,000 bytes. A new template without a SAMPLE entry fails here, so it
// cannot ship unchecked.
//
// product_update edition 2026-10-31 keeps the old look on purpose
// (productUpdateLegacy.test.mjs pins it byte-for-byte), so it is exempt from
// the look assertions but still checked for emoji, size and text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../../supabase/', import.meta.url);
const { renderTemplate, TEMPLATE_NAMES } = await import(new URL('functions/_shared/email/templates.ts', root));
const { renderTrialEnding } = await import(new URL('functions/_shared/email/trialEnding.ts', root));
const { MARK_URL } = await import(new URL('functions/_shared/email/theme.ts', root));
const { POSTAL_ADDRESS } = await import(new URL('functions/_shared/email/layout.ts', root));
const indexSrc = readFileSync(new URL('functions/send-transactional-email/index.ts', root), 'utf8');
const magicLink = readFileSync(new URL('templates/magic_link.html', root), 'utf8');

function setLiteral(name) {
  const m = indexSrc.match(new RegExp(`const ${name}\\s*=\\s*(?:new Set\\()?\\[([\\s\\S]*?)\\]`));
  assert.ok(m, `${name} not found in send-transactional-email/index.ts`);
  const names = new Set([...m[1].matchAll(/"([a-z0-9_]+)"/g)].map((x) => x[1]));
  assert.ok(names.size > 0, `${name} parsed empty`);
  return names;
}
const NOTE_LOOK_TEMPLATES = setLiteral('NOTE_LOOK_TEMPLATES');
const LIST_UNSUB_TEMPLATES = setLiteral('LIST_UNSUB_TEMPLATES');

const hex = (c) => c.repeat(64);
const U = '1b4e28ba-2fa1-4d2e-9a3b-5c6d7e8f9012', W = '7c9e6679-7425-40de-944b-e07fc1f90ae7', B = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const card = (id) => `https://clusters.soleilpictures.com/api/email-card/${B}/${id}?s=${'ab12cd34'.repeat(4)}`;
const common = { workspaceId: W, boardId: B, boardName: 'Kestrel Lane, location scout', unsubscribeToken: hex('a'), resumeToken: hex('b'), firstName: 'Maya' };
const added = { counts: { image: 38, note: 4, pdf: 1, link: 2 }, items: [
  { kind: 'image', url: card('c1'), w: 1600, h: 1067 }, { kind: 'image', url: card('c2'), w: 1067, h: 1600 },
  { kind: 'note', label: 'Opening scene beats' }, { kind: 'pdf', label: 'Call sheet day 3.pdf' }] };
const thumb = `https://clusters.soleilpictures.com/api/email-thumb/${B}?v=1&s=${'ab12cd34'.repeat(4)}`;
const live = { variant: 'c1' };
const productUpdate = { ...common, subject: 'a new look, and a home for every file', preheader: 'documents rebuilt, tags you can see, video that plays anywhere.',
  greeting: 'hey, the clusters team here.', intro: "clusters looks different now, and it holds a lot more. here's what's new, all live today:",
  items: [
    { lead: 'a new look.', text: 'your clusters on one card, your files on another, both floating over the work.' },
    { lead: 'a home for every file.', text: "everything you bring in lives in files. press F and it's all there." },
    { lead: 'documents, rebuilt.', text: 'treatments, scripts, notes: one clean toolbar, every comment in a side panel.' },
    { lead: 'tags you can see.', text: 'click one and every card that shares it lights up.' }],
  ctaLabel: 'open clusters', ctaPath: '/', imageUrl: 'https://clusters.soleilpictures.com/email/2026-11-02-new-look.jpg',
  imageAlt: 'A Soleil Pictures board in Clusters: posters, a treatment, a script and a teammate working live',
  outro: 'everything else is in the changelog. and if you have a question, just hit reply.',
  signoff: 'talk soon, the clusters team', version: '2026-11-30', variant: 'A' };

const SAMPLE = {
  waitlist_submitted: {}, waitlist_accepted: {},
  workspace_invite: { workspaceName: 'Soleil Pictures', inviterName: 'Jordan Reyes', role: 'editor', workspaceId: W },
  board_shared: { boardName: 'Kestrel Lane, location scout', sharerName: 'Jordan Reyes', role: 'editor', workspaceId: W, boardId: B },
  invite_accepted: { joinerName: 'Priya Nair', boardName: 'Kestrel Lane, location scout', role: 'editor', workspaceId: W, boardId: B },
  invite_reward: { cards: 25, storage: '0.5GB', unsubscribeToken: hex('a') },
  edit_request: { askerName: 'Priya Nair', boardName: 'Kestrel Lane, location scout', workspaceId: W, boardId: B },
  edit_granted: { sharerName: 'Jordan Reyes', boardName: 'Kestrel Lane, location scout', workspaceId: W, boardId: B },
  pending_invite: { inviterName: 'jordan@example.com', workspaceName: 'Soleil Pictures', boardName: 'Kestrel Lane, location scout', role: 'editor', token: hex('c'), expiresAt: '2026-11-18T18:00:00Z' },
  team_invite: { teamName: 'Harbor Light Films', inviterName: 'Jordan Reyes', role: 'admin', token: hex('d') },
  mention_email: { mentionerName: 'Jordan Reyes', surface: 'board', surfaceContext: 'Kestrel Lane, location scout', messagePreview: 'Maya, can you pull the three best barn exteriors before the 4pm call?', workspaceId: W, boardId: B, unsubscribeToken: hex('a') },
  comment_reply_email: { replierName: 'Jordan Reyes', boardName: 'Kestrel Lane, location scout', workspaceName: 'Soleil Pictures', replyPreview: 'Agreed, the second one has the better light. Let us lock it.', workspaceId: W, boardId: B, unsubscribeToken: hex('a') },
  file_shared: { sharerName: 'Jordan Reyes', fileName: 'Barn exterior final.psd', role: 'comment', kind: 'file', token: U, origin: 'https://clusters.soleilpictures.com' },
  file_commented: { commenterName: 'Priya Nair', fileName: 'Barn exterior final.psd', commentPreview: 'Can we warm up the sky a touch?', token: U, origin: 'https://clusters.soleilpictures.com', unsubscribeToken: hex('a') },
  activate_nudge_1: { ...common, ...live, added },
  activate_nudge_2: { ...common, ...live },
  reengage_1: { ...common, ...live },
  welcome_board: { ...common, ...live, thumbUrl: thumb },
  board_waiting: { ...common, ...live, thumbUrl: thumb, added },
  nudge_dormant_early: { ...common, ...live },
  whats_new: { ...common, ...live, thumbUrl: thumb, imageUrl: 'https://clusters.soleilpictures.com/email/2026-11-02-new-look.jpg', items: ['Documents rebuilt, with one clean toolbar', 'Tags you can see', 'Video and sound play in any browser'], ctaLabel: 'Open Clusters', version: '2026-10-31' },
  product_update: productUpdate,
  schedule_update: { kind: 'schedule.published', title: 'Day 3 call times changed - Tue Nov 10', body: 'Crew call moves to 6:30am. Base camp is now the north lot.', productionName: 'Kestrel Lane', version: '4', unsubscribeToken: hex('a'), workspaceId: W, boardId: B },
  share_activity: { title: 'Someone opened one of your clusters', boardName: 'Kestrel Lane, location scout', viewers: 3, workspaceId: W, boardId: B, unsubscribeToken: hex('a'), resumeToken: hex('b') },
  ops_alert: { alertId: '1042', kind: 'invariant', title: 'A database check failed', body: ['check: board_tree roots', 'workspaces without a live root: 1'], createdAt: '2026-11-04T09:12:00Z' },
};

test('every TEMPLATE_NAMES entry has a sample', () => {
  const missing = TEMPLATE_NAMES.filter((n) => !(n in SAMPLE));
  assert.deepEqual(missing, [], `add a SAMPLE entry for: ${missing.join(', ')}`);
});

// Every email to check: { id, template, r, legacy }.
const cases = [];
for (const n of TEMPLATE_NAMES) {
  if (n in SAMPLE) cases.push({ id: n, template: n, r: renderTemplate(n, SAMPLE[n]), legacy: false });
}
cases.push({ id: 'product_update (2026-10-31 legacy)', template: 'product_update', r: renderTemplate('product_update', { ...productUpdate, version: '2026-10-31' }), legacy: true });
cases.push({ id: 'trial_ending', template: 'trial_ending', r: renderTrialEnding({ chargeAt: 'November 7, 2026 at 1:30 AM UTC', amountLabel: '$12/month' }), legacy: false });

const GOLD = /#ffa500|#ffb733|#ff9f0a|#f5a623/i;
// Extended_Pictographic also matches the plain text marks (c), (r) and TM that
// the footers use ("© Soleil Pictures"); those are not emoji.
const EMOJI = /(?![©®™])\p{Extended_Pictographic}/u;
const PREHEADER_RE = /<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">([\s\S]*?)<\/div>/;

for (const { id, template, r, legacy } of cases) {
  test(`${id}: no emoji, non-empty text, html under 100,000 bytes`, () => {
    assert.ok(r.text && r.text.trim().length > 0, 'text part is empty');
    assert.ok(!EMOJI.test(r.subject ?? ''), 'emoji in subject');
    assert.ok(!EMOJI.test(r.text), 'emoji in text');
    if (r.html) {
      assert.ok(!EMOJI.test(r.html), 'emoji in html');
      assert.ok(Buffer.byteLength(r.html) < 100000, `html is ${Buffer.byteLength(r.html)} bytes`);
    }
  });

  if (template === 'ops_alert') {
    test('ops_alert is text-only', () => {
      assert.ok(!r.html, 'ops_alert has an html part');
    });
    continue;
  }

  if (!legacy) {
    test(`${id}: the Darkroom look`, () => {
      const h = r.html;
      assert.ok(h, 'no html');
      assert.ok(!GOLD.test(h), 'gold in html');
      assert.ok(h.includes('<meta name="color-scheme" content="dark only">'), 'no dark-only meta');
      assert.ok(h.includes(MARK_URL), 'no mark');
      const pre = h.match(PREHEADER_RE);
      assert.ok(pre, 'no hidden preheader div');
      const preText = pre[1].replace(/&zwnj;|&nbsp;/g, '').trim();
      assert.ok(preText.length > 0, 'preheader div has no text');
      for (const img of h.match(/<img\b[^>]*>/g) ?? []) assert.match(img, /\balt=/, `img without alt: ${img.slice(0, 80)}`);
      for (const td of h.match(/<td\b[^>]*class="btn"[^>]*>/g) ?? []) {
        assert.match(td, /\bbgcolor=/, 'btn td without bgcolor');
        assert.match(td, /mso-padding-alt/, 'btn td without mso-padding-alt');
      }
    });
  }

  if (NOTE_LOOK_TEMPLATES.has(template) && !legacy) {
    test(`${id}: lifecycle note carries the postal address and unsubscribe`, () => {
      assert.ok(r.html.includes(POSTAL_ADDRESS), 'no postal address in html');
      assert.match(r.html, />Unsubscribe<\/a>/, 'no Unsubscribe link');
      assert.ok(r.text.includes('Unsubscribe:'), 'text has no "Unsubscribe:"');
    });
  }

  if (LIST_UNSUB_TEMPLATES.has(template)) {
    test(`${id}: html carries an unsubscribe link when given a token`, () => {
      assert.match(r.html, /href="[^"]*unsubscribe[^"]*"/i);
    });
  }
}

test('magic_link.html is dark, gold-free and carries the token placeholder', () => {
  assert.ok(magicLink.includes('dark only'), 'no dark only');
  assert.ok(magicLink.includes('{{ .Token }}'), 'no {{ .Token }}');
  assert.ok(!/\{\{[^}]*ConfirmationURL[^}]*\}\}/.test(magicLink), 'ConfirmationURL placeholder present');
  assert.ok(!GOLD.test(magicLink), 'gold in magic_link');
  assert.ok(!EMOJI.test(magicLink), 'emoji in magic_link');
});

test('quote() avatar initials skip leading punctuation and invisible characters', async () => {
  const { quote } = await import(new URL('functions/_shared/email/theme.ts', root));
  const initialsIn = (who) => quote({ who, text: 'hi' }).match(/class="avatar"[^>]*>([^<]*)<\/td>/)[1];
  const rows = [
    ['"Bob"', 'B'], ['\u{200F}Maria', 'M'], ['(Studio) Nine', 'SN'],
    ['\u{AB}\u{41C}\u{430}\u{440}\u{438}\u{44F}\u{BB} \u{418}\u{432}\u{430}\u{43D}\u{43E}\u{432}\u{430}', '\u{41C}\u{418}'],
    ['Jean - Luc', 'JL'], ['...', ''], ['\u{0301}abc', 'A'], ['\u{5C71}\u{7530} \u{592A}\u{90CE}', '\u{5C71}'], ['maya ortiz', 'MO'],
  ];
  for (const [who, want] of rows) assert.equal(initialsIn(who), want, who);
});
