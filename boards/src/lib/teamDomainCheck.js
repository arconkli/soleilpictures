// teamDomainCheck — reading a TXT answer from DNS over HTTPS (the JSON form
// cloudflare-dns.com serves), for the Team domain check (worker-team.js).
// Pure, so node can test it.

export const DOH_URL = 'https://cloudflare-dns.com/dns-query';

export function dohUrl(name) {
  return `${DOH_URL}?name=${encodeURIComponent(name)}&type=TXT`;
}

// Every TXT record in an answer. A long record arrives as several quoted
// strings ("abc" "def"), which DNS means as one, so they are joined.
export function txtAnswers(dnsJson) {
  const out = [];
  for (const a of Array.isArray(dnsJson?.Answer) ? dnsJson.Answer : []) {
    if (a?.type !== 16 || typeof a.data !== 'string') continue;
    const parts = [...a.data.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\(.)/g, '$1'));
    out.push(parts.length ? parts.join('') : a.data.trim());
  }
  return out;
}

// DNS answered for certain: NOERROR (0) or NXDOMAIN (3). SERVFAIL, a refusal
// or a timeout upstream says nothing about the record, so nothing changes on it.
export function dnsAnswered(dnsJson) {
  return dnsJson?.Status === 0 || dnsJson?.Status === 3;
}

export function domainMatches(answers, value) {
  return typeof value === 'string' && value !== '' && answers.some((t) => t.trim() === value);
}
