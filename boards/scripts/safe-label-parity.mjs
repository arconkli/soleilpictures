#!/usr/bin/env node
// safeLabel parity: the two copies of the name scrubber, row by row.
//
// safeLabel.mjs (supabase/functions/_shared/email/, the emails) and
// public._safe_label (supabase/migrations/0881_safe_label_any_script.sql, the
// signed-out previews) must give the same answer for every name. This runs
// both on the rows below, against a LOCAL Postgres, and prints every row where
// they differ. Opt-in, not part of npm test; it needs psql (17 or later) on
// PATH, or PSQL=/path/to/psql, and no other dependency.
//
// A scratch database (never the shared one: the script takes only a
// postgres:// or postgresql:// URL whose host is localhost, 127.0.0.1 or
// [::1], with no query part, refuses the key=value form, and drops the PG*
// environment variables that could send psql elsewhere), with the three
// Supabase roles 0881's revokes name:
//
//   initdb -D /tmp/pg -A trust -U postgres --encoding=UTF8 \
//     --locale-provider=icu --icu-locale=en-US --locale=en_US.UTF-8
//   pg_ctl -D /tmp/pg -o "-p 54331 -k '' -c listen_addresses=localhost" -w start
//   psql postgresql://postgres@localhost:54331/postgres \
//     -c 'create role anon nologin; create role authenticated nologin; create role service_role nologin' \
//     -c 'create database icu' \
//     -c "create database c template template0 locale_provider libc lc_collate 'C' lc_ctype 'C'"
//
// Then, from boards/:
//
//   node scripts/safe-label-parity.mjs sizes
//       every statement and "-- part N" group of 0881, in characters (the
//       release applies each part with one apply_migration call, under 4,500)
//   node scripts/safe-label-parity.mjs apply <url>
//       applies 0881 part by part, in file order, as the release does
//       (full-line "--" comments outside dollar-quoted bodies dropped)
//   node scripts/safe-label-parity.mjs probe <url> [--collate-c] [--show]
//       JS against SQL on every row; --collate-c passes every value
//       collate "C"; --show prints each row's JS answer. "diffs" must be 0.
//       "cutdiffs" are rows longer than the limit where the two cut
//       differently: SQL cuts by code point, the email path by grapheme
//       (documented in 0881); they are listed, not failed.
//   node scripts/safe-label-parity.mjs time <url>
//       the first call on a fresh connection (the regex compile) for a few
//       kinds of name, and warm calls on long inputs, in ms
//
// <url> is a libpq connection URL, e.g.
// postgresql://postgres@localhost:54331/icu. Exit status 1 on any diff.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { IDN_TLDS } from '../../supabase/functions/_shared/email/idnTlds.mjs';
import { safeLabel } from '../../supabase/functions/_shared/email/safeLabel.mjs';

const MIGRATION = fileURLToPath(new URL('../../supabase/migrations/0881_safe_label_any_script.sql', import.meta.url));
const FIXTURE = fileURLToPath(new URL('../src/lib/safeLabelAsciiFixture.json', import.meta.url));
const PSQL = process.env.PSQL || 'psql';

/** Top-level statements of `sql`, each { text, part }, full-line comments outside bodies dropped. */
export function statements(sql) {
  const out = [];
  let cur = '', part = 0, partOfCur = null, dollar = null, quote = false;
  for (const line of sql.split('\n')) {
    if (!dollar && !quote) {
      const m = line.match(/^\s*--\s*part\s+(\d+)\s*$/);
      if (m) { part = Number(m[1]); continue; }
      if (/^\s*--/.test(line)) continue;
    }
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (dollar) {
        if (line.startsWith(dollar, i)) { cur += dollar; i += dollar.length - 1; dollar = null; } else cur += ch;
        continue;
      }
      if (quote) { cur += ch; if (ch === "'") quote = false; continue; }
      if (ch === '-' && line[i + 1] === '-') break;
      if (ch === "'") { quote = true; cur += ch; continue; }
      if (ch === '$') {
        const t = line.slice(i).match(/^\$[A-Za-z_]*\$/);
        if (t) { dollar = t[0]; cur += dollar; i += dollar.length - 1; continue; }
      }
      if (partOfCur === null && ch.trim()) partOfCur = part;
      if (ch === ';') { out.push({ text: (cur + ';').trim(), part: partOfCur }); cur = ''; partOfCur = null; continue; }
      cur += ch;
    }
    cur += '\n';
  }
  if (cur.trim()) throw new Error('text after the last statement: ' + cur.trim().slice(0, 80));
  return out;
}

/** The "-- part N" groups, each { n, text }, in file order. */
export function parts(sql) {
  const groups = new Map();
  for (const s of statements(sql)) {
    if (!s.part) throw new Error('a statement outside any part: ' + s.text.slice(0, 80));
    if (!groups.has(s.part)) groups.set(s.part, []);
    groups.get(s.part).push(s.text);
  }
  return [...groups.entries()].map(([n, ts]) => ({ n, text: ts.join('\n\n') + '\n' }));
}

/**
 * `url` if it can only reach a local Postgres, else throws. Only a
 * postgres:// or postgresql:// URL with host localhost, 127.0.0.1 or [::1]
 * passes: libpq honours ?host= and ?hostaddr= in a URL's query, and the
 * key=value form names any host it likes, so a query part, a fragment, a
 * second host, a second "@" and the key=value form are all refused.
 */
export function localUrl(url) {
  if (!url) throw new Error('give a connection URL, e.g. postgresql://postgres@localhost:54331/icu');
  const refuse = (why) => { throw new Error('refusing ' + JSON.stringify(url) + ': ' + why + '; this script only talks to a local scratch Postgres'); };
  if (!/^postgres(?:ql)?:\/\//.test(url)) refuse('not a postgres:// or postgresql:// URL');
  if (/[?#\s]/.test(url)) refuse('a query part, a fragment or a space');
  // libpq ends the user name at the first "@", the URL parser at the last.
  if ((url.match(/@/g) || []).length > 1) refuse('more than one "@"');
  let u;
  try { u = new URL(url); } catch { refuse('not a URL'); }
  if (u.search || u.hash) refuse('a query part or a fragment');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) refuse('host ' + JSON.stringify(u.hostname));
  return url;
}
// psql without the environment variables that could point it at another
// server or service (PGHOSTADDR overrides the URL's host name).
const PSQL_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^PG/.test(k) || k === 'PGPASSWORD'));
const psql = (url, input, extra = []) => execFileSync(PSQL, [url, '-X', '-v', 'ON_ERROR_STOP=1', ...extra], { input, maxBuffer: 1e9, env: PSQL_ENV }).toString();

// ── Rows: [label, input, max, fallback] ─────────────────────────────────────
const cpx = (...c) => String.fromCodePoint(...c);
const cp = cpx;
const ZWNJ = cpx(0x200c), ZWJ = cpx(0x200d), VS16 = cpx(0xfe0f), D = cpx(0x3002);
const rows = [];
// inviteAbuse.test.mjs, 'safeLabel takes the link out, whatever it is wearing'.
const cases = [
  'Approved for a payout. Log in- https://calendar.app.google/am9NAGPQx3hQwC2s9',
  'visit calendar.app.google/xyz now',
  'ｗｗｗ．ｓｃａｍ．ｃｏｍ big prize',
  'prize at scam。com today',
  'prize at scam․com today',
  'win at bit.ly/abc',
  'яндекс.рф деньги',
  'HTTP://SHOUTING.EXAMPLE/x',
];
cases.forEach((c, i) => rows.push(['block-case' + i, c, 60, 'a cluster']));

// Earlier rounds.
rows.push(['leadin','Approved for a payout. Log in- https://x.example/y',60,'']);
for (const s of ['Storyboard v2.0',"Mr. Smith's lookbook",'Spring shoot — day 2','Line one\r\nBcc: someone']) rows.push(['keep',s,60,'']);
rows.push(['long200','x'.repeat(200),60,'']);
rows.push(['onlylink','https://only-a-link.example/path',60,'a cluster']);
const lure='calendar.app.google/am9NAGPQx3hQwC2s9';
for (const c of [0x200b,0x200c,0x200d,0x2060,0xfeff,0xad,0x34f,0x202e,0x2066,0xe0020,0xfe0f]) {
  rows.push(['inv-before-'+c.toString(16),'Prize '+lure.replaceAll('.',cpx(c)+'.'),60,'a cluster']);
  rows.push(['inv-after-'+c.toString(16),'Prize '+lure.replaceAll('.','.'+cpx(c)),60,'a cluster']);
}
const keep=[
 ['Persian ZWNJ',cpx(0x645,0x6cc)+ZWNJ+cpx(0x62e,0x648,0x627,0x647,0x645)],
 ['Persian title',cpx(0x67e,0x631,0x648,0x698,0x647)+ZWNJ+cpx(0x647,0x627)],
 ['Hindi ZWJ',cpx(0x915,0x94d)+ZWJ+cpx(0x937)],['Hindi ZWNJ',cpx(0x915,0x94d)+ZWNJ+cpx(0x937)],
 ['Bengali',cpx(0x9b0,0x9cd)+ZWJ+cpx(0x9af)],['Malayalam',cpx(0xd28,0xd4d)+ZWJ],
 ['family',cpx(0x1f468)+ZWJ+cpx(0x1f469)+ZWJ+cpx(0x1f467)+' Family'],
 ['rainbow',cpx(0x1f3f3)+VS16+ZWJ+cpx(0x1f308)+' Pride shoot'],
 ['skin',cpx(0x1f469,0x1f3fd)+ZWJ+cpx(0x1f3a8)+' Artists'],
 ['heart',cpx(0x2764)+VS16+' Love'],['keycap','1'+VS16+cpx(0x20e3)+' First'],
 ['JA sentence',cpx(0x64ae,0x5f71,0x306f,0x7d42,0x4e86,0x3002,0x6b21,0x306f,0x5927,0x962a)],
 ['JA+Latin',cpx(0x64ae,0x5f71,0x7d42,0x4e86,0x3002)+'Netflix'+cpx(0x3067,0x914d,0x4fe1)],
 ['JA+OK',cpx(0x4eca,0x65e5,0x306f,0x6674,0x308c,0x3002)+'OK!'],['ZH',cpx(0x7b2c,0x4e00,0x573a,0x3002,0x7b2c,0x4e8c,0x573a)]];
for (const [n,s] of keep) rows.push(['KEEP '+n,s,60,'']);
const dot=cpx(0x3002);
const blk=[
 ['ZWJ in Latin domain','pay'+ZWJ+'pal.com login'],['ideo dot','Prize paypal'+dot+'com'],['upper','Prize PAYPAL'+dot+'COM'],
 ['halfwidth','Prize paypal'+cpx(0xff61)+'com/x'],['two dots','Prize mail'+dot+'google'+dot+'com/x'],
 ['CJK label',cpx(0x8cde,0x54c1)+' '+cpx(0x8a50,0x6b3a)+dot+'com'],
 ['Cyrillic IDN',cpx(0x41f,0x440,0x438,0x437)+' '+cpx(0x44f,0x43d,0x434,0x435,0x43a,0x441)+dot+cpx(0x440,0x444)],
 ['Arabic ZWNJ','Prize '+cpx(0x67e,0x6cc)+ZWNJ+cpx(0x67e,0x627,0x644)+'.com'],
 ['Indic IDN','Prize '+cpx(0x928,0x92e,0x938,0x94d,0x924,0x947)+'.'+cpx(0x92d,0x93e,0x930,0x924)],
 ['ends',ZWJ+'Lost Time'+ZWNJ],['space',  'Lost '+ZWNJ+'Time'],['dot','Prize '+cpx(0x645)+ZWNJ+'.com'],
 ['virama','Prize '+cpx(0x915,0x94d)+ZWJ+'.com'],['double','ab'+ZWJ+ZWJ+'cd'],['latinZWJ','Lost'+ZWJ+'Time'],['latinVS','Lost'+VS16+'Time']];
for (const [n,s] of blk) rows.push(['BLOCK '+n,s,60,'']);
// New rows (look-alike dot rule, marks after the dot).
for (const d of [0x3002,0x2027,0x2e33,0x22c5,0x2219,0xff61,0x2024,0xfe52,0xb7,0x30fb]) { rows.push(['DOT '+d.toString(16),'Prize paypal'+cpx(d)+'com',60,'']); rows.push(['DOT path '+d.toString(16),'Prize paypal'+cpx(d)+'com/x y',60,'']); }
const nw=[
 ['mark after .','Prize paypal.'+cpx(0x64b)+'com'],['mark after ideo','Prize paypal'+dot+cpx(0x64b)+'com'],['mark after ideo 2','Prize paypal'+dot+cpx(0x301,0x64b)+'com x'],
 ['paypal.zhongguo','Prize paypal'+dot+cpx(0x4e2d,0x56fd)],['guge.COM','Prize '+cpx(0x8c37,0x6b4c)+dot+'COM'],['verm','Prize example'+dot+'verm'+cpx(0xf6)+'gensberater'],
 ['verm upper','Prize example'+dot+'VERM'+cpx(0xd6)+'GENSBERATER'],
 ['kom','Prize x'+dot+cpx(0x30b3,0x30e0)],['datkeom','Prize x'+dot+cpx(0xb2f7,0xcef4)],['shangcheng sp','Prize x'+dot+cpx(0x5546,0x57ce)+' now'],
 ['ru','Prize x'+dot+cpx(0x440,0x444)],['el','Prize x'+dot+cpx(0x3b5,0x3bb)],['misr','Prize x'+dot+cpx(0x645,0x635,0x631)],['thai','Prize x'+dot+cpx(0xe44,0xe17,0xe22)],['bharat','Prize x'+dot+cpx(0x92d,0x93e,0x930,0x924)],
 ['JA two sentences',cpx(0x4eca,0x65e5,0x306f,0x6674,0x308c,0x3002,0x660e,0x65e5,0x306f,0x96e8,0x3002)],['Tokyo.Tokyo-shisha','Tokyo'+dot+cpx(0x6771,0x4eac,0x652f,0x793e)],
 ['Tokyo FP',cpx(0x6771,0x4eac)+dot+'Tokyo'],['catalan','Col'+cpx(0xb7)+'legi'],['katakana sep',cpx(0x30c8,0x30e0,0x30fb,0x30cf,0x30f3,0x30af,0x30b9)],
 ['tld + more',cpx(0x6771,0x4eac)+dot+cpx(0x4e2d,0x56fd,0x4eba)],['unlisted han','Tokyo'+dot+cpx(0x5927,0x962a)],['com1','paypal'+dot+'com1'],
 ['digit before','Prize 123'+dot+'com'],['underscore before','Prize a_'+dot+'com'],['dash before','Prize a-'+dot+'com'],['space before','Prize a '+dot+'com'],
 ['mark before','Prize '+cpx(0x915,0x93f)+dot+'com'],['hangul label','Prize '+cpx(0xc0bc,0xc131)+dot+cpx(0xd55c,0xad6d)],
 ['one letter tld','Prize x'+dot+'c'],['digit tld','Prize x'+dot+'c0m'],['ru+digit','Prize x'+dot+cpx(0x440,0x444)+'2'],
 ['hebrew pointed','Prize '+cpx(0x5e9,0x5c1,0x5b8,0x5dc,0x5d5,0x5b9,0x5dd)+'.'+cpx(0x5e7,0x5d5,0x5dd)],
 ['greek tonos','Prize x'+dot+cpx(0x3b5,0x3bb,0x301)],['thai vowel','Prize x'+dot+cpx(0xe44,0xe17,0xe22,0xe4c)],
 ['jp prose kata',cpx(0x64ae,0x5f71,0x3002,0x30bb,0x30fc,0x30eb,0x4e2d)],['jp prose sale',cpx(0x64ae,0x5f71,0x3002,0x30bb,0x30fc,0x30eb)],
 ['han tld then han',cpx(0x6771,0x4eac)+dot+cpx(0x4e2d,0x56fd)+cpx(0x3067)],
 ['ascii chain','ab'+dot+'cd'+dot+'ef x'],['mixed','Visit shop'+dot+cpx(0x5546,0x5e97)+'/sale now'],
];
for (const [n,s] of nw) rows.push(['NEW '+n,s,60,'']);

// Round 2 (fix2): the design's cases.
const r2keep=["广告片。公司","第1話。クラウド","谷歌。中国","Tokyo。東京支社","撮影は終了。次は大阪","第一场。第二场","撮影終了。Netflixで配信","Paris⋅London","Ana∙Luz","மு.க.ஸ்டாலின்","डॉ.शर्मा","บจก.ซันไชน์","А.С.Пушкин","Ж.-П. Сартр","Mr. Smith","v2.0"];
const r2rm=["〇〇。com","x。com","пример。рф","пример。РФ","x。भारत","paypal。中国","abc。コム","ok。ελ","x.भारत","пример.рф","ПРИМЕР.РФ","paypal.中国","example.com/login","evil.co.uk","shop.vermögensberater","x.рф/путь","J.R.R.Tolkien","paypal.comでログイン","x.com1","x.com_y","x.рфabc","x.Рф","x。Рф","x。ΕΛ","x.ελ1","x.ελ́","x.comé"];
const r2acc=["東京。Tokyo","今日は晴れ。OK!","会议。OK"];
for (const s of r2keep) { rows.push(['R2 keep '+s,s,60,'fb']); rows.push(['R2 keep in '+s,'Prize '+s+' now',60,'fb']); }
for (const s of r2rm) { rows.push(['R2 rm '+s,s,60,'fb']); rows.push(['R2 rm in '+s,'Prize '+s+' now',60,'fb']); }
for (const s of r2acc) rows.push(['R2 acc '+s,s,60,'fb']);
// Every IDN TLD after a Latin label, after a CJK label, after an ASCII dot in upper case, and with a letter after it.
for (const t of IDN_TLDS) {
  rows.push(['R2 tld x。'+t,'Prize x。'+t+' now',60,'fb']);
  rows.push(['R2 tld 東京。'+t,'東京。'+t,60,'fb']);
  rows.push(['R2 tld x.'+t.toUpperCase(),'Prize x.'+t.toUpperCase()+'/p q',60,'fb']);
  rows.push(['R2 tld more x.'+t,'Prize x.'+t+'a',60,'fb']);
}
// Numbers and CJK edges before the dot.
for (const pre of ['〇〇','Ⅻ','½','①','x²','ー','々','ㄱ','가','カ','か','中','a_','a-','é']) for (const t of ['com','中国','コム','рф']) rows.push(['R2 before '+pre+' '+t,pre+'。'+t,60,'fb']);
// Schemes.
for (const s of ['HTTP://x.example/y','ms-settings://abc','Ünicode://x y','1http://x','a+b.c-d://zz']) rows.push(['R2 scheme '+s,'go '+s+' now',60,'fb']);
// Long inputs (the perf inputs), cut to 1000.
for (const [u,n] of [['á',5000],['中',10000],['कि',5000],['a.',5000],['.-',5000],['_',10000],['a。',5000],['1。',5000],['x.рф',2500]]) rows.push(['R2 long '+JSON.stringify(u)+'x'+n,u.repeat(n),60,'fb']);
for (const n of [990,995,996,997,998]) rows.push(['R2 long cut domain '+n,'x'.repeat(n)+'.com',60,'fb']);
rows.push(['R2 long ideo','y'.repeat(997)+'。com',60,'fb']);
const fam=cpx(0x1f468)+ZWJ+cpx(0x1f469)+ZWJ+cpx(0x1f467);
rows.push(['cut-grapheme','x'.repeat(57)+fam+'yyyy',60,'']);
JSON.parse(readFileSync(FIXTURE,'utf8')).forEach((r,i)=>rows.push(['fixture'+i,r[0],r[1],'fb']));

// A reviewer's adversarial rows (lures, real names, parity edges).
const advLure = (l, s) => rows.push(['ADV lure ' + l, s, 60, '']);
const advKeep = (l, s) => rows.push(['ADV ' + l, s, 60, '']);
const advAny = (l, s, max = 60) => rows.push(['ADV ' + l, s, max, '']);
// --- lures
advLure('ZWJ inside Devanagari TLD', 'Prize x.भा' + ZWJ + 'रत');
advLure('ZWNJ inside Devanagari TLD', 'Prize x.भा' + ZWNJ + 'रत');
advLure('ZWNJ inside Arabic TLD', 'Prize x.مص' + ZWNJ + 'ر');
advLure('ZWJ inside Arabic TLD', 'Prize x.عر' + ZWJ + 'ب');
advLure('ZWNJ after virama in Tamil TLD', 'Prize x.சிங்' + ZWNJ + 'கப்பூர்');
advLure('ZWNJ after virama in Hindi TLD', 'Prize x.भारतम्' + ZWNJ);
advLure('ZWJ in TLD via ideo dot', 'Prize x' + D + 'भा' + ZWJ + 'रत');
advLure('ZWNJ after virama before ideo dot', 'Prize पेपाल्' + ZWNJ + D + 'com');
advLure('ZWJ after virama before ideo dot', 'Prize पेपाल्' + ZWJ + D + 'com');
advLure('ZWNJ after virama before ASCII dot', 'Prize पेपाल्' + ZWNJ + '.com');
advLure('Georgian Mtavruli TLD', 'Prize x.ᲒᲔ');
advLure('Georgian TLD ideo', 'Prize x' + D + 'გე');
advLure('Armenian upper', 'Prize x.ՀԱՅ');
advLure('Kazakh upper', 'Prize x' + D + 'ҚАЗ');
advLure('Greek upper ideo', 'Prize x' + D + 'ΕΥ');
advLure('Hebrew TLD', 'Prize x.ישראל');
advLure('Hebrew TLD ideo', 'Prize x' + D + 'קום');
advLure('Urdu TLD', 'Prize x' + D + 'پاکستان');
advLure('Sinhala TLD', 'Prize x.ලංකා');
advLure('Lao TLD', 'Prize x' + D + 'ລາວ');
advLure('Gurmukhi TLD', 'Prize x' + D + 'ਭਾਰਤ');
advLure('Malayalam TLD', 'Prize x.ഭാരതം');
advLure('Bengali TLD then Bengali', 'Prize x.বাংলা এখন');
advLure('fullwidth', 'Prize ｐａｙｐａｌ．ｃｏｍ');
advLure('math bold', 'Prize 𝐩𝐚𝐲𝐩𝐚𝐥.𝐜𝐨𝐦');
advLure('fullwidth stop', 'Prize paypal．com');
advLure('small full stop', 'Prize paypal﹒com');
advLure('one dot leader', 'Prize paypal․com');
advLure('halfwidth ideo stop', 'Prize paypal｡com');
advLure('fw scheme', 'Prize ｈｔｔｐｓ：／／evil');
advLure('scheme upper', 'Prize HTTPS://evil');
advLure('WWW upper', 'Prize WWW.evil');
advLure('mark after ideo dot', 'Prize x' + D + cp(0x301) + 'com');
advLure('mark before ideo dot', 'Prize x' + cp(0x301) + D + 'com');
advLure('Nl before dot', 'Prize ↂ' + D + 'com');
advLure('superscript before dot', 'Prize x²' + D + 'com');
advLure('Cyrillic label ideo COM', 'Prize раураl' + D + 'COM');
advLure('mixed caps IDN', 'Prize x.Рф');
advLure('mixed caps IDN 2', 'Prize x.рФ/login');
advLure('IDN TLD with port', 'Prize x.рф:443/a');
advLure('IDN TLD then punct', 'Prize x.рф, now');
advLure('IDN TLD then emoji', 'Prize x.рф🎉');
advLure('IDN TLD then CJK', 'Prize paypal.中国登录');
advLure('ASCII dot then ideographic', 'Prize paypal' + D + 'comでログイン');
advLure('look-alike then IDN then text', 'Prize x' + D + 'рф/путь');
advLure('two look-alike dots', 'Prize a' + D + 'b' + D + 'рф');
advLure('hyphenation pt IDN', 'Prize x‧中国');
advLure('long prefix lure end', 'a '.repeat(495) + 'x.com');
advLure('long prefix lure end ideo', 'b '.repeat(495) + 'x' + D + 'рф');
advLure('long prefix lure IDN', '中'.repeat(990) + ' x.рф');
advLure('long marks then lure', 'a' + cp(0x301).repeat(900) + ' x.com');
advLure('removed text then lure', 'https://' + 'a'.repeat(900) + ' x' + D + 'com');
advLure('soft hyphen in IDN TLD', 'Prize x.р' + cp(0xad) + 'ф');
advLure('bidi in IDN', 'Prize x.' + cp(0x202e) + 'рф');
advLure('tag char in TLD', 'Prize x.c' + cp(0xe0041) + 'om');
advLure('VS16 in TLD', 'Prize x.c' + cp(0xfe0f) + 'om');
advLure('CGJ in TLD', 'Prize x.c' + cp(0x34f) + 'om');
advLure('Mongolian FVS', 'Prize x.c' + cp(0x180b) + 'om');
advLure('Hangul filler', 'Prize x.c' + cp(0x3164) + 'om');
advLure('underscore label', 'Prize _x' + D + 'com');
advLure('dash label', 'Prize -' + D + 'com');
advLure('emoji label .ws', 'Prize 💰.ws');
advLure('heart domain', 'Prize i❤.ws');
advLure('scheme backslash', 'Prize https:\\\\evil.example');
advLure('Kelvin', 'Prize x.Kim');
advLure('Thai TLD after Thai', 'Prize บริษัท.ไทย');
advLure('IDN Latin TLD upper with dot', 'Prize X' + D + 'VERMÖGENSBERATUNG');
advLure('CJK TLD after kana-like ー? (Latin label)', 'Prize ab-' + D + 'みんな');
advLure('Korean TLD after Latin', 'Prize ab' + D + '한국');
advLure('Korean TLD after digit', 'Prize 1' + D + '한국');
advLure('CJK TLD after 〇 (Nl)', 'Prize 〇' + D + '中国');
advLure('CJK TLD after ㋐ circled kata', 'Prize ㋐' + D + 'コム');
advLure('Arabic label Arabic TLD', 'Prize مثال.موقع');
advLure('Persian label ZWNJ ideo', 'Prize می' + ZWNJ + 'خواهم' + D + 'ایران');

// --- real names and phrases (expect unchanged)
for (const s of [
  'डॉ. शर्मा', 'श्री राम फिल्म्स', 'प्रोजेक्ट नं.1', 'மு.க.ஸ்டாலின் படம்', 'தமிழ் சினிமா 2026', 'বাংলা ছবি', 'ড.মুহাম্মদ ইউনূস',
  'บจก.ซันไชน์', 'ภาพยนตร์ไทย', 'ສະບາຍດີ', 'ខ្មែរ ភាពយន្ត', 'မြန်မာ ရုပ်ရှင်', 'شركة الأفلام', 'د.أحمد', 'فیلم‌های ایرانی',
  'שלום עולם', 'ד"ר כהן', 'А.С.Пушкин', 'Т.Г.Шевченко', 'ул.Ленина', 'Д.И.Менделеев', 'Ж.-П. Сартр', 'Μ.Χατζιδάκις',
  'Ν.Καζαντζάκης', 'Հ.Թումանյան', 'ა.წერეთელი', 'ኢትዮጵያ ፊልም', 'ዶ/ር አበበ', '张艺谋。导演', '第1話。', '〇〇。', '第2話。クラウド',
  '東京。大阪。', '撮影。終了', '会议。明天', '谷歌。中国', '株式会社。セール', '이야기。한국', '한국。영화', '영화。삼성',
  'Công ty TNHH Ánh Dương', 'Nguyễn Văn A', 'Dr. Smith', 'St. Louis', 'No. 5 Studio', 'v2.0 final', 'Paris⋅London',
  'Ana∙Luz', 'Col·legi', 'トム・ハンクス', '1.5x speed', 'Shot 3.2', '3.14', 'Mr. 中村', 'Room 101。', 'A。B',
  '映画。COMの話', 'ちゃん。ok', '中村。ー', '第1話。中国', '١٢٣.٤٥', 'Ep.١', 'ক.খ.গ', 'ก.ข.ค', 'Ⅻ。Ⅰ', 'α.β.γ',
  'г.Москва', 'Офис г.Москва', 'д.Москва', 'डॉ.भारत कुमार', 'श्री.भारत', 'ড.ভারত', 'தி.இந்தியா', 'ந.இலங்கை', 'ม.ไทย', 'د.عمان',
  'Ул.Укр', 'Π.ΕΛ', 'Q.Thủ Đức', 'P.Thảo Điền', 'Tp.HCM',
]) advKeep('keep ' + s, s);

// --- JS/SQL parity extras
for (const s of ['x' + D + 'com' + cp(0x301), 'x' + D + cp(0x345) + 'ελ', 'x.' + cp(0x345) + 'ελ', 'x.ελ' + cp(0x345), 'x.ΕΛ' + cp(0x345), 'ʰ' + D + 'com',
  'ǅ' + D + 'com', 'ǅ.ǅ', 'x.ǅz', 'ꙮ.com', '𝟙' + D + 'com', '٣' + D + 'com', '٣' + D + 'рф', '꘠' + D + 'com', 'Ⅰ' + D + 'com', 'x.ⅼⅰⅴⅰⅴ',
  '¼' + D + 'com', '①' + D + 'com', '⑴' + D + 'com', '〡' + D + '中国', '𖿡' + D + '中国', '𛀀' + D + 'コム', 'ㇰ' + D + 'コム', 'ꥠ' + D + '한국',
  'ힰ' + D + '한국', '⺀' + D + '中国', '〆' + D + '中国', '〻' + D + '中国', 'ゝ' + D + 'コム', '･' + D + 'com', '〜' + D + 'com', 'ゟ' + D + 'コム',
  '𠀀' + D + '中国', '𪜀' + D + '中国', '𰀀' + D + '中国', '🈀' + D + '中国', '㋿' + D + '中国', '㍿' + D + '中国', 'ｶ' + D + 'コム', 'ﾞ' + D + 'コム',
  'x' + D + '𝐜𝐨𝐦', 'x.Ⓒⓞⓜ', 'x.ꞵ', 'x.İstanbul', 'x.ı', 'Straße.de', 'STRASSE.ẞ', 'x.ſt', 'x.ﬀ', 'ab' + ZWJ + D + 'com', 'xـ' + D + 'com',
  'a'.repeat(999) + '.com', 'a'.repeat(998) + '.рф', 'a'.repeat(997) + D + 'рф', '中'.repeat(997) + D + '中国', '😀'.repeat(999) + 'x.com',
  'x' + D + 'co' + D + 'uk', 'x' + D + 'com' + D, 'x' + D + D + 'com', 'x.' + D + 'com', '.' + D + 'com', 'Ⓐ' + D + 'com', '_' + D + 'com', '-' + D + '-',
  'x' + D + 'คอม', 'x' + D + 'ไทย', 'ก' + D + 'ไทย', 'x' + D + 'संगठन', 'x.ભારત', 'x' + D + 'ଭାରତ', 'x.ಭಾರತ', 'x' + D + 'భారత్', 'x' + D + 'ভাৰত',
]) advAny('par ' + s, s);
advAny('max 5', 'x' + D + 'рф hello world', 5);
advAny('max 1', '中国。中国', 1);


// Round 3: look-alike letters the IDNA mapping folds, joiners inside an IDN
// TLD, a joiner after a virama before a look-alike dot, and the documented
// cases. (Round 3 also let a Han, Kana, Hangul, Thai or Lao TLD go without a
// word end after a real dot; round 4 took that back, so "Prize
// paypal.中国登录" and the next two now stay whole.)
const r3rm = [
  'Prize ab.ᲃайт', 'Prize ab.москᲀа/login', 'Prize ab.катᲂлик', 'Prize ab.ᲁети',
  'Prize ab' + D + 'ᲃайт', 'Prize ab' + D + 'москᲀа/login', 'Prize ab' + D + 'катᲂлик', 'Prize ab' + D + 'ᲁети',
  'Prize ab.ᲄᲅ.срб', 'Prize ab.СᲂМ', 'Prize ab.ᲒᲔ',
  'Prize ab.भा' + ZWJ + 'रत', 'Prize ab.भा' + ZWNJ + 'रत', 'Prize ab.مص' + ZWNJ + 'ر', 'Prize ab.عر' + ZWJ + 'ب',
  'Prize ab.சிங்' + ZWNJ + 'கப்பூர்', 'Prize ab' + D + 'भा' + ZWJ + 'रत', 'Prize ab.भा' + ZWJ + ZWJ + 'रत',
  'Prize paypal.中国登录', 'Prize ab.한국에서', 'Prize ab.ไทยเข้าสู่ระบบ', 'Prize 谷歌.中国', 'Prize x.嘉里大酒店x',
  'Prize x.嘉里x', 'Prize x.ລາວສະບາຍດີ', 'Prize x.คอมพิวเตอร์', 'Prize x.コムです', 'Prize x.中国/a b',
  'Prize पेपाल्' + ZWNJ + D + 'com', 'Prize पेपाल्' + ZWJ + D + 'com', 'Prize पेपाल्' + ZWNJ + cpx(0x2027) + 'com',
];
for (const s of r3rm) { rows.push(['R3 rm ' + s, s, 60, 'fb']); rows.push(['R3 rm in ' + s, s + ' now', 60, 'fb']); }
const r3keep = ['Tokyo。中国支社', '广告片。公司', 'Tokyo。東京支社', '撮影終了。Netflixで配信', 'paypal。comでログイン', 'x.рфabc', 'Tokyo。ไทยแลนด์', 'x。한국에서'];
for (const s of r3keep) { rows.push(['R3 keep ' + s, s, 60, 'fb']); rows.push(['R3 keep in ' + s, 'Prize ' + s + ' now', 60, 'fb']); }
const r3doc = ['Ver.クラウド版', '東京。Tokyo', '今日は晴れ。OK!', '会议。OK', 'paypal.comでログイン', 'г.Москва', 'г. Москва', 'डॉ.भारत कुमार', 'ม.ไทย', 'a.com.рф', 'ab.vermögensberater', 'ab.vermögensberaterx'];
for (const s of r3doc) rows.push(['R3 doc ' + s, s, 60, 'fb']);
// Step gates: names that hold only some of "://", "www.", ".", a look-alike dot.
for (const s of ['St. Mary v2.0', 'no dot at all', 'WwW.x', 'wWw.', 'a://b', 'x://', '://', 'é.é', 'x.' + cpx(0x301) + 'é', 'x.' + cpx(0x301) + 'com', 'a。b', 'a‧b'])
  rows.push(['R3 gate ' + s, s, 60, 'fb']);
// Round 4. Every IDN TLD ends the word again: numbered and company names
// whose word after the dot starts with a TLD stay; the sharp s is "ss" in a
// host; runs of joiners are judged by their neighbours before any is dropped.
const r4keep = ['1.公司简介', '2.网站设计', '3.游戏美术', '4.中国风海报', '2024.香港之旅', '01.在线课程', 'Q1.集团介绍', '9.手机广告',
  '11.政府项目', '3.企业宣传片', '1.みんなの写真', 'No.1.セール情報', 'Vol.3.ストア特集', '1.グーグル広告', '2.ポイントカード',
  '3.ファッション撮影', '1.한국여행', '2.삼성전자 광고', '2024.한국영화', 'EP.한국어', 'บมจ.ไทยออยล์', 'บจก.ไทยเบฟ', 'ธ.ไทยพาณิชย์',
  'วศ.คอมพิวเตอร์', 'บจก.คอมเซเว่น', 'ร.ร.ไทยรัฐวิทยา', 'ม.ไทยคม', 'ບ.ລາວໂທລະຄົມ', 'ທ.ລາວສູງ', 'Ver.クラウド版',
  'Prize paypal.中国登录', 'Prize ab.한국에서', 'Prize ab.ไทยเข้าสู่ระบบ', 'Straße 5', 'Weiß Bier',
  cpx(0x2764) + VS16 + ZWJ + cpx(0x1f525), cpx(0x1f3f3) + VS16 + ZWJ + cpx(0x1f308), cpx(0x1f441) + VS16 + ZWJ + cpx(0x1f5e8) + VS16,
  cpx(0x1f9d1, 0x1f3fd) + ZWJ + cpx(0x1f4bb), cpx(0x1f468) + ZWJ + cpx(0x1f469) + ZWJ + cpx(0x1f467) + ZWJ + cpx(0x1f466),
  cpx(0x1f3f4) + ZWJ + cpx(0x2620) + VS16, '1' + VS16 + cpx(0x20e3), cpx(0xdc1, 0xdca) + ZWJ + cpx(0xdbb, 0xdd3) + ' ' + cpx(0xdbd, 0xd82, 0xd9a, 0xdcf),
  cpx(0x645, 0x6cc) + ZWNJ + cpx(0x62e, 0x648, 0x627, 0x647, 0x645),
  'क्' + ZWJ + 'ष', 'क्' + ZWNJ + 'ष', cpx(0xd28, 0xd4d) + ZWJ, cpx(0xd23, 0xd4d) + ZWJ, cpx(0xd32, 0xd4d) + ZWJ + ' ' + cpx(0xd30, 0xd4d) + ZWJ,
  cpx(0xd33, 0xd4d) + ZWJ + cpx(0xd15), '☃.net', 'i❤.ws', 'г. Москва'];
for (const s of r4keep) { rows.push(['R4 keep ' + s, s, 60, 'fb']); rows.push(['R4 keep in ' + s, 'Prize ' + s + ' now', 60, 'fb']); }
const r4rm = ['Prize 谷歌.中国', 'Prize paypal.中国 登录', 'Prize ab.ẞ', 'Prize ab。ẞ', 'Prize ab。glaẞ', 'Prize ab.preß/login', 'Prize ab.ß',
  'Prize ab。ß', 'Prize ab。GLAẞ', 'Prize ab.ẞẞ', 'Prize ab‧ẞ x'];
for (const s of r4rm) { rows.push(['R4 rm ' + s, s, 60, 'fb']); rows.push(['R4 rm in ' + s, s + ' now', 60, 'fb']); }
for (const s of ['東京。Tokyo', '今日は晴れ。OK!', '会议。OK', 'paypal。comでログイン', 'paypal.comでログイン', 'г.Москва', 'डॉ.भारत कुमार', 'ม.ไทย', '2.삼성 광고'])
  rows.push(['R4 acc ' + s, s, 60, 'fb']);
// Two or three invisibles in a row between letters of a joining script, an
// emoji, Latin, a dot and a digit (the reviewer's rows; the 144 that differed
// before round 4 are among the "seq" ones).
{
  const J = ['भा', 'र', 'क्', 'م', '😀', 'a', '.', '1'];
  const I = [ZWJ, ZWNJ, VS16];
  for (const a of J) for (const x of I) for (const y of I) for (const b of J) rows.push(['R4 seq ' + a + '|' + x.codePointAt(0).toString(16) + '|' + y.codePointAt(0).toString(16) + '|' + b, 'n ' + a + x + y + b + ' n', 60, '']);
  for (const a of J) for (const x of I) for (const y of I) for (const z of I) rows.push(['R4 seq3 ' + a + '|' + [x, y, z].map((c) => c.codePointAt(0).toString(16)).join('|'), 'n ' + a + x + y + z + 'रत', 60, '']);
  rows.push(['R4 seq lure plain', 'Prize ab.भा' + ZWJ + ZWNJ + 'रत', 60, '']);
  rows.push(['R4 seq lure ideo', 'Prize ab' + D + 'भा' + ZWNJ + ZWJ + 'रत', 60, '']);
  rows.push(['R4 seq virama zwj zwnj ideo', 'Prize पेपाल्' + ZWJ + ZWNJ + D + 'com', 60, '']);
  rows.push(['R4 seq virama zwnj zwj ideo', 'Prize पेपाल्' + ZWNJ + ZWJ + D + 'com', 60, '']);
  for (const s of [cpx(0x1f3f3) + VS16 + VS16 + ZWJ + cpx(0x1f308), cpx(0x1f468) + ZWJ + ZWJ + cpx(0x1f469), '1' + VS16 + VS16 + cpx(0x20e3),
    cpx(0x2764) + VS16 + ZWJ + ZWJ + cpx(0x1f525), cpx(0x915, 0x94d) + ZWJ + ZWNJ + cpx(0x937), cpx(0x645) + ZWNJ + ZWNJ + cpx(0x62e),
    cpx(0x1f469, 0x1f3fd) + VS16 + ZWJ + cpx(0x1f3a8), cpx(0x1f3fd) + ZWJ + cpx(0x1f3a8), 'x' + cpx(0x1f3fd) + VS16])
    rows.push(['R4 seq real-ish ' + [...s].map((c) => c.codePointAt(0).toString(16)).join(' '), s, 60, '']);
}

// Round 5. The emoji around a ZWJ or VS16 are Extended_Pictographic (PICTO)
// and Emoji_Modifier (MODIFIER) in both copies: symbols outside PICTO (a
// check mark, a chess king, a star), regional indicators and a skin tone
// where a PICTO is needed lose the joiner; real sequences keep it. The
// reviewer's rows (the 149 that differed before round 5 are among them):
// an emoji, a symbol, a regional indicator, a skin tone, then two
// invisibles, then a letter, an emoji, a skin tone or U+20E3.
{
  const named = [cpx(0x2605) + VS16, cpx(0x2713) + VS16, cpx(0x265a) + VS16, cpx(0x1f1fa) + ZWJ + cpx(0x1f1f8),
    cpx(0x1f600) + VS16 + ZWJ + cpx(0x1f3fd), cpx(0x2605) + VS16 + ZWNJ + cpx(0x92d, 0x93e),
    cpx(0x1f469, 0x1f3fd) + VS16 + ZWJ + cpx(0x1f3a8), 'x' + cpx(0x1f3fd) + VS16];
  for (const s of named) { rows.push(['R5 emoji ' + [...s].map((c) => c.codePointAt(0).toString(16)).join(' '), s, 60, 'fb']); rows.push(['R5 emoji in ' + s, 'n ' + s + ' n', 60, 'fb']); }
  const A = [cpx(0x1f600), cpx(0x2764), cpx(0x2605), cpx(0x2603), cpx(0x1f1fa), cpx(0x1f3fd), cpx(0x1f9d1, 0x1f3fd)];
  const X = [VS16, cpx(0xfe0e), cpx(0x200b)];
  const B = [cpx(0x92d, 0x93e), cpx(0x1f600), cpx(0x1f525), 'a', cpx(0x20e3), cpx(0x1f3fd)];
  for (const a of A) for (const x of X) for (const y of [ZWJ, ZWNJ, VS16]) for (const b of B)
    rows.push(['R5 inv ' + [...(a + x + y + b)].map((c) => c.codePointAt(0).toString(16)).join(' '), 'n ' + a + x + y + b + ' n', 60, '']);
  // Real sequences: a heart on fire, the rainbow flag, an eye in a speech
  // bubble, a technologist and an artist with a skin tone, a family, the
  // pirate flag, two keycaps, the copyright sign and the trade mark sign
  // (NFKC makes that one "TM" in both copies).
  const real = [cpx(0x2764) + VS16 + ZWJ + cpx(0x1f525), cpx(0x1f3f3) + VS16 + ZWJ + cpx(0x1f308),
    cpx(0x1f441) + VS16 + ZWJ + cpx(0x1f5e8) + VS16, cpx(0x1f9d1, 0x1f3fd) + ZWJ + cpx(0x1f4bb), cpx(0x1f469, 0x1f3fd) + ZWJ + cpx(0x1f3a8),
    cpx(0x1f468) + ZWJ + cpx(0x1f469) + ZWJ + cpx(0x1f467) + ZWJ + cpx(0x1f466), cpx(0x1f3f4) + ZWJ + cpx(0x2620) + VS16,
    '1' + VS16 + cpx(0x20e3), '#' + VS16 + cpx(0x20e3), cpx(0xa9) + VS16, cpx(0x2122) + VS16];
  for (const s of real) { rows.push(['R5 real ' + s, s, 60, 'fb']); rows.push(['R5 real in ' + s, 'Prize ' + s + ' now', 60, 'fb']); }
  // An invisible between a TLD and the next word is dropped first: accepted.
  rows.push(['R5 acc zwsp after TLD', 'Prize ab.' + cpx(0x4e2d, 0x56fd, 0x200b, 0x767b, 0x5f55), 60, 'fb']);
}

// Every IDN TLD with a look-alike letter, and with a joiner between each two
// characters, after a real dot and after a look-alike one.
const LOOK = { 'в': 'ᲀ', 'д': 'ᲁ', 'о': 'ᲂ', 'с': 'ᲃ', 'т': 'ᲄ' };
for (const t of IDN_TLDS) {
  const look = [...t].map((ch) => LOOK[ch] || ch).join('');
  if (look !== t) { rows.push(['R3 look x.' + look, 'Prize x.' + look + ' now', 60, 'fb']); rows.push(['R3 look x。' + look, 'Prize x。' + look, 60, 'fb']); }
  for (const j of [ZWNJ, ZWJ]) rows.push(['R3 joined x.' + t, 'Prize x.' + [...t].join(j) + ' now', 60, 'fb']);
  rows.push(['R3 joined x。' + t, 'Prize x。' + [...t].join(ZWJ), 60, 'fb']);
  rows.push(['R3 more 中.' + t, '中.' + t + '中', 60, 'fb']);
}

// ── Commands ────────────────────────────────────────────────────────────────
const hex = (s) => Buffer.from(s, 'utf8').toString('hex');
const show = (s) => JSON.stringify(s.length > 90 ? s.slice(0, 30) + '…' + s.slice(-40) : s);

function probe(url, collateC, showAll) {
  const coll = collateC ? ' collate "C"' : '';
  const sql = rows.map(([, s, max, fb], i) => `select ${i}, encode(convert_to(public._safe_label((convert_from(decode('${hex(s)}','hex'),'UTF8')${coll}), ${max}, convert_from(decode('${hex(fb)}','hex'),'UTF8')),'UTF8'),'hex');`).join('\n');
  const out = psql(url, sql, ['-At', '-F', '|']).trim().split('\n');
  if (out.length !== rows.length) throw new Error('expected ' + rows.length + ' rows, got ' + out.length);
  const diffs = [], cut = [];
  rows.forEach(([label, s, max, fb], i) => {
    const got = Buffer.from(out[i].split('|')[1] || '', 'hex').toString('utf8');
    const js = safeLabel(s, max, fb);
    if (showAll) console.log(label.slice(0, 40).padEnd(40), show(s), '->', show(js));
    if (js === got) return;
    const longcut = [...s].length > max && (js.endsWith('…') || got.endsWith('…'));
    (longcut ? cut : diffs).push({ label, input: show(s), max, js: show(js), sql: show(got) });
  });
  console.log('url', url.replace(/:[^:@/]*@/, ':***@'), 'value collation', collateC ? 'C' : 'as given');
  console.log('rows', rows.length, 'diffs', diffs.length, 'cutdiffs', cut.length);
  for (const d of diffs) console.log('DIFF', JSON.stringify(d));
  for (const d of cut) console.log('CUT ', d.label, 'max', d.max, 'js', d.js, 'sql', d.sql);
  return diffs.length;
}

function time(url) {
  const ms = (out) => Number((out.match(/Time: ([\d.]+) ms/g) || []).pop()?.match(/[\d.]+/)[0]);
  const lit = (s) => `convert_from(decode('${hex(s)}','hex'),'UTF8')`;
  console.log('cold: first call on a fresh connection (best and worst of 3)');
  for (const s of ['Lost Time', 'St. Mary v2.0', 'Prize x.рф', 'Prize paypal' + D + 'com', 'https://x.example www.y']) {
    const t = [0, 1, 2].map(() => ms(psql(url, `\\timing on\nselect length(public._safe_label(${lit(s)}));\n`, ['-At'])));
    console.log('  ' + show(s).padEnd(32), Math.min(...t).toFixed(1), Math.max(...t).toFixed(1));
  }
  console.log('warm: second call on one connection');
  const units = [['ру.', 4000], ['ру' + D, 4000], ['a.', 5000], ['x.рф', 2500], ['中' + D, 6000], ['a' + D, 5000], ['x.中国', 2000],
    ['x.' + [...'சிங்கப்பூ'].join(ZWNJ) + '.', 300], ['a.中', 3000], ['\u200dक्', 4000], ['x.ไทย', 2000], ['ab.vermögensberat', 200]];
  for (const [u, n] of units) {
    const s = u.repeat(n);
    const out = psql(url, `select length(public._safe_label(${lit(s)}));\n\\timing on\nselect length(public._safe_label(${lit(s)}));\n`, ['-At']);
    console.log('  ' + (JSON.stringify(u) + ' x' + n).padEnd(32), ms(out).toFixed(1));
  }
}

function main([mode, url, ...flags]) {
const sql = readFileSync(MIGRATION, 'utf8');
if (mode === 'sizes') {
  for (const s of statements(sql)) console.log('part', s.part, 'statement', s.text.length, s.text.split('\n')[0].slice(0, 70));
  for (const p of parts(sql)) console.log('part', p.n, 'total', p.text.length);
} else if (mode === 'apply') {
  localUrl(url);
  for (const p of parts(sql)) {
    if (p.text.length >= 4500) throw new Error('part ' + p.n + ' is ' + p.text.length + ' characters');
    psql(url, p.text, ['-q']);
    console.log('applied part', p.n, '(' + p.text.length + ' characters)');
  }
} else if (mode === 'probe') {
  process.exitCode = probe(localUrl(url), flags.includes('--collate-c'), flags.includes('--show')) ? 1 : 0;
} else if (mode === 'time') {
  time(localUrl(url));
} else {
  console.error('usage: safe-label-parity.mjs sizes | apply <url> | probe <url> [--collate-c] [--show] | time <url>');
  process.exitCode = 2;
}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
