// composeNoteHtml / noteHtmlLead: {title, body} plain text -> note HTML the
// editor schema accepts, and the lead heading read back out.

import test from 'node:test';
import assert from 'node:assert/strict';
import { composeNoteHtml, noteHtmlLead, NOTE_HTML_MAX } from './noteCompose.js';

const seen = [];
const compose = (note, opts) => {
  const html = composeNoteHtml(note, opts);
  seen.push(html);
  return html;
};
const body = (b) => compose({ body: b });

// Every tag closes in order (no void tags are ever emitted).
function balanced(html) {
  const stack = [];
  for (const m of html.matchAll(/<(\/?)([a-z0-9]+)([^>]*)>/g)) {
    if (m[1]) {
      if (stack.pop() !== m[2]) return false;
    } else {
      stack.push(m[2]);
    }
  }
  return stack.length === 0;
}

test('title only, body only, nothing', () => {
  assert.equal(compose({ title: 'Hello' }), '<h2>Hello</h2>');
  assert.equal(compose({ title: '  Hello  ' }), '<h2>Hello</h2>');
  assert.equal(compose({ body: 'Just text' }), '<p>Just text</p>');
  assert.equal(compose({ title: 'T', body: 'B' }), '<h2>T</h2><p>B</p>');
  assert.equal(compose({}), '');
  assert.equal(compose(), '');
  assert.equal(compose({ title: '  ', body: '\n \n' }), '');
  assert.equal(compose({ title: 5, body: null }), '');
});

test('the film-diary sample', () => {
  assert.equal(
    compose({
      title: 'MARTY SUPREME (2025)',
      body: '9.75 / 10\n\nOne of your highest-rated films.\n\nNOTES\n• What makes the lead performance electric?\n• How does the film build momentum?\n• Favorite scene / sequence:',
    }),
    '<h2>MARTY SUPREME (2025)</h2><p>9.75 / 10</p><p></p><p>One of your highest-rated films.</p><p></p><p>NOTES</p><ul><li><p>What makes the lead performance electric?</p></li><li><p>How does the film build momentum?</p></li><li><p>Favorite scene / sequence:</p></li></ul>',
  );
});

test('bullets with -, * and the bullet glyph', () => {
  const li = '<li><p>a</p></li><li><p>b</p></li><li><p>c</p></li>';
  assert.equal(body('- a\n- b\n- c'), `<ul>${li}</ul>`);
  assert.equal(body('* a\n* b\n* c'), `<ul>${li}</ul>`);
  assert.equal(body('• a\n• b\n• c'), `<ul>${li}</ul>`);
  assert.equal(body('  - a\n  - b\n  - c'), `<ul>${li}</ul>`);
  assert.equal(body('- a\n* b\n• c'), `<ul>${li}</ul>`);
});

test('ordered lists, with start', () => {
  assert.equal(body('1. a\n2. b'), '<ol><li><p>a</p></li><li><p>b</p></li></ol>');
  assert.equal(body('1) a\n2) b'), '<ol><li><p>a</p></li><li><p>b</p></li></ol>');
  assert.equal(body('3. a\n4. b'), '<ol start="3"><li><p>a</p></li><li><p>b</p></li></ol>');
  assert.equal(body('9.75 / 10'), '<p>9.75 / 10</p>');
});

test('checklists', () => {
  const open = (t) => `<li class="ck"><span class="ck-box" role="checkbox" aria-checked="false"></span><div class="ck-text"><p>${t}</p></div></li>`;
  const done = (t) => `<li class="ck"><span class="ck-box is-checked" role="checkbox" aria-checked="true"></span><div class="ck-text"><p>${t}</p></div></li>`;
  assert.equal(
    body('- [ ] one\n- [x] two\n[X] three\n* [ ] four'),
    `<ul class="note-checklist">${open('one')}${done('two')}${done('three')}${open('four')}</ul>`,
  );
  assert.equal(
    body('☐ one\n☑ two\n✓ three\n✔ four'),
    `<ul class="note-checklist">${open('one')}${done('two')}${done('three')}${done('four')}</ul>`,
  );
  assert.equal(body('[ ]'), '<p>[ ]</p>');
});

test('different list kinds back to back make separate lists', () => {
  assert.equal(
    body('- a\n1. b\n- [ ] c'),
    '<ul><li><p>a</p></li></ul><ol><li><p>b</p></li></ol><ul class="note-checklist"><li class="ck"><span class="ck-box" role="checkbox" aria-checked="false"></span><div class="ck-text"><p>c</p></div></li></ul>',
  );
});

test('a blank line between items of one list does not end it', () => {
  assert.equal(body('- a\n\n- b\n\n\n- c'), '<ul><li><p>a</p></li><li><p>b</p></li><li><p>c</p></li></ul>');
  assert.equal(body('1. a\n\n2. b'), '<ol><li><p>a</p></li><li><p>b</p></li></ol>');
  assert.equal(body('- a\n\n1. b'), '<ul><li><p>a</p></li></ul><ol><li><p>b</p></li></ol>');
});

test('headings', () => {
  assert.equal(body('# One'), '<h2>One</h2>');
  assert.equal(body('## Two'), '<h3>Two</h3>');
  assert.equal(body('### Three'), '<h3>Three</h3>');
  assert.equal(body('#### Four'), '<p>#### Four</p>');
  assert.equal(body('#NoSpace'), '<p>#NoSpace</p>');
  assert.equal(body('## A **bold** word'), '<h3>A <strong>bold</strong> word</h3>');
});

test('blank-line rules around headings and lists', () => {
  assert.equal(body('# H\n\ntext'), '<h2>H</h2><p>text</p>');
  assert.equal(body('text\n\n# H'), '<p>text</p><p></p><h2>H</h2>');
  assert.equal(body('text\n\n- a\n\nmore'), '<p>text</p><ul><li><p>a</p></li></ul><p>more</p>');
  assert.equal(compose({ title: 'T', body: '\n\ntext' }), '<h2>T</h2><p>text</p>');
  assert.equal(body('\n\n  \ntext\n\n\n'), '<p>text</p>');
});

test('repeated blank lines make one empty paragraph; rules count as blank', () => {
  assert.equal(body('a\n\n\n\nb'), '<p>a</p><p></p><p>b</p>');
  assert.equal(body('a\n---\nb'), '<p>a</p><p></p><p>b</p>');
  assert.equal(body('a\n\n***\n\n___\nb'), '<p>a</p><p></p><p>b</p>');
  assert.equal(body('a\n- - -\nb'), '<p>a</p><p></p><p>b</p>');
});

test('escaping', () => {
  assert.equal(body('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.equal(body('<img src=x onerror=alert(1)>'), '<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  assert.equal(body(`He said "hi" & it's fine`), '<p>He said &quot;hi&quot; &amp; it&#39;s fine</p>');
  assert.equal(compose({ title: `<b>"A" & 'B'</b>` }), '<h2>&lt;b&gt;&quot;A&quot; &amp; &#39;B&#39;&lt;/b&gt;</h2>');
  assert.equal(compose({ title: '**not bold**' }), '<h2>**not bold**</h2>');
  assert.equal(body('- <b>x</b>\n- [ ] <i>y</i>').includes('<b>'), false);
  assert.equal(body('[x](https://a.com/?q="><script>)').includes('<script'), false);
});

test('inline: bold and italic', () => {
  assert.equal(body('a **b** c __d__ e'), '<p>a <strong>b</strong> c <strong>d</strong> e</p>');
  assert.equal(body('a *b* c _d_ e'), '<p>a <em>b</em> c <em>d</em> e</p>');
  assert.equal(body('***both***'), '<p><em><strong>both</strong></em></p>');
  assert.equal(body('*a **b** c*'), '<p><em>a <strong>b</strong> c</em></p>');
  assert.equal(body('2 * 3 * 4'), '<p>2 * 3 * 4</p>');
  assert.equal(body('- **x** and *y*'), '<ul><li><p><strong>x</strong> and <em>y</em></p></li></ul>');
});

test('inline: underscores inside words stay', () => {
  assert.equal(body('use snake_case_name here'), '<p>use snake_case_name here</p>');
  assert.equal(body('__init__ and a_b_c'), '<p><strong>init</strong> and a_b_c</p>');
  assert.equal(body('an _emphasis_ word'), '<p>an <em>emphasis</em> word</p>');
});

test('inline: links', () => {
  assert.equal(body('see [docs](https://a.com/x?y=1&z=2) now'), '<p>see <a href="https://a.com/x?y=1&amp;z=2">docs</a> now</p>');
  assert.equal(body('[a](http://a.com)'), '<p><a href="http://a.com">a</a></p>');
  assert.equal(body('[mail](mailto:a@b.co)'), '<p><a href="mailto:a@b.co">mail</a></p>');
  assert.equal(body('[a](HTTPS://A.COM)'), '<p><a href="HTTPS://A.COM">a</a></p>');
  assert.equal(body('[x](javascript:alert(1))'), '<p>[x](javascript:alert(1))</p>');
  assert.equal(body('[x](data:text/html,hi)'), '<p>[x](data:text/html,hi)</p>');
  assert.equal(body('[x](/relative/path)'), '<p>[x](/relative/path)</p>');
  assert.equal(body('[x](//evil.com)'), '<p>[x](//evil.com)</p>');
  assert.equal(body('[x](https://a.com/"q)'), '<p>[x](https://a.com/&quot;q)</p>');
  assert.equal(body('[a b](https://a.com/ c)'), '<p>[a b](https://a.com/ c)</p>');
  assert.equal(body('[**bold** label](https://a.com)'), '<p><a href="https://a.com"><strong>bold</strong> label</a></p>');
  assert.equal(body('[a](https://x.com/a_b_c/*z*)'), '<p><a href="https://x.com/a_b_c/*z*">a</a></p>');
  assert.equal(body('bare https://a.com stays'), '<p>bare https://a.com stays</p>');
  assert.equal(body('`code` ![img](https://a.com/i.png)'), '<p>`code` !<a href="https://a.com/i.png">img</a></p>');
});

test('CRLF, tabs, spacing', () => {
  assert.equal(body('a\r\nb\r\n\r\nc\rd'), '<p>a</p><p>b</p><p></p><p>c</p><p>d</p>');
  assert.equal(body('\ta  b   '), '<p>a  b</p>');
  assert.equal(body('\t- item'), '<ul><li><p>item</p></li></ul>');
});

test('a body that repeats the title drops that line', () => {
  assert.equal(compose({ title: 'Plan', body: 'Plan\n\nstep one' }), '<h2>Plan</h2><p>step one</p>');
  assert.equal(compose({ title: 'Plan', body: '\n# plan  \nstep one' }), '<h2>Plan</h2><p>step one</p>');
  assert.equal(compose({ title: 'Plan', body: 'Plan B' }), '<h2>Plan</h2><p>Plan B</p>');
  assert.equal(compose({ title: 'Plan', body: 'x\nPlan' }), '<h2>Plan</h2><p>x</p><p>Plan</p>');
  assert.equal(compose({ body: 'Plan\nx' }), '<p>Plan</p><p>x</p>');
});

test('maxLen cuts at block boundaries and closes every tag', () => {
  const para = 'word '.repeat(20).trim();
  const long = Array.from({ length: 50 }, (_, i) => `${para} ${i}`).join('\n\n');
  const html = compose({ title: 'T', body: long }, { maxLen: 500 });
  assert.ok(html.length <= 500 && html.length > 300, `length ${html.length}`);
  assert.ok(balanced(html));
  assert.ok(html.endsWith('</p>'));

  const items = Array.from({ length: 40 }, (_, i) => `- item number ${i}`).join('\n');
  const listHtml = compose({ body: `intro\n${items}\noutro` }, { maxLen: 300 });
  assert.ok(listHtml.length <= 300);
  assert.ok(balanced(listHtml));
  assert.ok(listHtml.endsWith('</li></ul>'));
  assert.ok(!listHtml.includes('outro'));

  const cks = Array.from({ length: 40 }, (_, i) => `[ ] task ${i}`).join('\n');
  const ckHtml = compose({ body: cks }, { maxLen: 700 });
  assert.ok(ckHtml.length <= 700 && balanced(ckHtml) && ckHtml.endsWith('</li></ul>'));

  // Too small for even one item: the list is dropped, not left empty.
  assert.equal(compose({ body: 'a\n- long item here' }, { maxLen: 20 }), '<p>a</p>');
  assert.equal(compose({ title: 'x'.repeat(100) }, { maxLen: 50 }), '');

  const huge = compose({ body: 'x\n\n'.repeat(30000) });
  assert.ok(huge.length <= NOTE_HTML_MAX && balanced(huge));
});

test('allow-list: only the schema tags and attributes ever appear', () => {
  const TAGS = new Set(['h2', 'h3', 'p', 'ul', 'ol', 'li', 'strong', 'em', 'a', 'span', 'div']);
  const ATTRS = new Set(['href', 'start', 'class', 'role', 'aria-checked']);
  assert.ok(seen.length > 20);
  for (const html of seen) {
    assert.ok(balanced(html), html);
    for (const m of html.matchAll(/<\/?([a-zA-Z0-9]+)([^>]*)>/g)) {
      assert.ok(TAGS.has(m[1]), `tag ${m[1]} in ${html}`);
      for (const a of m[2].matchAll(/\s([a-zA-Z-]+)=/g)) {
        assert.ok(ATTRS.has(a[1]), `attr ${a[1]} in ${html}`);
      }
    }
  }
});

test('noteHtmlLead: reads the lead heading back', () => {
  assert.deepEqual(
    noteHtmlLead('<h2>Tom &amp; <em>Jerry</em> &lt;3 &quot;x&quot; it&#39;s&nbsp;ok</h2><p>rest</p>'),
    { title: 'Tom & Jerry <3 "x" it\'s ok', rest: '<p>rest</p>' },
  );
  assert.deepEqual(noteHtmlLead('<h1>One</h1><p>x</p>'), { title: 'One', rest: '<p>x</p>' });
  assert.deepEqual(noteHtmlLead('  <h3>Three</h3>'), { title: 'Three', rest: '' });
  assert.deepEqual(noteHtmlLead('<h2 class="a" id="b">Attr</h2><ul></ul>'), { title: 'Attr', rest: '<ul></ul>' });
  assert.deepEqual(noteHtmlLead('<h2>  a \n  b  </h2>'), { title: 'a b', rest: '' });
  assert.deepEqual(noteHtmlLead('<h2>&amp;lt;</h2>'), { title: '&lt;', rest: '' });
  assert.deepEqual(noteHtmlLead('<p>no heading</p><h2>later</h2>'), { title: null, rest: '<p>no heading</p><h2>later</h2>' });
  assert.deepEqual(noteHtmlLead('<h4>four</h4>'), { title: null, rest: '<h4>four</h4>' });
  assert.deepEqual(noteHtmlLead('<h2>unclosed'), { title: null, rest: '<h2>unclosed' });
  assert.deepEqual(noteHtmlLead(undefined), { title: null, rest: '' });
  assert.deepEqual(noteHtmlLead(42), { title: null, rest: '' });
  const c = composeNoteHtml({ title: 'A & B', body: 'x' });
  assert.deepEqual(noteHtmlLead(c), { title: 'A & B', rest: '<p>x</p>' });
});
