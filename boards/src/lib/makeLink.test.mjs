import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAKE, parseMakeFragment, parseMakeText, parseMakeSource, makeLinkFor, readMakeSwatches, pictureUrl,
} from './makeLink.js';

const items = (b) => b.sections.flatMap((s) => s.items);

test('a link: title, sections with colours, pictures, a palette, notes, end', () => {
  const b = parseMakeFragment('#title=Tokyo%20noir,%201974&section=Look|blue'
    + '&pic=https://example.com/street.jpg|Wet%20street'
    + '&palette=Night|%23101820%20Ink,%23f2aa4c%20Sodium'
    + '&section=Story&note=Logline|A%20night-shift%20cabbie%0A-%20one%0A-%20two&end=3');
  assert.equal(b.title, 'Tokyo noir, 1974');
  assert.equal(b.source, 'link');
  // A named colour is its tone (lib/boardStyle.js).
  assert.deepEqual(b.sections.map((s) => [s.name, s.color]), [['Look', '#3f7ab5'], ['Story', null]]);
  assert.deepEqual(items(b), [
    { kind: 'picture', url: 'https://example.com/street.jpg', caption: 'Wet street' },
    { kind: 'palette', title: 'Night', swatches: [{ hex: '#101820', name: 'Ink' }, { hex: '#f2aa4c', name: 'Sodium' }] },
    { kind: 'note', title: 'Logline', body: 'A night-shift cabbie\n- one\n- two' },
  ]);
  assert.equal(b.count, 3);
  assert.equal(b.pictures, 1);
  assert.equal(b.cut, null);
  assert.deepEqual(b.problems, []);
});

test('the whole link, a bare fragment and one with its # read alike', () => {
  const frag = 'title=A&note=hello&end=1';
  const a = parseMakeFragment(`https://clusters.soleilpictures.com/make#${frag}`);
  const b = parseMakeFragment(frag);
  const c = parseMakeFragment(`#${frag}`);
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
  assert.deepEqual(items(a), [{ kind: 'note', title: null, body: 'hello' }]);
});

test('a link cut short says how much came through', () => {
  const b = parseMakeFragment('title=A&note=one&note=two&end=5');
  assert.deepEqual(b.cut, { expected: 5, got: 2, missing: 3 });
  // Without end there is no telling.
  assert.equal(parseMakeFragment('title=A&note=one').cut, null);
  // Cards refused for a reason of their own aren't "cut".
  assert.equal(parseMakeFragment('note=one&pic=http://x.com/a.jpg&end=2').cut, null);
});

test('a picture address with its own query, unencoded, stays whole', () => {
  const b = parseMakeFragment('pic=https://images.unsplash.com/photo-1?auto=format&fit=crop&w=1200&q=80|Neon&note=x');
  assert.deepEqual(items(b)[0], {
    kind: 'picture', url: 'https://images.unsplash.com/photo-1?auto=format&fit=crop&w=1200&q=80', caption: 'Neon',
  });
  assert.equal(items(b)[1].body, 'x');
  // Without a caption too.
  const c = parseMakeFragment('pic=https://example.com/a.jpg?w=1&h=2&note=y');
  assert.equal(items(c)[0].url, 'https://example.com/a.jpg?w=1&h=2');
});

test('an address keeps its own escapes; one encoded whole is decoded', () => {
  const kept = parseMakeFragment('pic=https://firebasestorage.googleapis.com/v0/b/x/o/a%2Fb.jpg?alt=media');
  assert.equal(items(kept)[0].url, 'https://firebasestorage.googleapis.com/v0/b/x/o/a%2Fb.jpg?alt=media');
  const whole = parseMakeFragment('pic=https%3A%2F%2Fexample.com%2Fa%20b.jpg%7CA%20caption');
  assert.deepEqual(items(whole)[0], { kind: 'picture', url: 'https://example.com/a%20b.jpg', caption: 'A caption' });
  // An encoder that leaves the colon be still encoded the rest.
  const colon = parseMakeFragment('pic=https:%2F%2Fpicsum.photos%2Fid%2F1011%2F1200%2F800|Lake%20at%20dusk');
  assert.deepEqual(items(colon)[0], { kind: 'picture', url: 'https://picsum.photos/id/1011/1200/800', caption: 'Lake at dusk' });
});

test('pictures that are not public https addresses are left out and counted', () => {
  const b = parseMakeFragment('pic=http://example.com/a.jpg&pic=https://localhost/a.jpg'
    + '&pic=https://10.0.0.1/a.jpg&pic=https://user:pw@example.com/a.jpg&pic=https://example.com:8443/a.jpg'
    + '&pic=javascript:alert(1)&pic=https://example.com/ok.jpg');
  assert.deepEqual(items(b).map((i) => i.url), ['https://example.com/ok.jpg']);
  assert.deepEqual(b.problems, [{ code: 'bad_pictures', n: 6 }]);
  assert.equal(pictureUrl('https://example.com/x.png'), 'https://example.com/x.png');
  assert.equal(pictureUrl(' <https://example.com/x.png> '), 'https://example.com/x.png');
});

test('text values: + is a space unless the value spells spaces %20; \\n breaks a line', () => {
  assert.equal(parseMakeFragment('title=Tokyo+noir').title, 'Tokyo noir');
  assert.equal(parseMakeFragment('title=C%2B%2B%20notes').title, 'C++ notes');
  assert.equal(parseMakeFragment('title=A%20+%20B').title, 'A + B');
  assert.equal(items(parseMakeFragment('note=T|line%20one\\nline%20two'))[0].body, 'line one\nline two');
  // A stray % is kept, not an error.
  assert.equal(parseMakeFragment('title=100%25%20sure%').title, '100% sure%');
});

test('a | written inside a part (%7C) stays in it', () => {
  const b = parseMakeFragment('note=A%7CB|body%20with%20|%20a%20bar');
  assert.deepEqual(items(b)[0], { kind: 'note', title: 'A|B', body: 'body with | a bar' });
  // A link that encoded every | still splits at the first.
  const all = parseMakeFragment('note=Title%7CBody');
  assert.deepEqual(items(all)[0], { kind: 'note', title: 'Title', body: 'Body' });
});

test('an AI\'s links in a note keep their words and lose their address', () => {
  const b = parseMakeFragment('note=See|Read%20[the%20script](https://evil.example/login)%20first');
  assert.equal(items(b)[0].body, 'Read the script first');
});

test('palettes: names before or after the colour, a | between colours, the # left out', () => {
  assert.deepEqual(readMakeSwatches('#101820 Ink #f2aa4c Sodium'),
    [{ hex: '#101820', name: 'Ink' }, { hex: '#f2aa4c', name: 'Sodium' }]);
  assert.deepEqual(readMakeSwatches('101820 Ink, f2aa4c'),
    [{ hex: '#101820', name: 'Ink' }, { hex: '#f2aa4c', name: null }]);
  assert.deepEqual(readMakeSwatches('Ink: #101820; Sodium (#F2AA4C)'),
    [{ hex: '#101820', name: 'Ink' }, { hex: '#f2aa4c', name: 'Sodium' }]);
  assert.deepEqual(readMakeSwatches('no colours here'), []);
  const b = parseMakeFragment('palette=%23101820|%23f2aa4c');
  assert.deepEqual(items(b)[0], { kind: 'palette', title: null, swatches: [{ hex: '#101820', name: null }, { hex: '#f2aa4c', name: null }] });
  const empty = parseMakeFragment('palette=nothing&end=1');
  assert.equal(empty.count, 0);
  assert.equal(empty.cut, null);
  assert.equal(readMakeSwatches(Array(20).fill('#101820').join(',')).length, MAKE.maxSwatches);
});

test('a section named again carries on; an empty section= ends sections', () => {
  const b = parseMakeFragment('section=A&note=1&section=B&note=2&section=a&note=3&section=&note=4');
  assert.deepEqual(b.sections.map((s) => [s.name, s.items.length]), [['A', 2], ['B', 1], [null, 1]]);
  // A section with nothing in it isn't one.
  assert.deepEqual(parseMakeFragment('section=Empty&section=Full&note=x').sections.map((s) => s.name), ['Full']);
  // "Look (blue)" is a colour too.
  assert.deepEqual(parseMakeFragment('section=Look%20(blue)&note=x').sections.map((s) => [s.name, s.color]), [['Look', '#3f7ab5']]);
});

test('a section\'s colour: a name, a plain colour word or a #hex; anything else is no colour', () => {
  const colours = (frag) => parseMakeFragment(frag).sections.map((s) => [s.name, s.color]);
  // An AI asked for "section=Name|blue" wrote red: the named colour nearest it.
  assert.deepEqual(colours('section=Look|red&note=x&section=Sound|Dark%20Purple&note=y'),
    [['Look', '#b25e6c'], ['Sound', '#9864a4']]);
  assert.deepEqual(colours('section=Look|%23C8A04A&note=x'), [['Look', '#c8a04a']]);
  assert.deepEqual(colours('section=Look|draft&note=x&section=Story|1974&note=y'), [['Look', null], ['Story', null]]);
  // In text, brackets that aren't a colour stay in the name.
  const text = parseMakeText('# Board\n\n## Act One (1974)\nA note\n\n## Look (red)\nAnother\n\n## Draft {abc}\nA third');
  assert.deepEqual(text.sections.map((s) => [s.name, s.color]),
    [['Act One (1974)', null], ['Look', '#b25e6c'], ['Draft {abc}', null]]);
});

test('a link a chat wrote as HTML, each & an &amp;, reads as the link', () => {
  const b = parseMakeFragment('title=Noir&amp;section=Look|blue&amp;pic=https://example.com/a.jpg?w=1&amp;h=2|Street&amp;note=x&amp;end=2');
  assert.equal(b.title, 'Noir');
  assert.deepEqual(items(b), [
    { kind: 'picture', url: 'https://example.com/a.jpg?w=1&h=2', caption: 'Street' },
    { kind: 'note', title: null, body: 'x' },
  ]);
  assert.equal(b.cut, null);
});

test('a link encoded a second time on its way reads as it was written', () => {
  const link = 'title=Tokyo%20noir&section=Look|blue&pic=https:%2F%2Fpicsum.photos%2Fid%2F1011%2F1200%2F800|Lake%20at%20dusk'
    + '&palette=Night|%23101820%20Ink,%23f2aa4c%20Sodium&section=Story|red&note=Logline|A%20cab%2C%2050%25%20rain.%0A-%20Neon&end=3';
  const want = parseMakeFragment(link);
  assert.equal(want.count, 3);
  assert.equal(want.cut, null);
  for (const twice of [encodeURI(link), `https://x.test/make#${encodeURI(link)}`, encodeURIComponent(link)]) {
    const b = parseMakeFragment(twice);
    assert.deepEqual(b.sections, want.sections);
    assert.equal(b.title, 'Tokyo noir');
    assert.deepEqual(b.problems, []);
  }
  assert.equal(items(want)[2].body, 'A cab, 50% rain.\n- Neon');
});

test('limits: cards, pictures, sections, sizes', () => {
  const notes = Array.from({ length: MAKE.maxCards + 5 }, (_, i) => `note=n${i}`).join('&');
  const b = parseMakeFragment(notes);
  assert.equal(b.count, MAKE.maxCards);
  assert.deepEqual(b.problems, [{ code: 'too_many', n: 5 }]);
  const pics = Array.from({ length: MAKE.maxPictures + 2 }, (_, i) => `pic=https://example.com/${i}.jpg`).join('&');
  const p = parseMakeFragment(pics);
  assert.equal(p.pictures, MAKE.maxPictures);
  const secs = Array.from({ length: MAKE.maxSections + 3 }, (_, i) => `section=S${i}&note=x${i}`).join('&');
  const s = parseMakeFragment(secs);
  assert.equal(s.sections.length, MAKE.maxSections);
  assert.equal(s.count, MAKE.maxSections + 3);
  const long = parseMakeFragment(`title=${'t'.repeat(500)}&note=${'b'.repeat(5000)}`);
  assert.equal(long.title.length, MAKE.maxTitle);
  assert.equal(items(long)[0].body.length, MAKE.maxNoteBody);
  assert.equal(parseMakeFragment('x'.repeat(MAKE.maxSource * 2)).count, 0);
});

test('makeLinkFor writes a link that reads back as the same board', () => {
  const board = {
    title: 'Tokyo noir, 1974 — 100% night | rain',
    sections: [
      { name: 'Look', color: '#3f7ab5', items: [
        { kind: 'picture', url: 'https://images.unsplash.com/photo-1?w=1200&q=80', caption: 'Wet street | neon' },
        { kind: 'palette', title: 'Night', swatches: [{ hex: '#101820', name: 'Ink' }, { hex: '#f2aa4c', name: null }] },
      ] },
      { name: 'Story', color: null, items: [
        { kind: 'note', title: 'Logline', body: 'A cabbie & a singer.\n- one\n- two + three' },
        { kind: 'note', title: null, body: 'Plain note' },
      ] },
    ],
  };
  const link = makeLinkFor(board);
  assert.match(link, /^https:\/\/clusters\.soleilpictures\.com\/make#title=/);
  assert.ok(!/\s/.test(link), 'no raw whitespace in a link');
  const back = parseMakeFragment(link);
  assert.equal(back.title, board.title);
  assert.deepEqual(back.sections, board.sections);
  assert.equal(back.cut, null);
  assert.deepEqual(back.problems, []);
});

test('text: headings, notes, pictures, a palette, paragraphs; the AI\'s preamble skipped', () => {
  const b = parseMakeText(`Sure! Here's your board — paste it into Clusters:

# Tokyo noir, 1974

## Look (blue)
![Wet street](https://example.com/street.jpg)
![Neon](<https://example.com/neon.png> "neon sign")
https://images.unsplash.com/photo-1?w=1200
https://example.com/not-a-picture
**Palette:** #101820 Ink, #f2aa4c Sodium

## Story
### Logline
A night-shift cabbie.

Second paragraph of the logline.

**Characters**
- Kenji
- Mariko

A loose paragraph
over two lines.

Another one.
`);
  assert.equal(b.source, 'text');
  assert.equal(b.title, 'Tokyo noir, 1974');
  assert.deepEqual(b.sections.map((s) => [s.name, s.color]), [['Look', '#3f7ab5'], ['Story', null]]);
  assert.deepEqual(b.sections[0].items, [
    { kind: 'picture', url: 'https://example.com/street.jpg', caption: 'Wet street' },
    { kind: 'picture', url: 'https://example.com/neon.png', caption: 'Neon' },
    { kind: 'picture', url: 'https://images.unsplash.com/photo-1?w=1200', caption: null },
    { kind: 'note', title: null, body: 'https://example.com/not-a-picture' },
    { kind: 'palette', title: null, swatches: [{ hex: '#101820', name: 'Ink' }, { hex: '#f2aa4c', name: 'Sodium' }] },
  ]);
  assert.deepEqual(b.sections[1].items, [
    { kind: 'note', title: 'Logline', body: 'A night-shift cabbie.\n\nSecond paragraph of the logline.' },
    { kind: 'note', title: 'Characters', body: '- Kenji\n- Mariko\n\nA loose paragraph\nover two lines.\n\nAnother one.' },
  ]);
});

test('text with no headings is all board; a palette line of colours alone', () => {
  const b = parseMakeText('One note here\n\n#101820 Ink #f2aa4c Sodium\n\n![a](https://example.com/a.jpg)');
  assert.deepEqual(items(b).map((i) => i.kind), ['note', 'palette', 'picture']);
  assert.equal(b.title, null);
  assert.deepEqual(b.sections.map((s) => s.name), [null]);
});

test('a pasted link, or a pasted fragment, is read as a link', () => {
  const link = 'Open it: https://clusters.soleilpictures.com/make#title=A&note=hi&end=1 — enjoy';
  assert.equal(parseMakeText(link).source, 'link');
  assert.equal(parseMakeText(link).title, 'A');
  assert.equal(parseMakeText('title=B&note=x').title, 'B');
  assert.equal(parseMakeSource('#title=C&note=x').title, 'C');
  assert.equal(parseMakeSource('# D\n\nx').title, 'D');
  assert.equal(parseMakeSource('title=E', { kind: 'text' }).title, 'E');
});

test('nothing to read is an empty board, never a throw', () => {
  for (const v of [null, undefined, '', '#', '&&&', '=x', 'title=', 'note=', 'pic=', 42, {}]) {
    const b = parseMakeFragment(v);
    assert.equal(b.count, 0);
    assert.deepEqual(b.sections, []);
    // Text is the person's own paste: whatever it says is a note, but it never throws.
    assert.doesNotThrow(() => parseMakeText(v));
    assert.doesNotThrow(() => parseMakeSource(v));
  }
  assert.equal(parseMakeText('').count, 0);
  assert.equal(parseMakeText('\n\n  \n').count, 0);
});
