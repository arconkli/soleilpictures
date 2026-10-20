// The region and network kind the Worker puts on every page. What matters is
// what can NOT get through: a network's name, a city, or anything that would
// break out of the attribute the Worker appends without escaping.
// Fixture networks use private-use ASNs (64512–65534) and invented names.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { netKind, NET_KINDS } from './netKind.js';
import { edgeContext, edgeContextMeta, parseEdgeContext, CTX_META_NAME } from './edgeContext.js';

test('relay and hosting networks are known by number', () => {
  assert.equal(netKind(13335, 'Cloudflare, Inc.'), 'relay');
  assert.equal(netKind(36183), 'relay');
  assert.equal(netKind(54113), 'relay');
  assert.equal(netKind(16509, 'Amazon.com, Inc.'), 'hosting');
  assert.equal(netKind(14061), 'hosting');
  assert.equal(netKind('24940'), 'hosting', 'a numeric string is still a number');
});

test('education networks by number or by a higher-education name', () => {
  assert.equal(netKind(786, 'Jisc Services Limited'), 'edu');
  assert.equal(netKind(2907), 'edu');
  assert.equal(netKind(64512, 'Example State University'), 'edu');
  assert.equal(netKind(64513, 'Universidad de Ejemplo'), 'edu');
  assert.equal(netKind(64514, 'Exampleton College'), 'edu');
  assert.equal(netKind(64515, 'Example Institute of Technology'), 'edu');
  assert.equal(netKind(64516, 'Univ of Example'), 'edu');
});

test('schools are never detected, and near-miss names stay an ISP', () => {
  assert.equal(netKind(64520, 'Example Academy Trust'), 'isp');
  assert.equal(netKind(64521, 'Example High School District'), 'isp');
  assert.equal(netKind(64522, 'Universal Cable Example'), 'isp');
  assert.equal(netKind(64523, 'Example Cloud Fibre'), 'isp', '"cloud" alone names ISPs too');
  assert.equal(netKind(64524, 'Example Hosting Ltd'), 'hosting');
});

test('no number, no answer', () => {
  for (const asn of [undefined, null, '', 0, -1, 1.5, 'AS13335', NaN]) {
    assert.equal(netKind(asn, 'Example University'), null, String(asn));
  }
});

test('the kind is always one of four words', () => {
  const nasty = ['"><script>alert(1)</script>', "O'Reilly & Sons <ISP>", 'x'.repeat(5000), '\u0000', ''];
  for (const org of nasty) assert.ok(NET_KINDS.includes(netKind(64530, org)), org.slice(0, 20));
});

test('the tag carries a region and a kind, never a name or a city', () => {
  const cf = {
    country: 'US', regionCode: 'CA', city: 'Exampleville', postalCode: '99999',
    latitude: '1.0', longitude: '2.0', asn: 64540, asOrganization: 'Example Widgets LLC',
  };
  assert.equal(edgeContext(cf), 'r=US-CA;n=isp');
  const meta = edgeContextMeta(cf);
  assert.equal(meta, `<meta name="${CTX_META_NAME}" content="r=US-CA;n=isp">`);
  for (const leak of ['Exampleville', '99999', 'Example Widgets', '1.0', '2.0']) {
    assert.ok(!meta.includes(leak), leak);
  }
});

test('a region needs both halves, and hostile values are dropped', () => {
  assert.equal(edgeContext({ country: 'US', asn: 64541 }), 'n=isp', 'no regionCode, no region');
  assert.equal(edgeContext({ regionCode: 'CA', asn: 64541 }), 'n=isp', 'no country, no region');
  assert.equal(edgeContext({ country: 'T1', regionCode: 'X', asn: 64541 }), 'n=isp', 'Tor is not a country');
  assert.equal(edgeContext({ country: 'gb', regionCode: 'eng' }), 'r=GB-ENG', 'case is normalised');
  assert.equal(edgeContext({ country: 'US', regionCode: '"><b>' }), '');
  assert.equal(edgeContext({ country: 'US', regionCode: 'CALI' }), '', 'subdivisions are 1–3 characters');
  assert.equal(edgeContext(undefined), '');
  assert.equal(edgeContext({}), '');
  assert.equal(edgeContextMeta({}), '', 'nothing to say, no tag');
});

test('whatever the edge is handed, the tag cannot break out of its attribute', () => {
  const hostile = ['"', '<', '>', '&', "'", ' onload=x', '\n'];
  for (const h of hostile) {
    const meta = edgeContextMeta({ country: 'US' + h, regionCode: 'CA' + h, asn: 64542, asOrganization: h });
    const content = meta.match(/content="([^"]*)"/);
    assert.ok(!meta || (content && /^[A-Za-z0-9=;-]*$/.test(content[1])), JSON.stringify(meta));
  }
});

test('the reader takes back exactly what the writer can write', () => {
  assert.deepEqual(parseEdgeContext('r=US-CA;n=isp'), { region: 'US-CA', net_kind: 'isp' });
  assert.deepEqual(parseEdgeContext('n=edu'), { region: null, net_kind: 'edu' });
  assert.deepEqual(parseEdgeContext('r=GB-ENG'), { region: 'GB-ENG', net_kind: null });
  for (const bad of ['', null, undefined, 'r=US-CA-SF', 'n=school', 'r=<b>', 'c=US', 'r=us-ca', 'x'.repeat(65),
    'r=US-CA-SF;n=school', `r=US-CA;${'n=isp;'.repeat(12)}`]) {
    assert.deepEqual(parseEdgeContext(bad), { region: null, net_kind: null }, String(bad).slice(0, 30));
  }
  for (const cf of [{ country: 'DE', regionCode: 'BY', asn: 680 }, { country: 'JP', regionCode: '13', asn: 13335 }]) {
    const back = parseEdgeContext(edgeContext(cf));
    assert.equal(back.region, `${cf.country}-${cf.regionCode}`);
    assert.equal(back.net_kind, netKind(cf.asn));
  }
});

test('the Worker hands request.cf to edgeContext and to nothing else', () => {
  const src = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  assert.match(src, /edgeContextMeta\(request\.cf\)/, 'the wrapper builds the tag from request.cf');
  assert.ok(!/asOrganization/.test(src), 'the Worker must not read the network name itself');
  assert.ok(!/\bcf\.(city|postalCode|latitude|longitude|metroCode)\b/.test(src), 'no city or coordinates');
});
