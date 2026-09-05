// Unit tests for the AEO retrieval scorer. The parse IS the measurement — if it
// silently returns "not cited" for a shape the API actually sends, the probe
// reports a citation collapse that never happened. Run with:
//   node --test boards/src/lib/aeoScore.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRetrieval, scoreRetrieval } from '../worker-aeo.js';

// The Responses API shape, as documented: an output array carrying a
// web_search_call item and a message item, with url_citation annotations on
// the message's output_text content part.
function response(text, urls) {
  return {
    output: [
      { type: 'web_search_call', id: 'ws_1', status: 'completed',
        action: { type: 'search', query: 'best pureref alternative' } },
      { type: 'message', id: 'msg_1', status: 'completed', role: 'assistant',
        content: [{
          type: 'output_text',
          text,
          annotations: urls.map((u, i) => ({
            type: 'url_citation', start_index: i, end_index: i + 1,
            url: u, title: `Source ${i + 1}`,
          })),
        }] },
    ],
  };
}

test('cited: our domain in the sources, position is its rank', () => {
  const r = scoreRetrieval(response('Some answer.', [
    'https://www.milanote.com/',
    'https://clusters.soleilpictures.com/best/pureref-alternatives',
    'https://storyflow.so/',
  ]));
  assert.equal(r.cited, true);
  assert.equal(r.position, 2);
  assert.equal(r.sources.length, 3);
});

test('position 1 and a deep position are distinguishable', () => {
  assert.equal(scoreRetrieval(response('x', ['https://clusters.soleilpictures.com/'])).position, 1);
  const deep = scoreRetrieval(response('x', [
    'https://a.com/', 'https://b.com/', 'https://c.com/', 'https://d.com/',
    'https://clusters.soleilpictures.com/vs/pureref',
  ]));
  assert.equal(deep.position, 5);
});

test('not cited: no sources at all', () => {
  const r = scoreRetrieval(response('I am not sure.', []));
  assert.equal(r.cited, false);
  assert.equal(r.position, null);
  assert.deepEqual(r.sources, []);
});

// The distinction migration 0296 insists on: a mention that sends nobody is not
// retrieval. The brand name in prose without a link must NOT count.
test('a brand mention with no link is not a citation', () => {
  const r = scoreRetrieval(response(
    'You might look at Soleil Clusters, Milanote, or PureRef.',
    ['https://www.milanote.com/'],
  ));
  assert.equal(r.cited, false);
  // ...but the text is kept, so the mention is still visible to a human reader.
  assert.match(r.excerpt, /Soleil Clusters/);
});

test('the apex domain and subdomains both count as us', () => {
  assert.equal(scoreRetrieval(response('x', ['https://soleilpictures.com/about'])).cited, true);
  assert.equal(scoreRetrieval(response('x', ['https://clusters.soleilpictures.com/'])).cited, true);
});

// A lookalike host must not read as a citation — this is the failure that would
// silently manufacture good news.
test('lookalike hosts are not us', () => {
  for (const u of ['https://soleilpictures.com.evil.test/',
                   'https://notsoleilpictures.com/',
                   'https://soleilpictures.co/']) {
    assert.equal(scoreRetrieval(response('x', [u])).cited, false, u);
  }
});

test('duplicate citations collapse, order is preserved', () => {
  const r = readRetrieval(response('x', [
    'https://a.com/', 'https://a.com/', 'https://clusters.soleilpictures.com/',
  ]));
  assert.equal(r.sources.length, 2);
  assert.equal(r.sources[0].url, 'https://a.com/');
  assert.equal(r.sources[1].url, 'https://clusters.soleilpictures.com/');
});

test('malformed and empty payloads score as not-cited rather than throwing', () => {
  for (const p of [null, undefined, {}, { output: [] }, { output: [{ type: 'message' }] },
                   { output: [{ type: 'message', content: [{ type: 'output_text' }] }] }]) {
    const r = scoreRetrieval(p);
    assert.equal(r.cited, false);
    assert.equal(r.position, null);
  }
});

test('a malformed annotation does not lose the good ones', () => {
  const payload = {
    output: [{ type: 'message', content: [{
      type: 'output_text', text: 'answer',
      annotations: [
        { type: 'url_citation' },                                   // no url
        { type: 'file_citation', url: 'https://ignored.test/' },    // wrong type
        { type: 'url_citation', url: 'https://clusters.soleilpictures.com/' },
      ],
    }] }],
  };
  const r = scoreRetrieval(payload);
  assert.equal(r.cited, true);
  assert.equal(r.position, 1);
});

test('text is concatenated across content parts and capped', () => {
  const payload = {
    output: [{ type: 'message', content: [
      { type: 'output_text', text: 'A'.repeat(1500) },
      { type: 'output_text', text: 'B'.repeat(1500) },
    ] }],
  };
  assert.equal(scoreRetrieval(payload).excerpt.length, 2000);
});
