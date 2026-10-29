// lifecycleOneNote.test.mjs — three lifecycle emails become one note each
// (migration 0790). activate_nudge_1 and welcome_board stop rotating subject and
// body arms; board_waiting stops its A/B. activate_nudge_1 and board_waiting
// also show what the person added (counts plus up to four small signed
// pictures from /api/email-card), and half of the people due either are held
// back for six weeks to learn whether the note brings anyone back.
//
//   node --test src/lib/lifecycleOneNote.test.mjs
//
// The edge functions and Postgres do not run here, so the migration, the cron
// and the Worker parts below are SOURCE PINS (they read the files and assert
// on the text that carries the guarantee). The templates are the exception:
// templates.ts is imported and rendered for real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const sql = read('../../../supabase/migrations/0790_lifecycle_one_note_and_holdout.sql');
const cron = read('../../../supabase/functions/lifecycle-email-cron/index.ts');
const worker = read('../worker.js');

const oneLine = (s) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');

// The text between two markers (start inclusive, end exclusive).
const between = (src, start, end) => {
  const i = src.indexOf(start);
  assert.ok(i >= 0, `found: ${start}`);
  const j = src.indexOf(end, i + start.length);
  assert.ok(j > i, `found after it: ${end}`);
  return src.slice(i, j);
};

const picFn = between(sql, 'create or replace function public._lifecycle_email_card_pic', '$function$;\n\n-- ── 3b');
const addedFnStart = sql.indexOf('create or replace function public._lifecycle_email_added');
const addedFn = sql.slice(addedFnStart, sql.indexOf('$function$;', sql.indexOf('as $function$', addedFnStart)));

// ── Migration: config ───────────────────────────────────────────────────────

// One type's jsonb_build_object block inside the config update.
const typeBlock = (name) => {
  const m = sql.match(new RegExp(`'${name}',\\s*\\n\\s*\\(\\(?c\\.value -> '${name}'\\)[\\s\\S]*?(?=\\n\\s{11}'(?:welcome_board|board_waiting)',|\\n\\s{9}\\),\\s*\\n\\s*updated_at)`));
  assert.ok(m, `${name} block found`);
  return m[0];
};

test('0790 config: all three types go flat on the single arm c1 with weight 100', () => {
  for (const t of ['activate_nudge_1', 'welcome_board', 'board_waiting']) {
    const b = oneLine(typeBlock(t));
    assert.match(b, /'arms',\s*jsonb_build_array\('c1'\)/, `${t} arms`);
    assert.match(b, /'weights',\s*jsonb_build_object\('c1', 100\)/, `${t} weights`);
  }
  // The proof block says the same of the stored result.
  assert.match(sql, /'activate_nudge_1' -> 'arms' <> '\["c1"\]'::jsonb/);
});

test('0790 config: the factorial types lose their factors, kept under retired', () => {
  for (const t of ['activate_nudge_1', 'welcome_board']) {
    const b = oneLine(typeBlock(t));
    assert.ok(b.includes(`(c.value -> '${t}') - 'factors'`), `${t} strips 'factors'`);
    assert.match(b, new RegExp(`'retired'.*'factors', c\\.value -> '${t}' -> 'factors'`), `${t} keeps them in retired`);
  }
  assert.doesNotMatch(oneLine(typeBlock('board_waiting')), /- 'factors'/, 'board_waiting never had factors');
});

test('0790 config: half held back for six weeks on activate_nudge_1 and board_waiting only', () => {
  for (const t of ['activate_nudge_1', 'board_waiting']) {
    const b = oneLine(typeBlock(t));
    assert.match(b, /'holdout_pct',\s*50\b/, `${t} holdout_pct`);
    assert.match(b, /'holdout_weeks',\s*6\b/, `${t} holdout_weeks`);
    assert.match(b, /'holdout_from',\s*to_jsonb\(current_date::text\)/, `${t} holdout_from`);
  }
  const wb = oneLine(typeBlock('welcome_board'));
  assert.doesNotMatch(wb, /holdout_pct/, 'welcome_board holds nobody back');
  assert.match(sql, /if cfg -> 'welcome_board' \? 'holdout_pct' then/, 'the proof block checks it too');
});

test('0790 config: the update raises unless it touched exactly one row', () => {
  const b = oneLine(sql);
  assert.match(b, /where c\.key = 'lifecycle_email_experiments' and c\.value \? 'activate_nudge_1' and c\.value \? 'welcome_board' and c\.value \? 'board_waiting';/);
  assert.match(b, /get diagnostics v_n = row_count; if v_n <> 1 then raise exception '0790: [^']*', v_n;/);
});

// ── Migration: grants ───────────────────────────────────────────────────────

test('0790 grants: both internal helpers are service_role only, and the file proves it', () => {
  for (const sig of ['_lifecycle_email_card_pic(uuid, text)', '_lifecycle_email_added(uuid, uuid, boolean)']) {
    assert.ok(sql.includes(`revoke execute on function public.${sig} from public, anon, authenticated;`), `${sig} revoked`);
    assert.ok(sql.includes(`grant execute on function public.${sig} to service_role;`), `${sig} granted`);
    assert.ok(sql.includes(`'public.${sig}'`), `${sig} is in the proof list`);
  }
  const proof = sql.slice(sql.lastIndexOf('do $$'));
  assert.match(proof, /has_function_privilege\('anon', f, 'execute'\)/);
  assert.match(proof, /has_function_privilege\('authenticated', f, 'execute'\)/);
  assert.match(proof, /not has_function_privilege\('service_role', f, 'execute'\)/);
  assert.match(sql.trimEnd(), /commit;$/, 'the file ends with commit;');
});

// ── Migration: what the picture function trusts ─────────────────────────────

test('0790 picture function: starter cards, deleted rows and foreign workspaces never serve', () => {
  const b = oneLine(picFn);
  assert.match(b, /c\.card_id not like 'onb-%'/);
  assert.match(b, /b\.deleted_at is null/);
  assert.match(b, /i\.deleted_at is null/);
  assert.match(b, /i\.workspace_id = b\.workspace_id/);
});

test('0790 picture function: an original is served only when it is a web image of 1.5 MB or less', () => {
  const b = oneLine(picFn);
  assert.match(b, /i\.size_bytes between 1 and 1500000/);
  assert.match(b, /storage_path ~\* '\\\.\(webp\|jpg\|jpeg\|jpe\|jfif\|png\|gif\)\$'/);
});

test('0790 added function: never reads a note body, and a picture carries no label', () => {
  assert.doesNotMatch(addedFn, /\.body\b/, 'neither ci.body nor c.body');
  assert.doesNotMatch(addedFn, /\bbody\b/i, 'no body column in any form');
  const b = oneLine(addedFn);
  assert.match(b, /'label', case when t\.has_pic then null else t\.label end/);
  assert.match(b, /when c\.kind = 'image' then null/, 'an image card has no label either');
  assert.match(b, /ci\.card_id not like 'onb-%'/, 'starter cards do not count');
});

// ── Worker ──────────────────────────────────────────────────────────────────

const workerCard = between(worker, 'async function handleEmailCard(', '// Same-origin proxy for the board room');
const workerSig = between(worker, 'async function emailCardSig(', '// Serves a board\'s stored thumbnail');

test('worker: /api/email-card/<board uuid>/<card id> is routed to handleEmailCard', () => {
  assert.ok(worker.includes(
    "const emailCardMatch = url.pathname.match(/^\\/api\\/email-card\\/([0-9a-f-]{36})\\/([A-Za-z0-9_-]{1,80})$/i);"));
  assert.ok(worker.includes(
    'if (emailCardMatch) return await handleEmailCard(env, emailCardMatch[1], emailCardMatch[2], url.searchParams, request);'));
});

test('worker and cron sign the same message with the same key, in lockstep', () => {
  assert.ok(workerSig.includes('`${secret}:email-thumb-v1`'), 'worker key derivation');
  assert.ok(workerSig.includes('`email-card:${boardId}:${cardId}`'), 'worker message');
  const cronCard = between(cron, 'async function emailCardUrl(', '\n}\n');
  assert.ok(cronCard.includes('`email-card:${boardId}:${cardId}`'), 'cron message');
  assert.ok(between(cron, 'async function emailHmacKey(', '\n}\n').includes('`${secret}:email-thumb-v1`'), 'cron key derivation');
  assert.ok(cronCard.includes('/api/email-card/${boardId}/${encodeURIComponent(cardId)}?s=${sig}'), 'cron URL shape');
});

test('worker: the signature is checked before the picture lookup', () => {
  const sigAt = workerCard.indexOf("searchParams.get('s') !== expected");
  const rpcAt = workerCard.indexOf("serviceRpc(env, '_lifecycle_email_card_pic'");
  assert.ok(sigAt > 0 && rpcAt > 0, 'both found');
  assert.ok(sigAt < rpcAt, 'signature comparison comes first');
  assert.ok(workerCard.indexOf('emailCardSig(env, boardId, cardId)') < rpcAt);
});

test('worker: a missing picture, an oversize object and the response headers', () => {
  assert.ok(workerCard.includes("if (!pic || !pic.key) return fallback('card-gone');"));
  assert.ok(worker.includes('const EMAIL_CARD_MAX_BYTES = 1_500_000;'));
  assert.ok(workerCard.includes('obj.size > EMAIL_CARD_MAX_BYTES'));
  assert.ok(workerCard.includes("fallback('too-big')"));
  assert.ok(workerCard.includes("'x-robots-tag': 'noindex'"));
  assert.ok(workerCard.includes("'cache-control': 'public, max-age=3600'"));
});

// ── Real signature parity (a self-check of the scheme, not of deployed code) ─

const SECRET = 'test-only-fake-secret';
const BOARD = '3b2d89f2-9c1d-48af-8b89-2517b1b49712';
const CARD = 'img-1-2';
const hmac = async (message) => {
  const enc = new TextEncoder();
  const keyBytes = await globalThis.crypto.subtle.digest('SHA-256', enc.encode(`${SECRET}:email-thumb-v1`));
  const key = await globalThis.crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
};
const CARD_URL_SHAPE = /^https:\/\/clusters\.soleilpictures\.com\/api\/email-card\/[0-9a-f-]{36}\/[A-Za-z0-9_-]{1,80}\?s=[0-9a-f]{32}$/;

test('signatures: a card signature is 32 hex, never a thumb signature, and builds an accepted URL', async () => {
  const card = await hmac(`email-card:${BOARD}:${CARD}`);
  const thumb = await hmac(`email-thumb:${BOARD}`);
  assert.match(card, /^[0-9a-f]{32}$/);
  assert.notEqual(card, thumb, 'a thumb signature cannot pass as a card one');
  assert.notEqual(card, await hmac(`email-card:${BOARD}:other-card`), 'it is per card');
  const url = `https://clusters.soleilpictures.com/api/email-card/${BOARD}/${encodeURIComponent(CARD)}?s=${card}`;
  assert.match(url, CARD_URL_SHAPE);
});

// ── Cron ────────────────────────────────────────────────────────────────────

const addedForFn = between(cron, 'async function addedFor(', '\n}\n');
const runBlock = (type) => {
  const i = cron.indexOf(`await runType("${type}"`);
  assert.ok(i >= 0, `${type} runType found`);
  const j = cron.indexOf('await runType(', i + 10);
  return cron.slice(i, j > 0 ? j : undefined);
};

test('cron: board_waiting reads its own board, activate_nudge_1 may move to the newest', () => {
  assert.match(runBlock('board_waiting'), /addedFor\(admin, String\(row\.user_id\), String\(row\.board_id\), false\)/);
  assert.match(runBlock('activate_nudge_1'), /addedFor\(admin, String\(row\.user_id\), row\.board_id \? String\(row\.board_id\) : null, true\)/);
});

test('cron: the added lookup is in a try/catch and the rpc is never .catch()ed', () => {
  assert.match(addedForFn, /^[^]*?\{\s*try \{[^]*\} catch \(e\) \{[^]*\}\s*$/, 'the body is a try/catch');
  assert.ok(addedForFn.includes('admin.rpc("_lifecycle_email_added"'));
  assert.doesNotMatch(cron, /_lifecycle_email_added[^;]*\.catch\(/, 'no .catch( on the rpc builder');
  assert.doesNotMatch(addedForFn, /\.catch\(/);
});

test('cron: activate_nudge_1 takes the board from added, welcome_board never looks', () => {
  const a = runBlock('activate_nudge_1');
  assert.match(a, /const useAdded = !!added\?\.boardId;/);
  assert.match(a, /boardId: useAdded \? added!\.boardId : row\.board_id/);
  assert.doesNotMatch(runBlock('welcome_board'), /addedFor/, 'welcome_board is one fixed note');
});

// ── Templates, rendered for real ────────────────────────────────────────────

const { renderTemplate } = await import('../../../supabase/functions/_shared/email/templates.ts');

const TOKEN = 'a'.repeat(64);
const hex32 = (c) => c.repeat(32);
const cardUrl = (id, s = hex32('a')) => `https://clusters.soleilpictures.com/api/email-card/${BOARD}/${id}?s=${s}`;
const imgs = (html) => html.match(/<img\b/g) ?? [];
const tiles = (html) => html.match(/<td width="25%"/g) ?? [];
const render = (name, data) => renderTemplate(name, { unsubscribeToken: TOKEN, boardName: 'Trip ideas', ...data });

const tripAdded = () => ({
  counts: { image: 2, note: 1 },
  items: [
    { kind: 'image', url: cardUrl('img-1-2'), w: 800, h: 1200 },
    { kind: 'image', url: cardUrl('img-2-3', hex32('b')), w: 1024, h: 576 },
    { kind: 'note', label: 'Packing list' },
  ],
});

test('activate_nudge_1 with things: subject, two sized pictures, a note tile, counts, preheader', () => {
  const r = render('activate_nudge_1', { added: tripAdded() });
  assert.equal(r.subject, `here's "Trip ideas" so far`);
  assert.equal(imgs(r.html).length, 2);
  assert.ok(r.html.includes(cardUrl('img-1-2')));
  assert.ok(r.html.includes(cardUrl('img-2-3', hex32('b'))));
  assert.ok(r.html.includes('width="87" height="130"'), 'tall picture');
  assert.ok(r.html.includes('width="100" height="56"'), 'wide picture');
  assert.ok(r.html.includes('Packing list'));
  assert.ok(r.text.includes(`here's what you've put on "Trip ideas" so far: 2 photos and a note.`));
  assert.ok(r.html.includes('the 3 things you added are saved.'));
});

test('activate_nudge_1 with nothing added (empty, or no lookup at all): the first-picture wording', () => {
  for (const added of [{ counts: {}, items: [] }, undefined]) {
    const r = render('activate_nudge_1', { added });
    assert.equal(r.subject, '"Trip ideas" is ready for its first picture');
    assert.equal(imgs(r.html).length, 0);
  }
});

test('activate_nudge_1: the auto-made names fall back to no-name wording', () => {
  for (const boardName of ['Studio', 'Untitled cluster']) {
    const r = render('activate_nudge_1', { boardName, added: { counts: {}, items: [] } });
    assert.equal(r.subject, 'your board is ready for its first picture', boardName);
    assert.ok(!r.html.includes(boardName), `${boardName} is not quoted back`);
  }
});

test('a foreign or malformed picture URL is never embedded; the tile falls back to text', () => {
  const bad = [
    `https://evil.example/api/email-card/${BOARD}/img-1?s=${hex32('a')}`,
    `http://clusters.soleilpictures.com/api/email-card/${BOARD}/img-2?s=${hex32('a')}`,
    `https://clusters.soleilpictures.com/api/email-card/${BOARD}/img-3?s=${'a'.repeat(31)}`,
  ];
  const r = render('activate_nudge_1', {
    added: { counts: { image: 3 }, items: bad.map((url) => ({ kind: 'image', url, w: 100, h: 100 })) },
  });
  assert.equal(imgs(r.html).length, 0);
  assert.ok(!r.html.includes('evil.example'));
  assert.equal(tiles(r.html).length, 3, 'still three tiles');
  assert.ok(r.html.includes('>photo</div>'), 'the kind word stands in');
});

test('a label with markup or a link is escaped or stripped', () => {
  const r = render('activate_nudge_1', {
    added: {
      counts: { note: 2 },
      items: [
        { kind: 'note', label: '<script>alert(1)</script>' },
        { kind: 'link', label: 'read https://evil.example/phish now' },
      ],
    },
  });
  assert.ok(!/<script/i.test(r.html), 'no script tag');
  assert.ok(!r.html.includes('evil.example'), 'a url in a label is stripped');
});

test('at most four tiles', () => {
  const items = Array.from({ length: 6 }, (_, i) => ({ kind: 'note', label: `n${i}` }));
  const r = render('activate_nudge_1', { added: { counts: { note: 6 }, items } });
  assert.equal(tiles(r.html).length, 4);
  assert.ok(r.text.includes('6 notes'));
});

test('unknown kinds are dropped from counts and items', () => {
  const r = render('activate_nudge_1', {
    added: {
      counts: { grid: 9, constructor: 5, __proto__: 7, note: 1 },
      items: [{ kind: 'grid' }, { kind: 'constructor' }, { kind: '__proto__' }, { kind: 'note', label: 'Kept' }],
    },
  });
  assert.equal(tiles(r.html).length, 1, 'only the note tile');
  assert.ok(r.html.includes('Kept'));
  assert.ok(r.text.includes('so far: a note.'), 'counts hold only the note');
  assert.ok(!r.text.includes('9') && !r.text.includes('grid'));
  // Only unknown kinds: nothing was added, so the first-picture wording.
  const none = render('activate_nudge_1', { added: { counts: { grid: 3 }, items: [{ kind: 'grid' }] } });
  assert.equal(none.subject, '"Trip ideas" is ready for its first picture');
});

test('welcome_board is one note whatever the variant, and still embeds its own thumbnail', () => {
  const thumb = `https://clusters.soleilpictures.com/api/email-thumb/${BOARD}?v=0&s=${hex32('c')}`;
  for (const variant of ['s1.b1', 'c1', 's5.b4', undefined]) {
    const r = render('welcome_board', { variant, thumbUrl: thumb });
    assert.equal(r.subject, 'look what you made', String(variant));
    assert.equal(imgs(r.html).length, 1, `${variant}: the thumbnail`);
  }
  assert.equal(imgs(render('welcome_board', {}).html).length, 0, 'no thumbnail, no image');
});

test('board_waiting: what they had added, in words and tiles; one subject, the B arm is gone', () => {
  const added = {
    counts: { image: 38, note: 4, pdf: 1 },
    items: [
      { kind: 'image', url: cardUrl('img-1-2'), w: 400, h: 300 },
      { kind: 'note', label: 'Ideas' },
    ],
  };
  for (const variant of [undefined, 'c1', 'A', 'B']) {
    const r = render('board_waiting', { variant, added });
    assert.equal(r.subject, '"Trip ideas" is still taking shape', String(variant));
    assert.ok(r.text.includes(`you'd added 38 photos, 4 notes and a PDF.`));
    assert.ok(r.html.includes('the last few:'));
    assert.equal(imgs(r.html).length, 1);
  }
  const bare = render('board_waiting', {});
  assert.ok(!bare.text.includes(`you'd added`));
  assert.ok(!bare.html.includes(`you&#39;d added`) && !bare.html.includes(`you'd added`));
});

test('counts read as a phrase: singular, and ties keep the fixed kind order', () => {
  const one = render('board_waiting', { added: { counts: { image: 1 }, items: [] } });
  assert.ok(one.text.includes(`you'd added a photo.`));
  const tie = render('board_waiting', { added: { counts: { audio: 2, image: 2 }, items: [] } });
  assert.ok(tie.text.includes('2 photos and 2 audio files'));
});

test('activate_nudge_2 still renders through the factorial path', () => {
  const r = render('activate_nudge_2', { variant: 's1.b1' });
  assert.equal(typeof r.subject, 'string');
  assert.ok(r.subject.length > 0);
  assert.ok(r.html.length > 0);
});
