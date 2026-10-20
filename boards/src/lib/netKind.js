// netKind.js — what kind of network a request came from, as one word.
//
// The Worker reads request.cf.asn and request.cf.asOrganization (who owns the
// address block) and reduces them to one of four kinds before anything leaves
// the edge:
//
//   relay    iCloud Private Relay and Cloudflare WARP egress. Real people whose
//            address says nothing about them.
//   hosting  a cloud or data-centre network: a VPN, a cloud desktop, or a bot.
//            For readers to filter on, never a reason to drop a row: VPNs are
//            people.
//   edu      a university or research network. Some national research networks
//            also carry schools, so this means "an education network", never
//            "a student" and never an age. No school or academy patterns:
//            detecting children is not something this file does.
//   isp      everything else that has an owner.
//
// null when the edge did not say (local dev, the native shells' bundled page).
//
// The owner's name is matched here and goes no further. edgeContext.js puts
// only the kind on the page, so a small company's own network can never be
// named in an analytics row.

export const NET_KINDS = ['relay', 'hosting', 'edu', 'isp'];

// Private Relay's egress operators publish their ranges: Cloudflare, Akamai's
// relay network and Fastly. Cloudflare's also carries WARP.
const RELAY_ASNS = new Set([13335, 36183, 54113]);

// Cloud and data-centre networks, chosen for being unambiguous: none of these
// sells home or mobile service. The VPN-heavy ones (M247, Datacamp) are here
// because that is where most commercial VPN exits are.
const HOSTING_ASNS = new Set([
  16509, 14618,          // Amazon
  15169, 396982,         // Google, Google Cloud
  8075,                  // Microsoft
  32934,                 // Meta's crawlers
  31898,                 // Oracle Cloud
  14061,                 // DigitalOcean
  63949,                 // Linode
  20473,                 // Vultr
  16276,                 // OVH
  24940,                 // Hetzner
  12876,                 // Scaleway
  51167,                 // Contabo
  16265, 60781, 30633,   // Leaseweb
  45102, 37963,          // Alibaba Cloud
  132203,                // Tencent Cloud
  26496,                 // GoDaddy
  36352,                 // ColoCrossing
  53667,                 // FranTech
  62240,                 // Clouvider
  9009,                  // M247
  60068,                 // Datacamp
]);

// National research and education networks whose own address space institutions
// are numbered from, plus the backbones. Networks known to run a schools
// programme are left out on purpose (HEAnet, CENIC, MOREnet, OARnet).
const EDU_ASNS = new Set([
  11537,  // Internet2
  6509,   // CANARIE
  20965,  // GÉANT
  2603,   // NORDUnet
  786,    // Jisc (JANET), UK
  680,    // DFN, Germany
  2200,   // RENATER, France
  1103,   // SURF, Netherlands
  766,    // RedIRIS, Spain
  137,    // GARR, Italy
  559,    // SWITCH, Switzerland
  1853,   // ACOnet, Austria
  2611,   // Belnet, Belgium
  2852,   // CESNET, Czechia
  1653,   // SUNET, Sweden
  224,    // Sikt (UNINETT), Norway
  1741,   // FUNET, Finland
  1835,   // DeiC, Denmark
  5408,   // GRNET, Greece
  2614,   // RoEduNet, Romania
  1930,   // RCTS (FCCN), Portugal
  2108,   // CARNET, Croatia
  2107,   // ARNES, Slovenia
  4538,   // CERNET, China
  2907,   // SINET, Japan
  17579,  // KREONET, Korea
  7575,   // AARNet, Australia
  38022,  // REANNZ, New Zealand
  1916,   // RNP, Brazil
]);

// Higher education by name, in the languages universities register in. Never
// "school" or "academy": in the UK both are secondary schools.
const EDU_ORG = /universit|universid|uniwersytet|üniversite|\buniv\b|\bcollege\b|polytechn|politecnic|hochschule|institute of (?:technology|science)/i;

// A hosting company that is not in the list above, by name. Narrow on purpose:
// "cloud" alone also names ISPs.
const HOSTING_ORG = /\bhosting\b|\bdata ?cent(?:er|re)s?\b|\bcolocation\b|\bvps\b|\bdedicated server/i;

/**
 * @param {number|string|undefined} asn    request.cf.asn
 * @param {string|undefined}        org    request.cf.asOrganization
 * @returns {'relay'|'hosting'|'edu'|'isp'|null}
 */
export function netKind(asn, org) {
  const n = Number(asn);
  if (!Number.isInteger(n) || n <= 0) return null;
  if (RELAY_ASNS.has(n)) return 'relay';
  if (HOSTING_ASNS.has(n)) return 'hosting';
  if (EDU_ASNS.has(n)) return 'edu';
  const name = typeof org === 'string' ? org : '';
  if (EDU_ORG.test(name)) return 'edu';
  if (HOSTING_ORG.test(name)) return 'hosting';
  return 'isp';
}
