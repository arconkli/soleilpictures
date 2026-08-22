// Scout service configuration.
//
// The shared ingest modules under boards/src/lib/scout*.js take an `env` object
// rather than reading process.env directly, so they run unchanged in a Worker
// (where env is a bindings object) and here. This builds that object once.

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`scout: missing required env ${name}`);
  return v;
}

export function loadConfig() {
  return {
    // Supabase — service role. Everything the ingest core does is server-side.
    SUPABASE_URL: need('SUPABASE_URL'),
    SUPABASE_ANON_KEY: need('SUPABASE_ANON_KEY'),
    SUPABASE_SERVICE_ROLE_KEY: need('SUPABASE_SERVICE_ROLE_KEY'),

    // PartyKit — the live Yjs peer, so cards land on an already-open canvas.
    PARTYKIT_HOST: process.env.PARTYKIT_HOST || 'soleil-boards-party.arconkli.partykit.dev',

    // Workers AI over REST. There's no `AI` binding outside a Worker, so
    // scoutIntent.js falls back to this. Absent → deterministic intent, which
    // still produces a usable board.
    CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID || null,
    CF_AI_TOKEN: process.env.CF_AI_TOKEN || null,

    // R2, via the same S3 credentials the seed scripts and PartyKit use.
    R2_ACCOUNT_ID: need('R2_ACCOUNT_ID'),
    R2_BUCKET: process.env.R2_BUCKET || 'soleil-boards-images',
    R2_ACCESS_KEY_ID: need('R2_ACCESS_KEY_ID'),
    R2_SECRET_ACCESS_KEY: need('R2_SECRET_ACCESS_KEY'),

    // Photon / Spectrum.
    SPECTRUM_PROJECT_ID: need('SPECTRUM_PROJECT_ID'),
    SPECTRUM_PROJECT_SECRET: need('SPECTRUM_PROJECT_SECRET'),

    APP_ORIGIN: process.env.APP_ORIGIN || 'https://clusters.soleilpictures.com',

    // How long to wait for a burst to finish before writing. A 12-photo dump
    // arrives as 12 separate messages; without this the user gets 12 replies
    // and 12 separate layout passes.
    BURST_MS: Number(process.env.SCOUT_BURST_MS || 20_000),

    // Per-identity daily ceiling. Independent of the card cap — this is abuse
    // protection, not monetization. The card cap stops a FREE account at 50;
    // it does not bound a paid one at all, and a texting endpoint with no
    // ceiling is an unbounded R2 bill. Enforced in the capacity pre-flight.
    DAILY_INGEST_MAX: Number(process.env.SCOUT_DAILY_INGEST_MAX || 500),

    // The invite drain — the ONLY part of this process that texts a stranger
    // rather than answering someone who texted first.
    //
    // It is a kill switch because of how it is normally exercised: the way you
    // test Scout is to run this process on a laptop against the live Photon
    // line. Without a switch that also drains the real signup queue and texts
    // real people from a development machine, which is not a mistake you get to
    // make twice — Photon documents burst sending as a cause of line flagging,
    // and Scout has exactly one line.
    //
    // Defaults ON so the deployed machine behaves as before; local runs set
    // SCOUT_INVITES_ENABLED=0. Anything other than "0"/"false" is on, so a typo
    // fails toward the deployed behaviour rather than silently disabling the
    // queue in production.
    INVITES_ENABLED: !/^(0|false|no|off)$/i.test(String(process.env.SCOUT_INVITES_ENABLED ?? '1')),
  };
}
