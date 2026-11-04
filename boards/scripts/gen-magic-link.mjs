// Generates supabase/templates/magic_link.html from the shared email look
// (supabase/functions/_shared/email/theme.ts), so the sign-in code email can
// never drift from the rest.
//
//   node scripts/gen-magic-link.mjs           write the template
//   node scripts/gen-magic-link.mjs --check   exit 1 if the committed file differs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { shell, eyebrow, h1, lead, codeTile, small, footerTx } from "../../supabase/functions/_shared/email/theme.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const MAGIC_LINK_PATH = resolve(HERE, "../../supabase/templates/magic_link.html");

const COMMENT = `<!--
  Soleil Clusters — Magic Link / OTP email template (dark, brand-true).

  GENERATED. The look comes from supabase/functions/_shared/email/theme.ts;
  regenerate with \`node scripts/gen-magic-link.mjs\` from boards/. Do not edit
  this file by hand. After changing it, paste the file into Supabase Dashboard
  → Authentication → Emails → "Magic link".

  Subject (the Dashboard's subject field):
      {{ .Token }} is your Clusters sign-in code
  The code in the subject shows on a phone's lock screen and in the inbox
  list, so it can be read without opening the mail app and finding this
  message. GoTrue renders the subject with the same data as the body; its own
  reauthentication email does exactly this.

  "It works for an hour" below must match Email OTP Expiration in the
  Dashboard (Authentication → Sign In / Providers → Email): 3600 seconds. The
  app remembers the code step for the same hour (boards/src/lib/pendingCode.js).
  Asking for a new code kills the one before it, so the body says so.

  Token renders via {{ .Token }}. We do NOT include the ConfirmationURL field
  on purpose — disposable / corporate email scanners prefetch links and
  consume one-time tokens, blowing up the OTP flow.
-->`;

export function buildMagicLinkHtml() {
  const body = [
    eyebrow("Sign-in code", "center"),
    h1("Here's your code.", "center"),
    lead("Enter this 6-digit code on the sign-in screen.", "center"),
    codeTile("{{ .Token }}"),
    small("It works for an hour. Asked for more than one? Only the newest works. Didn't request this? You can safely ignore this email.", "center"),
  ].join("\n        ");
  const html = shell({
    title: "Your Clusters sign-in code",
    preheader: "Your Clusters sign-in code: {{ .Token }}",
    body,
    footer: footerTx(),
  });
  return html.replace("<!DOCTYPE html>\n", `<!DOCTYPE html>\n${COMMENT}\n`) + "\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = buildMagicLinkHtml();
  if (process.argv.includes("--check")) {
    let cur = "";
    try { cur = readFileSync(MAGIC_LINK_PATH, "utf8"); } catch {}
    if (cur !== out) { console.error("magic_link.html is stale: run node scripts/gen-magic-link.mjs"); process.exit(1); }
  } else {
    writeFileSync(MAGIC_LINK_PATH, out);
  }
}
