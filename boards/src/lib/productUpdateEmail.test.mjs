// productUpdateEmail.test.mjs — 0506's product_update: the release note to
// everyone, once per edition. Nothing in it has been applied or sent; this
// pins the shape the owner will be asked to switch on.
//
//   node --test src/lib/productUpdateEmail.test.mjs
//
// What this guards:
//   * the 0311 habit: the eligibility RPC is the cron's alone, and the file
//     proves it;
//   * the audience: every whats_new filter except dormancy, so consent,
//     deliverability, the team, banned accounts, the edition and the 3-day gap
//     are all still asked;
//   * the waves and the daily cap;
//   * the cron reads the edition before it calls the RPC, so a deploy that
//     lands before the migration sends nothing;
//   * the sender: hello@, a one-click unsubscribe that turns off email_lifecycle,
//     and the 'lifecycle' category the sunset counts;
//   * the template: every word from the edition, escaped, with a CTA that never
//     leaves the app's origin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, latestDefinition } from './migrationText.mjs';

const FILE = '0506_product_update_email.sql';
const sql = readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8');
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const cron = read('../../../supabase/functions/lifecycle-email-cron/index.ts');
const sender = read('../../../supabase/functions/send-transactional-email/index.ts');
const templatesSrc = read('../../../supabase/functions/_shared/email/templates.ts');

const due = () => {
  const d = latestDefinition('lifecycle_due_product_update');
  assert.ok(d, 'lifecycle_due_product_update is defined');
  assert.equal(d.file, FILE, 'no later migration redefines it');
  return d.body;
};
const oneLine = (s) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');

// ── The migration ───────────────────────────────────────────────────────────

test('the CHECK keeps every live type and admits product_update', () => {
  const m = sql.match(/add constraint lifecycle_email_log_email_type_check\s+check \(email_type in \(([\s\S]*?)\)\);/);
  assert.ok(m, 'the CHECK is restated');
  const types = [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]).sort();
  assert.deepEqual(types, ['activate_nudge_1', 'activate_nudge_2', 'board_waiting', 'nudge_dormant_early',
    'product_update', 'reengage_1', 'welcome_board', 'whats_new']);
  assert.match(sql, /drop constraint if exists lifecycle_email_log_email_type_check;/);
});

test('one send per user per edition, whatever the row became', () => {
  assert.match(sql, /create unique index if not exists lifecycle_email_log_product_update_version_idx\s+on public\.lifecycle_email_log \(user_id, email_type, content_version\)\s+where email_type = 'product_update';/);
  const b = oneLine(due());
  assert.match(b, /not exists \(select 1 from public\.lifecycle_email_log l where l\.user_id = u\.id and l\.email_type = 'product_update' and l\.content_version is not distinct from ed\.version\)/);
  assert.doesNotMatch(b.match(/l\.email_type = 'product_update' and l\.content_version[^)]*\)/)[0], /status/, 'any status counts as taken');
});

test('the edition is seeded off, versionless and empty, with no copy in the file', () => {
  const seed = sql.match(/insert into public\.app_config \(key, value\)\s+values \('lifecycle_product_update', jsonb_build_object\(([\s\S]*?)\)\)\s+on conflict \(key\) do nothing;/);
  assert.ok(seed, 'seeded once, never overwriting an authored edition');
  const v = seed[1];
  assert.match(v, /'enabled',\s+false/);
  assert.match(v, /'version',\s+null/);
  assert.match(v, /'items',\s+'\[\]'::jsonb/);
  assert.match(v, /'wave',\s+1/);
  for (const k of ['subject', 'preheader', 'greeting', 'intro', 'outro', 'signoff', 'cta_label']) {
    assert.match(v, new RegExp(`'${k}',\\s+''`), `${k} is empty`);
  }
});

test('the RPC returns exactly the row whats_new returns, as definer with a pinned path', () => {
  const head = (fn) => {
    const m = latestDefinition(fn).body.match(/returns table\s*\(([\s\S]*?)\)\s*\n?\s*language/i);
    assert.ok(m, `${fn} returns a table`);
    return m[1].replace(/\s+/g, ' ').replace(/timestamp with time zone/g, 'timestamptz').trim()
      .split(',').map((c) => c.trim().split(' ')[0]);
  };
  assert.deepEqual(head('lifecycle_due_product_update'), head('lifecycle_due_whats_new'));
  const b = due();
  assert.match(b, /security definer\s+set search_path = public/);
  assert.match(b, /function public\.lifecycle_due_product_update\(p_hour int default null\)/);
  assert.match(cron, /admin\.rpc\(rpcName, \{ p_hour: hour \}\)/, 'the cron passes p_hour alone');
});

test('the audience is every whats_new filter except dormancy', () => {
  const b = oneLine(due());
  // Off unless the edition is on, versioned and has items.
  assert.match(b, /where ed\.enabled and ed\.version is not null and ed\.has_items/);
  assert.match(b, /jsonb_typeof\(c\.value->'items'\) = 'array' and jsonb_array_length\(c\.value->'items'\) > 0 as has_items/);
  assert.match(b, /nullif\(btrim\(c\.value->>'version'\), ''\) as version/);
  // whats_new's own filters.
  const whatsNew = oneLine(latestDefinition('lifecycle_due_whats_new').body);
  for (const f of [
    "u.email_confirmed_at is not null and u.email is not null",
    "p.tier in ('demo','paid')",
    'p.banned_at is null',
    "public._email_pref_enabled(u.id, 'email_lifecycle')",
    'public._email_deliverable(u.id)',
    'coalesce(p.preferred_send_hour, extract(hour from coalesce(p.activated_access_at, u.created_at))::int) = p_hour',
  ]) {
    assert.ok(whatsNew.includes(f), `whats_new asks: ${f}`);
    assert.ok(b.includes(f), `product_update asks: ${f}`);
  }
  assert.match(b, /u\.id not in \(select iu\.user_id from public\._internal_user_ids\(\) iu\)/, 'never the team');
  assert.match(b, /public\.lifecycle_type_enabled\('product_update'\)/);
  assert.match(b, /not exists \(select 1 from public\.lifecycle_email_log l2 where l2\.user_id = u\.id and l2\.sent_at > now\(\) - interval '3 days'\)/);
  // The one filter it drops.
  assert.match(whatsNew, /coalesce\(pr\.last_seen_at, u\.created_at\) < now\(\) - make_interval\(days => p_dormant_days\)/);
  assert.doesNotMatch(b, /dormant|last_seen_at, u\.created_at\) </, 'no dormancy test');
  assert.match(b, /order by coalesce\(pr\.last_seen_at, u\.created_at\) desc/, 'most recently active first');
  // The claim still asks the sunset and the one-a-day index stands.
  assert.match(latestDefinition('lifecycle_claim_send').body, /public\._email_engaged\(p_user_id\)/);
});

test('wave 1 is people who read our mail in 60 days or used the app in 30; wave 2 or none is everyone', () => {
  const b = oneLine(due());
  assert.match(b, /case when c\.value->>'wave' ~ '\^\\s\*\\d\{1,6\}\\s\*\$' then btrim\(c\.value->>'wave'\)::int else 2 end as wave/,
    'an absent or malformed wave is wave 2');
  assert.match(b, /and \(ed\.wave >= 2 or coalesce\(pr\.last_seen_at, u\.created_at\) > now\(\) - interval '30 days' or exists \(select 1 from public\.email_sends es where es\.user_id = u\.id and \(es\.opened_at > now\(\) - interval '60 days' or es\.clicked_at > now\(\) - interval '60 days'\)\)\)/);
});

test('the daily cap defaults to 300 and counts only today’s claimed and sent rows, never below zero', () => {
  const b = oneLine(due());
  assert.match(b, /case when c\.value->>'daily_cap' ~ '\^\\s\*\\d\{1,6\}\\s\*\$' then btrim\(c\.value->>'daily_cap'\)::int else 300 end as daily_cap/);
  assert.match(b, /greatest\(0, \(select daily_cap from ed\) - \(select count\(\*\)::int from public\.lifecycle_email_log where email_type = 'product_update' and status in \('claimed', 'sent'\) and sent_on = \(now\(\) at time zone 'utc'\)::date\)\) as slots/);
  assert.match(b, /limit \(select slots from budget\);/);
});

test('0311: only the cron can call it, and the file proves so', () => {
  assert.match(sql, /revoke execute on function public\.lifecycle_due_product_update\(int\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.lifecycle_due_product_update\(int\) to service_role;/);
  const proof = sql.slice(sql.lastIndexOf('do $$'));
  assert.match(proof, /v_fn constant text := 'public\.lifecycle_due_product_update\(integer\)';/);
  assert.match(proof, /if has_function_privilege\('anon', v_fn, 'execute'\) then\s+raise exception/);
  assert.match(proof, /if has_function_privilege\('authenticated', v_fn, 'execute'\) then\s+raise exception/);
  assert.match(proof, /if not has_function_privilege\('service_role', v_fn, 'execute'\) then\s+raise exception/);
  assert.match(proof, /p\.proname = 'lifecycle_due_product_update'\) <> 1 then\s+raise exception/, 'no overload');
  assert.match(proof, /end \$\$;\s*$/);
});

// ── The cron ────────────────────────────────────────────────────────────────

test('the cron reads the edition first and never calls the RPC when it is off', () => {
  const at = cron.indexOf('const update = await productUpdateConfig(admin);');
  assert.ok(at > 0, 'the batch path reads the edition');
  const gate = cron.slice(at, cron.indexOf('// whats_new is the broadest dormant gate'));
  assert.match(gate, /if \(update\) \{\s+await runType\("product_update", "lifecycle_due_product_update"/);
  assert.match(gate, /\} else \{\s+summary\["product_update"\] = \{[^}]*note: "no published edition" \};/);
  assert.equal((cron.match(/lifecycle_due_product_update/g) || []).length, 1, 'the RPC is named once, inside the gate');

  const reader = cron.slice(cron.indexOf('async function productUpdateConfig'), cron.indexOf('async function sendOne'));
  assert.match(reader, /\.eq\("key", "lifecycle_product_update"\)\.maybeSingle\(\)/);
  assert.match(reader, /if \(!v\) return null;/);
  assert.match(reader, /if \(!ignoreEnabled && v\.enabled !== true\) return null;/);
  assert.match(reader, /if \(!version \|\| !items\.length \|\| !subject\) return null;/);
  // Never a .catch() on a builder (CLAUDE.md): the error is read off the result.
  assert.doesNotMatch(reader, /\.catch\(/);
});

test('it runs after the welcome and before every win-back', () => {
  const order = [...cron.matchAll(/runType\("([a-z0-9_]+)"/g)].map((m) => m[1]);
  assert.equal(order[0], 'welcome_board');
  assert.equal(order[1], 'product_update');
});

test('each send carries the edition’s version and a single variant, with no experiment entry needed', () => {
  // pickVariant on a type with no lifecycle_email_experiments entry: weightedPick
  // of undefined is "", so the fallback "A" is the answer every time.
  const pick = cron.match(/function weightedPick\(weights: any\): string \{([\s\S]*?)\n\}/)?.[1];
  const pv = cron.match(/function pickVariant\(cfg: any, emailType: string\): string \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(pick && pv);
  const weightedPick = new Function('weights', pick);
  const pickVariant = new Function('weightedPick', `return function (cfg, emailType) {${pv}}`)(weightedPick);
  for (const cfg of [{}, null, { whats_new: { weights: { A: 50, B: 50 } } }]) {
    assert.equal(pickVariant(cfg, 'product_update'), 'A');
  }
  // The claim's holdout reads the same absent entry as no holdout.
  assert.match(latestDefinition('lifecycle_claim_send').body, /if v_raw ~ '\^\\d\{1,3\}\$' then/);
  // The version the claim records is the row's, from the RPC.
  assert.match(cron, /p_content_version: contentVersion,/);
  assert.match(cron, /version: row\.content_version != null \? String\(row\.content_version\) : update\.version,/);
});

test('a test send renders the authored edition even while it is switched off', () => {
  const t = cron.slice(cron.indexOf('if (reqBody && reqBody.testTo)'), cron.indexOf('const admin = createClient'));
  assert.match(t, /if \(type === "product_update"\) \{[\s\S]*?productUpdateConfig\(previewDb, \/\* ignoreEnabled \*\/ true\)/);
  assert.match(t, /\.\.\.\(updatePreview \? updatePreview\.copy : \{\}\),/);
});

// ── The sender ──────────────────────────────────────────────────────────────

test('it sends from hello@, with a one-click unsubscribe from email_lifecycle, as lifecycle mail', () => {
  const sw = sender.match(/function fromAddress\(template: string\): string \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(sw, /case "product_update":\s+return FROM_HELLO;/);
  assert.match(sender, /const FROM_HELLO\s+= "Clusters <hello@clusters\.soleilpictures\.com>";/);
  const list = sender.match(/const LIST_UNSUB_TEMPLATES = new Set\(\[([^\]]*)\]\)/)?.[1] || '';
  assert.match(list, /"product_update"/);
  const keys = sender.match(/const UNSUB_KEY_BY_TEMPLATE[^{]*\{([\s\S]*?)\};/)?.[1] || '';
  assert.doesNotMatch(keys, /product_update/, 'no override, so the key is the email_lifecycle default');
  assert.match(sender, /UNSUB_KEY_BY_TEMPLATE\[template\] \?\? "email_lifecycle"/);
  const re = new RegExp(sender.match(/if \((\/\^activate_[^/]*\/)\.test\(template\)\) return "lifecycle";/)[1].slice(1, -1));
  assert.ok(re.test('product_update'), "emailCategory says 'lifecycle', which the sunset counts");
  assert.ok(!re.test('product_update_x'));
});

// ── The template ────────────────────────────────────────────────────────────

const EDITION = {
  subject: 'a <new> look & more',
  preheader: 'what <changed>',
  greeting: 'hey, the clusters team here.',
  intro: 'here is <b>what</b> shipped:',
  items: ['one <script>alert(1)</script>', { lead: 'Files <x>', text: 'any "file" & more' }, '', null, 7,
    'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
  ctaLabel: 'take a <look>',
  ctaPath: '/changelog#oct',
  outro: 'tell us what you think.',
  signoff: 'talk soon, the clusters team',
  version: '2026-10',
  unsubscribeToken: 'a'.repeat(64),
  resumeToken: 'b'.repeat(64),
  workspaceId: 'w1',
};

test('it is a named template wired through renderTemplate', () => {
  assert.match(templatesSrc, /\| "product_update"\n/);
  assert.match(templatesSrc, /\n  "product_update",\n/);
  assert.match(templatesSrc, /case "product_update": \{/);
});

test('every config string is escaped, items cap at 8, and both parts carry the words and the footer', async () => {
  const { renderTemplate } = await import('../../../supabase/functions/_shared/email/templates.ts');
  const { POSTAL_ADDRESS } = await import('../../../supabase/functions/_shared/email/layout.ts');
  const r = renderTemplate('product_update', EDITION);
  assert.equal(r.subject, 'a <new> look & more', 'the subject is a header, not HTML');
  for (const raw of ['<new>', '<changed>', '<b>what</b>', '<script>', 'Files <x>', '<look>', '"file"']) {
    assert.ok(!r.html.includes(raw), `escaped in the HTML: ${raw}`);
  }
  assert.match(r.html, /<span class="preheader">what &lt;changed&gt;<\/span>/);
  assert.match(r.html, /one &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(r.html, /<strong style="font-weight:600;">Files &lt;x&gt;<\/strong> any &quot;file&quot; &amp; more/);
  assert.equal((r.html.match(/&middot;<\/span>/g) || []).length, 8, 'at most 8 items, empty ones dropped');
  assert.match(r.text, /^hey, the clusters team here\.\n\nhere is <b>what<\/b> shipped:\n\n· one <script>/);
  assert.match(r.text, /\n· Files <x> any "file" & more\n/, 'the lead is plain text in the text part');
  assert.equal((r.text.match(/^· /gm) || []).length, 8);
  assert.match(r.text, /\n\ntalk soon, the clusters team\n\n/);
  for (const part of [r.html, r.text]) {
    assert.ok(part.includes(POSTAL_ADDRESS), 'the postal address');
    assert.match(part, /https:\/\/clusters\.soleilpictures\.com\/api\/unsubscribe\?u=a{64}&(amp;)?k=email_lifecycle/);
  }
});

test('the CTA is tagged, stays on the app’s origin, and an off-origin path falls back to /', async () => {
  const { renderTemplate, productUpdatePath } = await import('../../../supabase/functions/_shared/email/templates.ts');
  const r = renderTemplate('product_update', EDITION);
  assert.match(r.text, /take a <look>: https:\/\/clusters\.soleilpictures\.com\/changelog\?utm_source=email&utm_medium=lifecycle&utm_campaign=product_update&lc=product_update\.2026-10#oct\n/);
  assert.match(r.html, /href="https:\/\/clusters\.soleilpictures\.com\/changelog\?utm_source=email&amp;utm_medium=lifecycle&amp;utm_campaign=product_update&amp;lc=product_update\.2026-10#oct"/);

  for (const bad of ['https://evil.example/', '//evil.example', '/\\evil.example', 'javascript:alert(1)', 'changelog',
    '/a b', '/x?y=1', ' /\n/evil', '', null, undefined, '/%2F%2Fevil']) {
    assert.equal(productUpdatePath(bad), '/', `refused: ${JSON.stringify(bad)}`);
  }
  for (const ok of ['/', '/changelog', '/docs/clusters/sidebar', '/changelog#oct-21']) assert.equal(productUpdatePath(ok), ok);

  // '/' takes the signed-in /resume link onto their cluster, like every lifecycle CTA.
  const home = renderTemplate('product_update', { ...EDITION, ctaPath: '//evil.example' });
  assert.match(home.text, /: https:\/\/clusters\.soleilpictures\.com\/resume\?rt=b{64}&w=w1&utm_source=email&utm_medium=lifecycle&utm_campaign=product_update&lc=product_update\.2026-10\n/);
  assert.doesNotMatch(home.html + home.text, /evil/);
});

test('an edition can carry one screenshot from the app’s /email/ folder, under the intro, opening what the button opens', async () => {
  const { renderTemplate } = await import('../../../supabase/functions/_shared/email/templates.ts');
  const shot = 'https://clusters.soleilpictures.com/email/2026-10-22-new-look.jpg';
  const r = renderTemplate('product_update', { ...EDITION, imageUrl: shot, imageAlt: 'The new <look>' });
  const img = r.html.match(/<a href="([^"]+)"[^>]*><img src="([^"]+)" alt="([^"]*)"/);
  assert.ok(img, 'one linked picture');
  assert.equal(img[2], shot);
  assert.equal(img[3], 'The new &lt;look&gt;', 'its alt is escaped');
  const cta = r.text.match(/take a <look>: (\S+)\n/)[1];
  assert.equal(img[1], cta.replace(/&/g, '&amp;'), 'the picture opens what the button opens');
  const at = (s) => r.html.indexOf(s);
  assert.ok(at('shipped:') < at(shot) && at(shot) < at('&middot;</span>'), 'the intro, then the picture, then the list');
  assert.ok(!r.text.includes(shot), 'the text part has no picture');
  for (const bad of ['https://evil.example/email/x.jpg', 'https://clusters.soleilpictures.com/api/x.jpg',
    'http://clusters.soleilpictures.com/email/x.jpg', '', null]) {
    assert.doesNotMatch(renderTemplate('product_update', { ...EDITION, imageUrl: bad }).html, /<img /,
      `no picture for ${JSON.stringify(bad)}`);
  }
  assert.doesNotMatch(renderTemplate('product_update', EDITION).html, /<img /, 'no image_path, no picture');
});

test('the cron hands over an edition’s image_path only from /email/, as whats_new does', () => {
  assert.match(cron, /imageUrl: imagePath\.startsWith\("\/email\/"\) \? `\$\{SITE_ORIGIN\}\$\{imagePath\}` : undefined,/);
  assert.match(cron, /imageAlt: v\.image_alt,/);
});

test('no subject, no email; and nothing about the product is written in the template', async () => {
  const { renderTemplate } = await import('../../../supabase/functions/_shared/email/templates.ts');
  assert.throws(() => renderTemplate('product_update', { ...EDITION, subject: ' \n ' }), /needs a subject/);
  // A bare edition: only what was authored, plus the footer.
  const bare = renderTemplate('product_update', { subject: 's', items: ['x'], version: 'v', unsubscribeToken: 'a'.repeat(64) });
  assert.match(bare.text, /^· x\n\nSoleil Pictures/);
  const fn = templatesSrc.slice(templatesSrc.indexOf('function productUpdate(d'), templatesSrc.indexOf('// ── share_activity'));
  assert.doesNotMatch(fn, /noteP\("|SIGNOFF|"hey|"talk soon/, 'every paragraph is the edition’s');
  // Newlines never reach a header or a line of the text part.
  const nl = renderTemplate('product_update', { ...EDITION, subject: 'a\r\nBcc: x@example.com' });
  assert.doesNotMatch(nl.subject, /[\r\n]/);
});
