// Per-template builders. Each takes its template-specific data and
// returns { subject, html, text } ready to hand to Resend.
//
// Adding a new template:
//   1. add an entry in TEMPLATE_NAMES + TemplateName
//   2. add a builder function below
//   3. wire it in renderTemplate's switch
//   4. update send-transactional-email's accepted template list

import { renderEmail, renderPlainNote } from "./layout.ts";

export type TemplateName =
  | "waitlist_submitted"
  | "waitlist_accepted"
  | "workspace_invite"
  | "board_shared"
  | "invite_accepted"
  | "pending_invite"
  | "mention_email"
  | "comment_reply_email"
  | "activate_nudge_1"
  | "activate_nudge_2"
  | "reengage_1"
  | "welcome_board"
  | "board_waiting"
  | "nudge_dormant_early"
  | "whats_new";

export const TEMPLATE_NAMES: TemplateName[] = [
  "waitlist_submitted",
  "waitlist_accepted",
  "workspace_invite",
  "board_shared",
  "invite_accepted",
  "pending_invite",
  "mention_email",
  "comment_reply_email",
  "activate_nudge_1",
  "activate_nudge_2",
  "reengage_1",
  "welcome_board",
  "board_waiting",
  "nudge_dormant_early",
  "whats_new",
];

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const SIGN_IN_URL = "https://clusters.soleilpictures.com/sign-in";
const APP_URL     = "https://clusters.soleilpictures.com/";
// The resume page (migration 0235). A CTA carrying a resume token points here
// instead of at the app root: it spends the token on an explicit button press
// and lands the reader signed in, rather than at the OTP wall.
const RESUME_URL  = "https://clusters.soleilpictures.com/resume";

// Build a deep link that AuthGate consumes into localStorage post-sign-in
// so the app lands on the right workspace/board automatically. Extra `utm`
// params survive consumeDeepLink (which strips only ?w/?b) into analytics.js
// last-touch, so lifecycle CTA clicks attribute with no new tracking infra.
//
// With `rt` set the destination changes to /resume, which forwards ?w/?b on to
// the app once the session exists. Win-back recipients average 27 days since
// their last sign-in, so for those types the plain APP_URL was, in practice,
// always a link to a login form.
function deepLink(
  params: { w?: string; b?: string; rt?: string } = {}, utm: Record<string, string> = {},
): string {
  const qs = new URLSearchParams();
  if (params.rt) qs.set("rt", params.rt);
  if (params.w) qs.set("w", params.w);
  if (params.b) qs.set("b", params.b);
  for (const [k, v] of Object.entries(utm)) if (v) qs.set(k, v);
  const tail = qs.toString();
  const base = params.rt ? RESUME_URL : APP_URL;
  return tail ? `${base}?${tail}` : base;
}

// The resume token reaches renderTemplate as untrusted `Record<string, unknown>`
// like every other field, and it is about to be interpolated into a URL in an
// email. The mint is always 64 hex chars (migration 0235); anything else is
// dropped rather than escaped, which degrades the CTA to the plain app link.
function resumeTokenOf(v: unknown): string | undefined {
  const t = v != null ? String(v) : "";
  return /^[0-9a-f]{64}$/.test(t) ? t : undefined;
}

function plain(lines: string[]): string {
  return lines.filter((l) => l !== "").join("\n");
}

// ── Lifecycle "simple note" helpers ─────────────────────────────────────────
const UNSUB_BASE = "https://clusters.soleilpictures.com/api/unsubscribe";

function unsubUrl(token: string): string {
  return `${UNSUB_BASE}?u=${encodeURIComponent(token)}&k=email_lifecycle`;
}

// `lc` rides alongside the UTMs so the APP can record the landing itself.
// Resend proxies every click through its own tracking host, which reports a
// user agent of "Amazon CloudFront" on all of them — bot prefetch and real
// humans are indistinguishable in the click webhook, and click->land can't be
// derived from it at all. A first-party lc= param on arrival is the honest
// signal. Survives consumeDeepLink (which strips only ?w/?b) into analytics.js.
function utm(campaign: string, version?: string): Record<string, string> {
  return {
    utm_source: "email",
    utm_medium: "lifecycle",
    utm_campaign: campaign,
    lc: version ? `${campaign}.${version}` : campaign,
  };
}

const NOTE_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function noteP(text: string): string {
  return `<p style="margin:0 0 18px; font:400 15px/1.65 ${NOTE_FONT}; color:#1a1a1a;">${escapeHtml(text)}</p>`;
}

// The lifecycle CTA. Formerly a bare inline text-link — the founder notes opened
// well (welcome_board ~58%) but almost nobody clicked through, so the CTA is now
// a bulletproof (table-based) button that reads as a real tap target in
// Gmail/Outlook/Apple Mail. A dark pill on the light note background, left-
// aligned to sit in the note's flow (not a centered marketing blast).
//
// The "signed out? we'll email you a 6-digit code" caveat under the button used
// to be unconditional. It was an honest warning about a genuinely bad ending —
// and the ending was the problem, not the warning. A /resume link has no such
// ending, so the caveat is shown only when the CTA is NOT one: minting can fail
// (best-effort, like the thumbnails), and on that path the reader really is
// walking into the OTP wall and deserves to be told.
function noteBtn(label: string, url: string): string {
  const walled = !url.startsWith(RESUME_URL);
  const caveat = walled
    ? `\n                <p style="margin:0 0 18px; font:400 12px/1.5 ${NOTE_FONT}; color:#8a8780;">signed out? we'll email you a 6-digit code — no password to dig up.</p>`
    : "";
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:6px 0 ${walled ? "6px" : "18px"};">
                  <tr>
                    <td bgcolor="#1a1a1a" style="background:#1a1a1a; border-radius:8px;">
                      <a href="${escapeHtml(url)}" style="display:inline-block; padding:0 24px; height:46px; line-height:46px; font:600 15px/46px ${NOTE_FONT}; color:#faf9f7; text-decoration:none; border-radius:8px;">${escapeHtml(label)} &rarr;</a>
                    </td>
                  </tr>
                </table>${caveat}`;
}

// A short bulleted run inside the note body (whats_new's shipped-features
// list). Table rows rather than <ul> — Outlook's list indentation and bullet
// glyph are unreliable, and a hand-rolled middot renders identically anywhere.
function noteList(items: string[]): string {
  if (!items.length) return "";
  const rows = items.map((it) =>
    `<tr><td style="padding:0 0 9px; font:400 15px/1.6 ${NOTE_FONT}; color:#1a1a1a;"><span style="color:#8a8780;">&middot;</span>&nbsp;&nbsp;${escapeHtml(it)}</td></tr>`
  ).join("");
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 18px;">${rows}</table>`;
}

// A linked image inside the note body (welcome_board embeds the user's own
// board thumbnail). width= attribute + inline max-width keep it bounded in
// Outlook and fluid everywhere else.
function noteImg(src: string, alt: string, href: string): string {
  return `<p style="margin:4px 0 18px;"><a href="${escapeHtml(href)}" style="text-decoration:none;"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" width="440" style="width:100%; max-width:440px; height:auto; display:block; border-radius:10px; border:1px solid #e7e4df;"></a></p>`;
}

// ── Factorial copy testing (migration 0219) ─────────────────────────────────
// The four high-volume lifecycle types vary TWO factors independently: the
// SUBJECT arm (subject line + preheader — everything visible before the open)
// and the BODY arm (body copy + CTA label — everything visible after it). The
// cron picks one of each and logs the pair as "<subject>.<body>"; the optimizer
// scores each factor marginally, pooling over the other.
//
// Why split them rather than test whole emails: at ~14 sends/day clicks are far
// too sparse to resolve anything (16 clicks in 5 weeks), but opens are not
// (210). Scoring the subject on opens and the body on click-given-open lets
// each factor learn from the signal dense enough to move it, and testing 5x3
// costs the sample of 5 arms, not 15.
//
// The split is also what makes body scoring honest: opens depend only on the
// subject factor, so conditioning a body's rate on "did they open" doesn't bias
// the comparison between bodies. Keep the preheader with the SUBJECT arm for
// exactly this reason — it's part of the inbox impression, not the body.
type NoteBlock =
  | { k: "p";    t: string }
  | { k: "img" }
  | { k: "btn";  label: string };

// Everything the arms render against. `img` is pre-rendered by the caller (only
// the types that embed the user's own thumbnail ever set it) and is "" when
// there's no thumbnail, so an { k: "img" } block simply drops out.
interface CopyCtx {
  url: string;
  unsub: string;
  name: string | null;
  img: string;
}

interface FactorialSpec {
  subjects: Record<string, (c: CopyCtx) => { subject: string; preheader: string }>;
  bodies:   Record<string, (c: CopyCtx) => NoteBlock[]>;
  s0: string;   // control subject arm; also the legacy/unknown fallback
  b0: string;   // control body arm
}

const SIGNOFF = "talk soon, the clusters team";

// One source for both the HTML and the plaintext part. Every builder used to
// hand-maintain the two in parallel, which is how they drift apart.
function composeNote(blocks: NoteBlock[], c: CopyCtx, preheader: string): { html: string; text: string } {
  const html: string[] = [];
  const text: string[] = [];
  for (const b of blocks) {
    if (b.k === "p") { html.push(noteP(b.t)); text.push(b.t); }
    else if (b.k === "img") { if (c.img) html.push(c.img); }   // no plaintext equivalent
    else { html.push(noteBtn(b.label, c.url)); text.push(`${b.label}: ${c.url}`); }
  }
  return {
    html: renderPlainNote({ preheader, bodyHtml: html.join(""), unsubscribeUrl: c.unsub }),
    text: `${text.join("\n\n")}\n\nUnsubscribe: ${c.unsub}`,
  };
}

// hasOwnProperty rather than a bare index: `variant` reaches here from an
// admin-editable app_config row via two hops, and "constructor" must not
// resolve to something callable.
function armFn<T>(map: Record<string, T>, key: string, fallback: string): T {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : map[fallback];
}

// Resolve "<subject>.<body>" to a rendered email. Legacy flat variants ("A"/"B"
// from before 0219, still carried by in-flight sends and the testTo hook) and
// any arm key the config no longer knows about both fall back to the control
// arms rather than throwing.
function renderFactorial(spec: FactorialSpec, variant: string | undefined, c: CopyCtx): RenderedEmail {
  const v = String(variant ?? "");
  const dot = v.indexOf(".");
  const sFn = armFn(spec.subjects, dot > 0 ? v.slice(0, dot) : "", spec.s0);
  const bFn = armFn(spec.bodies,   dot > 0 ? v.slice(dot + 1) : "", spec.b0);
  const { subject, preheader } = sFn(c);
  const { html, text } = composeNote(bFn(c), c, preheader);
  return { subject, html, text };
}

function waitlistSubmitted(): RenderedEmail {
  return {
    subject: "We got your application — Clusters",
    html: renderEmail({
      preheader: "We got your application. We'll be in touch soon.",
      eyebrow: "Waitlist",
      headline: "We got your application.",
      subtitle: "We're reviewing it now. We'll email you when a spot opens — usually within a few days.",
    }),
    text: plain([
      "CLUSTERS",
      "",
      "We got your application.",
      "We're reviewing it now. We'll email you when a spot opens —",
      "usually within a few days.",
      "",
      "© Soleil Pictures · clusters.soleilpictures.com",
    ]),
  };
}

function waitlistAccepted(): RenderedEmail {
  return {
    subject: "You're in — welcome to Clusters",
    html: renderEmail({
      preheader: "You're in. Your Clusters demo is ready.",
      eyebrow: "Welcome",
      headline: "You're in.",
      subtitle: "Your Clusters demo is ready. Sign in with your email any time.",
      cta: { label: "Open Clusters", url: SIGN_IN_URL },
      caveat: "We'll email you a 6-digit code when you sign in.",
    }),
    text: plain([
      "CLUSTERS",
      "",
      "You're in.",
      "Your Clusters demo is ready. Sign in with your email any time.",
      "",
      "Open Clusters: " + SIGN_IN_URL,
      "",
      "We'll email you a 6-digit code when you sign in.",
      "",
      "© Soleil Pictures · clusters.soleilpictures.com",
    ]),
  };
}

interface WorkspaceInviteData {
  workspaceName: string;
  inviterName: string;
  role?: string;
  workspaceId?: string;
}

function workspaceInvite(d: WorkspaceInviteData): RenderedEmail {
  const role = (d.role || "member").toLowerCase();
  const headline = `You're in ${d.workspaceName}.`;
  const subtitle = `${d.inviterName} added you as ${role} — jump in and build together.`;
  const url = deepLink({ w: d.workspaceId });
  return {
    subject: `${d.inviterName} added you to ${d.workspaceName}`,
    html: renderEmail({
      preheader: subtitle,
      eyebrow: "Workspace",
      headline,
      subtitle,
      cta: { label: "Open workspace", url },
    }),
    text: plain([
      "CLUSTERS",
      "",
      headline,
      subtitle,
      "",
      "Open workspace: " + url,
      "",
      "© Soleil Pictures · clusters.soleilpictures.com",
    ]),
  };
}

interface BoardSharedData {
  boardName: string;
  sharerName: string;
  role?: string;
  workspaceId?: string;
  boardId?: string;
}

function boardShared(d: BoardSharedData): RenderedEmail {
  const role = (d.role || "viewer").toLowerCase();
  const headline = `${d.sharerName} wants to build with you.`;
  const subtitle = `You've got ${role} access to "${d.boardName}" — hop in.`;
  const url = deepLink({ w: d.workspaceId, b: d.boardId });
  return {
    subject: `${d.sharerName} shared "${d.boardName}" with you`,
    html: renderEmail({
      preheader: subtitle,
      eyebrow: "Board shared",
      headline,
      subtitle,
      cta: { label: "Open board", url },
    }),
    text: plain([
      "CLUSTERS",
      "",
      headline,
      subtitle,
      "",
      "Open board: " + url,
      "",
      "© Soleil Pictures · clusters.soleilpictures.com",
    ]),
  };
}

// The inviter's payoff moment: someone they invited (by email or invite
// link) just joined their board. Sent by the share_notifications trigger on
// kind='joined' rows — skipped when the inviter is in-app (the toast covers
// it) or has email_invite_accepted off.
interface InviteAcceptedData {
  joinerName: string;
  boardName: string;
  role?: string;
  workspaceId?: string;
  boardId?: string;
}

function inviteAccepted(d: InviteAcceptedData): RenderedEmail {
  const role = (d.role || "editor").toLowerCase();
  const headline = `${d.joinerName} just joined you.`;
  const subtitle = `They now have ${role} access to "${d.boardName}" — go say hi and build together.`;
  const url = deepLink(
    { w: d.workspaceId, b: d.boardId },
    { utm_source: "email", utm_medium: "transactional", utm_campaign: "invite_accepted" },
  );
  return {
    subject: `${d.joinerName} joined "${d.boardName}"`,
    html: renderEmail({
      preheader: subtitle,
      eyebrow: "They're in",
      headline,
      subtitle,
      cta: { label: "Open board", url },
    }),
    text: plain([
      "CLUSTERS",
      "",
      headline,
      subtitle,
      "",
      "Open board: " + url,
      "",
      "© Soleil Pictures · clusters.soleilpictures.com",
    ]),
  };
}

// Pre-account invite. The recipient doesn't have a Clusters login yet —
// the CTA links to /?invite=<token>, which AuthGate consumes to pre-fill
// the email field and (after OTP signup) claim the invite + redirect.
interface PendingInviteData {
  inviterName: string;
  workspaceName: string;
  boardName?: string;
  role: string;          // 'viewer' | 'editor' | 'workspace'
  token: string;
  expiresAt?: string;    // ISO-8601 (display-only)
}

function pendingInvite(d: PendingInviteData): RenderedEmail {
  const isWorkspace = d.role === "workspace" || !d.boardName;
  const target = isWorkspace
    ? d.workspaceName
    : `"${d.boardName}" in ${d.workspaceName}`;
  const roleLabel = (() => {
    if (d.role === "workspace") return "a member";
    if (d.role === "editor")    return "an editor";
    return "a viewer";
  })();
  const headline = `${d.inviterName} invited you.`;
  const subtitle = `You've been invited to join ${target} as ${roleLabel}. You'll start with 25 free cards — sign in and we'll set up your account.`;
  const url = `${APP_URL}?invite=${encodeURIComponent(d.token)}`;
  return {
    subject: isWorkspace
      ? `${d.inviterName} invited you to ${d.workspaceName} on Clusters`
      : `${d.inviterName} invited you to "${d.boardName}" on Clusters`,
    html: renderEmail({
      preheader: subtitle,
      eyebrow: "Invitation",
      headline,
      subtitle,
      cta: { label: "Accept invitation", url },
      caveat: "We'll email you a 6-digit code to sign in. The invite link works for 30 days.",
    }),
    text: plain([
      "CLUSTERS",
      "",
      headline,
      subtitle,
      "",
      "Accept invitation: " + url,
      "",
      "We'll email you a 6-digit code to sign in. The invite link works for 30 days.",
      "",
      "© Soleil Pictures · clusters.soleilpictures.com",
    ]),
  };
}

interface MentionEmailData {
  mentionerName: string;
  surface: "dm" | "board" | "workspace";
  surfaceContext: string;
  messagePreview: string;
  workspaceId?: string;
  boardId?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function quoteBlock(preview: string): string {
  if (!preview) return "";
  return `<div style="font:400 14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#b3b3b7; font-style:italic; padding:12px 16px; border-left:2px solid #ffa500; background:rgba(255,165,0,0.06); border-radius:0 4px 4px 0; text-align:left;">${escapeHtml(preview)}</div>`;
}

function mentionEmailTpl(d: MentionEmailData): RenderedEmail {
  const subject = d.surface === "dm"
    ? `${d.mentionerName} mentioned you`
    : `${d.mentionerName} mentioned you in ${d.surfaceContext}`;
  const subtitle = d.surface === "dm"
    ? `In a direct message.`
    : `In ${d.surfaceContext}.`;
  // Board mention → land directly on the board. DM/workspace mention →
  // just open the workspace; the user picks the conversation themselves.
  const url = d.surface === "board"
    ? deepLink({ w: d.workspaceId, b: d.boardId })
    : deepLink({ w: d.workspaceId });
  return {
    subject,
    html: renderEmail({
      preheader: `${d.mentionerName}: ${d.messagePreview || "mentioned you"}`,
      eyebrow: "Mention",
      headline: `${d.mentionerName} mentioned you.`,
      subtitle,
      bodyHtml: quoteBlock(d.messagePreview),
      cta: { label: "Open in Clusters", url },
    }),
    text: plain([
      "CLUSTERS",
      "",
      `${d.mentionerName} mentioned you.`,
      subtitle,
      d.messagePreview ? `\n  "${d.messagePreview}"` : "",
      "",
      "Open in Clusters: " + url,
      "",
      "© Soleil Pictures · clusters.soleilpictures.com",
    ]),
  };
}

interface CommentReplyEmailData {
  replierName: string;
  boardName: string;
  workspaceName: string;
  replyPreview: string;
  workspaceId?: string;
  boardId?: string;
}

function commentReplyEmailTpl(d: CommentReplyEmailData): RenderedEmail {
  const subtitle = `On "${d.boardName}" in ${d.workspaceName}.`;
  const url = deepLink({ w: d.workspaceId, b: d.boardId });
  return {
    subject: `${d.replierName} replied to your comment`,
    html: renderEmail({
      preheader: `${d.replierName}: ${d.replyPreview || "replied to your comment"}`,
      eyebrow: "Reply",
      headline: `${d.replierName} replied.`,
      subtitle,
      bodyHtml: quoteBlock(d.replyPreview),
      cta: { label: "Open comment", url },
    }),
    text: plain([
      "CLUSTERS",
      "",
      `${d.replierName} replied.`,
      subtitle,
      d.replyPreview ? `\n  "${d.replyPreview}"` : "",
      "",
      "Open comment: " + url,
      "",
      "© Soleil Pictures · clusters.soleilpictures.com",
    ]),
  };
}

// ── Lifecycle emails (founder-voice plain notes; see migration 0173) ────────
// The bandit (0174) picks which copy a recipient gets. The four high-volume
// types below are factorial as of 0219 — subject and body vary independently
// (see renderFactorial). reengage_1 / board_waiting / whats_new stay flat A/B:
// at 26, 22 and 0 lifetime sends they can't fill five arms, let alone fifteen.
interface ActivateNudgeData {
  workspaceId?: string;
  boardId?: string;     // the user's most recent cluster (nullable — see 0183)
  boardName?: string;   // pre-sanitized in renderTemplate
  unsubscribeToken: string;
  // Single-use /resume token (migration 0235), minted per send by
  // lifecycle-email-cron. Optional: minting is best-effort, and without it the
  // CTA degrades to the plain app URL plus the sign-in caveat.
  resumeToken?: string;
  variant?: string;
}

// "Untitled cluster" reads worse than no name at all in a subject/CTA.
function namedBoard(d: ActivateNudgeData): string | null {
  const n = (d.boardName || "").trim();
  return n && !/^untitled/i.test(n) ? n : null;
}

// Shared CTA for the activation types: name the board when we know it.
function openCta(c: CopyCtx): string {
  return c.name ? `open "${c.name}"` : "open clusters";
}

const activateNudge1Spec: FactorialSpec = {
  s0: "s1", b0: "b1",
  subjects: {
    // The incumbent.
    s1: () => ({
      subject: "your cluster is one photo away",
      preheader: "drop a few photos in — camera roll, screenshots, references — we arrange them.",
    }),
    // Possessive + concrete noun + a plain statement of fact — the shape that
    // beat a vague fragment 51% to 18% on nudge_dormant_early. Tests whether
    // that shape carries to the activation stage.
    s2: (c) => ({
      subject: c.name ? `"${c.name}" is empty` : "your board is empty",
      preheader: "it takes about a minute to fix that.",
    }),
    // A specific number instead of a possession. Previously the 'B' arm here.
    s3: () => ({
      subject: "3 photos is all it takes",
      preheader: "drop three photos onto a board and it becomes something you can use and share.",
    }),
    // Question, no possession — assumes the blocker is not knowing where to begin.
    s4: () => ({
      subject: "stuck on where to start?",
      preheader: "most people just dump their camera roll in. it works.",
    }),
    // Sells the outcome rather than the action.
    s5: () => ({
      subject: "watch your photos arrange themselves",
      preheader: "drop a pile in — clusters lays them out for you.",
    }),
  },
  bodies: {
    // Incumbent body.
    b1: (c) => [
      { k: "p", t: "hey, quick note from the clusters team." },
      { k: "p", t: c.name
        ? `you made "${c.name}" — it's just sitting empty. the fastest way to see what clusters can do: open it and drop in a few photos. camera roll, screenshots, references — we arrange them for you.`
        : "you're in, but your canvas is still empty. drop a few photos on it — camera roll, screenshots, references — and clusters arranges them for you." },
      { k: "p", t: "give it a minute?" },
      { k: "btn", label: openCta(c) },
      { k: "p", t: SIGNOFF },
    ],
    // Brevity arm: three short lines, no preamble, no sign-off. If this wins,
    // length is the lever and it's the cheapest one we have.
    b2: (c) => [
      { k: "p", t: "hey — quick one." },
      { k: "p", t: c.name ? `"${c.name}" is still empty.` : "your board is still empty." },
      { k: "p", t: "drop a few photos in and clusters arranges them for you. that's the whole thing." },
      { k: "btn", label: openCta(c) },
    ],
    // Procedural arm: an exact recipe with a number, rather than a pitch.
    b3: (c) => [
      { k: "p", t: "hey, the clusters team here." },
      { k: "p", t: "the 60-second version of clusters: drop three photos onto a board — camera roll, screenshots, references — and it becomes something you can actually use and share." },
      { k: "p", t: c.name ? `"${c.name}" is ready when you are.` : "your board is ready when you are." },
      { k: "btn", label: "add 3 photos" },
      { k: "p", t: SIGNOFF },
    ],
  },
};

function activateNudge1(d: ActivateNudgeData): RenderedEmail {
  return renderFactorial(activateNudge1Spec, d.variant, {
    url: deepLink({ w: d.workspaceId, b: d.boardId, rt: d.resumeToken }, utm("activate_nudge_1")),
    unsub: unsubUrl(d.unsubscribeToken),
    name: namedBoard(d),
    img: "",
  });
}

const activateNudge2Spec: FactorialSpec = {
  s0: "s1", b0: "b1",
  subjects: {
    // The incumbent.
    s1: () => ({
      subject: "last note from us",
      preheader: "one photo drop is all it takes to see whether clusters clicks for you.",
    }),
    // Possessive + concrete state, same shape as the proven winner.
    s2: (c) => ({
      subject: c.name ? `"${c.name}" is still empty` : "your board is still empty",
      preheader: "one photo drop is all it takes.",
    }),
    // Previously the 'B' arm.
    s3: () => ({
      subject: "before you go",
      preheader: "most people start with one messy photo drop. it sorts itself out from there.",
    }),
    // Asks a real question. On a last-chance send a reply is worth more than a
    // click — it's the only channel that tells us why activation failed.
    s4: () => ({
      subject: "was it not what you expected?",
      preheader: "genuinely asking — a one-line reply helps us more than you'd think.",
    }),
    // Bounds the ask in time and promises to stop.
    s5: () => ({
      subject: "two minutes, then we'll stop",
      preheader: "in and out. if it's not your thing, no hard feelings.",
    }),
  },
  bodies: {
    // Incumbent body.
    b1: (c) => [
      { k: "p", t: "hey again, we'll keep this one short, then we'll leave you be." },
      { k: "p", t: c.name
        ? `"${c.name}" is still waiting. one photo drop is all it takes to see whether clusters clicks for you — everything you add arranges itself into a board you can share.`
        : "your canvas is still waiting. one photo drop is all it takes to see whether clusters clicks for you — everything you add arranges itself into a board you can share." },
      { k: "p", t: "two minutes, in and out. if it's not your kind of thing, genuinely no hard feelings." },
      { k: "btn", label: openCta(c) },
      { k: "p", t: SIGNOFF },
    ],
    // Brevity arm.
    b2: () => [
      { k: "p", t: "hey, last one from us, promise." },
      { k: "p", t: "most people who stick with clusters started with one messy photo drop: a moodboard, a project, a pile of references. it sorts itself out from there." },
      { k: "btn", label: "drop in some photos" },
    ],
    // Reply-ask arm: swaps the click for a question. Deliberately still carries
    // the button, so this measures whether asking a question suppresses clicks
    // — the reply itself lands in the inbox, not in any table we score.
    b3: (c) => [
      { k: "p", t: "hey — last one, and it's a question rather than a nudge." },
      { k: "p", t: c.name
        ? `you set up "${c.name}" and then didn't come back. that's useful information for us, and we'd rather know than guess.`
        : "you signed up and then didn't come back. that's useful information for us, and we'd rather know than guess." },
      { k: "p", t: "was it not what you expected? too much work to start? just bad timing? hit reply — one line is plenty, and it reaches a person." },
      { k: "p", t: "and if you'd rather just have a look instead:" },
      { k: "btn", label: openCta(c) },
      { k: "p", t: SIGNOFF },
    ],
  },
};

function activateNudge2(d: ActivateNudgeData): RenderedEmail {
  return renderFactorial(activateNudge2Spec, d.variant, {
    url: deepLink({ w: d.workspaceId, b: d.boardId, rt: d.resumeToken }, utm("activate_nudge_2")),
    unsub: unsubUrl(d.unsubscribeToken),
    name: namedBoard(d),
    img: "",
  });
}

interface ReengageData {
  workspaceId?: string;
  boardId?: string;
  boardName?: string;   // pre-sanitized in renderTemplate
  unsubscribeToken: string;
  // Single-use /resume token (migration 0235), minted per send by
  // lifecycle-email-cron. Optional: minting is best-effort, and without it the
  // CTA degrades to the plain app URL plus the sign-in caveat.
  resumeToken?: string;
  variant?: string;
}

function reengage1(d: ReengageData): RenderedEmail {
  const url = deepLink({ w: d.workspaceId, b: d.boardId, rt: d.resumeToken }, utm("reengage_1"));
  const unsub = unsubUrl(d.unsubscribeToken);
  const hasName = !!d.boardName;
  if (d.variant === "B") {
    const subjectB  = hasName ? `your board "${d.boardName}" is still here` : "your boards are still here";
    const ctaLabelB = hasName ? `open "${d.boardName}"` : "open my boards";
    const nudge     = hasName
      ? `quick nudge: "${d.boardName}" is still sitting in your workspace.`
      : "quick nudge: your boards are still sitting in your workspace.";
    return {
      subject: subjectB,
      html: renderPlainNote({
        preheader: "the easy place to put whatever's been piling up.",
        bodyHtml:
          noteP("hey, the clusters team here.") +
          noteP(nudge) +
          noteP("if new references or ideas have been piling up, this is the easy place to put them.") +
          noteP("jump back in:") +
          noteBtn(ctaLabelB, url),
        unsubscribeUrl: unsub,
      }),
      text:
`hey, the clusters team here.

${nudge}

if new references or ideas have been piling up, this is the easy place to put them.

jump back in:

${ctaLabelB}: ${url}

Unsubscribe: ${unsub}`,
    };
  }
  const subject  = hasName ? `"${d.boardName}" is right where you left it` : "your board's right where you left it";
  const ctaLabel = hasName ? `open "${d.boardName}"` : "open my board";
  const opener   = hasName
    ? `you built "${d.boardName}" in clusters, then went quiet. happens to the best of us.`
    : "you built something real in clusters, then went quiet. happens to the best of us.";
  return {
    subject,
    html: renderPlainNote({
      preheader: "it's all still there, right where you left it.",
      bodyHtml:
        noteP("hey, the clusters team here.") +
        noteP(opener) +
        noteP("it's all still there, exactly how you left it. no pressure, but if a few new things have piled up since, this is a good moment to drop them in.") +
        noteP("pick up where you left off:") +
        noteBtn(ctaLabel, url),
      unsubscribeUrl: unsub,
    }),
    text:
`hey, the clusters team here.

${opener}

it's all still there, exactly how you left it. no pressure, but if a few new things have piled up since, this is a good moment to drop them in.

pick up where you left off:

${ctaLabel}: ${url}

Unsubscribe: ${unsub}`,
  };
}

// ── welcome_board (migration 0184) ──────────────────────────────────────────
// Day-1 welcome showing the user their OWN board — the strongest pull-back we
// have is a picture of the thing they made. The image URL is computed by
// lifecycle-email-cron (HMAC-signed /api/email-thumb worker route; email
// clients fetch it unauthenticated, possibly weeks after send). Only that
// exact origin/path is ever embedded — anything else renders text-only.
const EMAIL_THUMB_PREFIX = "https://clusters.soleilpictures.com/api/email-thumb/";

interface WelcomeBoardData {
  workspaceId?: string;
  boardId?: string;
  boardName?: string;   // pre-sanitized in renderTemplate
  thumbUrl?: string;    // signed /api/email-thumb URL (cron-computed)
  unsubscribeToken: string;
  // Single-use /resume token (migration 0235), minted per send by
  // lifecycle-email-cron. Optional: minting is best-effort, and without it the
  // CTA degrades to the plain app URL plus the sign-in caveat.
  resumeToken?: string;
  variant?: string;
}

// Besides "Untitled cluster", the auto-created root is always called "Studio"
// — the eligibility RPC can feature it when it's the only populated board,
// and 'you started "Studio"' reads like we named it for them. Fall back to
// no-name copy for both.
function namedWelcomeBoard(d: WelcomeBoardData): string | null {
  const n = (d.boardName || "").trim();
  return n && !/^untitled/i.test(n) && !/^studio$/i.test(n) ? n : null;
}

// A lot of new users sign up on a phone and never see the full app; a quiet,
// device-neutral nudge to open it on a computer (the cron has no device signal,
// so this rides every welcome_board body except the brevity arm).
const DESK_TIP = "one tip: open it on your computer when you can — the full studio, a bigger canvas, every tool.";

const welcomeBoardSpec: FactorialSpec = {
  s0: "s1", b0: "b1",
  subjects: {
    // The incumbent.
    s1: (c) => ({
      subject: c.name ? `"${c.name}" is off to a good start` : "your board is off to a good start",
      preheader: "it's saved and waiting whenever you want to keep going.",
    }),
    // Previously the 'B' arm — credits them rather than the board.
    s2: () => ({
      subject: "look what you made",
      preheader: "one day in, and your board is already taking shape.",
    }),
    // Possessive + concrete noun, and it sets up the thumbnail waiting inside.
    s3: () => ({
      subject: "here's your board",
      preheader: "a picture of it, one day in.",
    }),
    // Utility question that leads with the desktop tip — the one piece of
    // advice in this email that changes what they can actually do.
    s4: () => ({
      subject: "want to see this on a big screen?",
      preheader: "the full studio is on desktop — bigger canvas, every tool.",
    }),
    // Names the next action instead of describing the current state.
    s5: () => ({
      subject: "add three more photos",
      preheader: "it's saved and waiting — a few more and it really takes shape.",
    }),
  },
  bodies: {
    // Incumbent body.
    b1: (c) => [
      { k: "p", t: "hey, the clusters team here." },
      { k: "p", t: c.name
        ? (c.img ? `you started "${c.name}" yesterday — here's how it's looking already.`
                 : `you started "${c.name}" yesterday — it's already taking shape.`)
        : (c.img ? "you started a board yesterday — here's how it's looking already."
                 : "you started a board yesterday — it's already taking shape.") },
      { k: "img" },
      { k: "p", t: "it's saved and waiting whenever you want to keep going — drop in more photos, notes, or files and they arrange themselves." },
      { k: "p", t: DESK_TIP },
      { k: "btn", label: "pick up where you left off" },
      { k: "p", t: SIGNOFF },
    ],
    // Brevity arm — the picture does the work, so this one drops the desk tip
    // and the sign-off and lets the thumbnail sit right under one line.
    b2: (c) => [
      { k: "p", t: c.img
        ? "hey — one day in, and your board already looks like this:"
        : "hey — one day in, and your board is already taking shape." },
      { k: "img" },
      { k: "p", t: c.name
        ? `"${c.name}" is saved and waiting. add a few more photos and watch it take shape.`
        : "it's saved and waiting. add a few more photos and watch it take shape." },
      { k: "btn", label: "keep building" },
    ],
    // Next-step arm: one specific instruction rather than an open invitation.
    b3: (c) => [
      { k: "p", t: "hey, the clusters team here." },
      { k: "p", t: c.img ? "here's your board as of yesterday:" : "your board's up and running as of yesterday." },
      { k: "img" },
      { k: "p", t: "the single best next move: open your camera roll and drag in ten photos at once. clusters lays them out, and that's usually the moment it clicks." },
      { k: "p", t: DESK_TIP },
      { k: "btn", label: "add ten photos" },
      { k: "p", t: SIGNOFF },
    ],
  },
};

function welcomeBoard(d: WelcomeBoardData): RenderedEmail {
  const url = deepLink({ w: d.workspaceId, b: d.boardId, rt: d.resumeToken }, utm("welcome_board"));
  const name = namedWelcomeBoard(d);
  return renderFactorial(welcomeBoardSpec, d.variant, {
    url,
    unsub: unsubUrl(d.unsubscribeToken),
    name,
    img: d.thumbUrl && d.thumbUrl.startsWith(EMAIL_THUMB_PREFIX)
      ? noteImg(d.thumbUrl, name ? `Your board "${name}"` : "Your board", url)
      : "",
  });
}

// ── board_waiting (migration 0194) ──────────────────────────────────────────
// The picture-powered win-back: an activated user who built a real board and
// then went quiet (~14d). Same own-thumbnail pull as welcome_board, but framed
// as "it's still here" rather than "look what you made". Sits above reengage_1
// in the cron priority (reengage_1 is the text fallback for dormant users whose
// board has no stored thumbnail). Reuses WelcomeBoardData — identical shape.
function boardWaiting(d: WelcomeBoardData): RenderedEmail {
  const url = deepLink({ w: d.workspaceId, b: d.boardId, rt: d.resumeToken }, utm("board_waiting"));
  const unsub = unsubUrl(d.unsubscribeToken);
  const name = namedWelcomeBoard(d);
  const img = d.thumbUrl && d.thumbUrl.startsWith(EMAIL_THUMB_PREFIX)
    ? noteImg(d.thumbUrl, name ? `Your board "${name}"` : "Your board", url)
    : "";
  const cta = name ? `open "${name}"` : "open my board";
  if (d.variant === "B") {
    const line = name
      ? `"${name}" is still here — right where you left it.`
      : "your board is still here — right where you left it.";
    return {
      subject: name ? `remember "${name}"?` : "remember your board?",
      html: renderPlainNote({
        preheader: "it's all still there, right where you left it.",
        bodyHtml:
          noteP("hey, the clusters team here.") +
          noteP("popping back in with a picture — it's the fastest way to say it:") +
          img +
          noteP(line) +
          noteP("if references or ideas have been piling up since, this is the easy place to put them.") +
          noteBtn(cta, url) +
          noteP("talk soon, the clusters team"),
        unsubscribeUrl: unsub,
      }),
      text:
`hey, the clusters team here.

popping back in with a picture — it's the fastest way to say it:

${line}

if references or ideas have been piling up since, this is the easy place to put them.

${cta}: ${url}

talk soon, the clusters team

Unsubscribe: ${unsub}`,
    };
  }
  const opener = name
    ? (img ? `remember "${name}"? here's how you left it:` : `remember "${name}"? it's still sitting in your workspace.`)
    : (img ? "remember this? here's how you left it:" : "your board's still sitting in your workspace.");
  return {
    subject: name ? `"${name}" is still taking shape` : "your board is still taking shape",
    html: renderPlainNote({
      preheader: "it's saved and waiting whenever you want to pick it back up.",
      bodyHtml:
        noteP("hey, the clusters team here.") +
        noteP(opener) +
        img +
        noteP("it's all saved, exactly how you left it. no pressure — but if a few new things have piled up since, this is a good moment to drop them in.") +
        noteBtn(cta, url) +
        noteP("talk soon, the clusters team"),
      unsubscribeUrl: unsub,
    }),
    text:
`hey, the clusters team here.

${opener}

it's all saved, exactly how you left it. no pressure — but if a few new things have piled up since, this is a good moment to drop them in.

${cta}: ${url}

talk soon, the clusters team

Unsubscribe: ${unsub}`,
  };
}

// ── nudge_dormant_early (migration 0194) ────────────────────────────────────
// The gap-filler: a never-activated user who fell quiet AFTER the activation-
// nudge window closed (activate_nudge_2 stops at day 14). reengage_1 gates on
// first_populated_board_at, so these users otherwise get nothing ever again.
// Gentle, low-pressure, activation-agnostic. Reuses ActivateNudgeData.
//
// The subject arms here are the reason 0219 exists. Over 167 delivered sends,
// "your workspace is still here" opened at 51.4% and "still here whenever you
// want it" at 17.7% — z ≈ 4.9, holding in every week independently and within
// gmail.com alone. The loser is deleted rather than kept as a control: the
// result is settled, and every send spent re-confirming it is a send wasted.
//
// The surviving arms test WHY it won. s1 is the incumbent; s2 keeps its shape
// but swaps the generic noun for the board's own name (specificity vs mere
// possession); s3/s4/s5 drop possession entirely for a question, a value
// framing and pure brevity. If the possession arms beat all three, the pattern
// generalises and should be applied everywhere.
const nudgeDormantEarlySpec: FactorialSpec = {
  s0: "s1", b0: "b1",
  subjects: {
    s1: () => ({
      subject: "your workspace is still here",
      preheader: "it's saved and waiting whenever you want to give it another look.",
    }),
    s2: (c) => ({
      subject: c.name ? `"${c.name}" is still here` : "your board is still here",
      preheader: "it's saved and waiting whenever you want to give it another look.",
    }),
    s3: () => ({
      subject: "did clusters not click?",
      preheader: "genuinely asking — it helps us know what to fix.",
    }),
    // These users never activated, so "what it's for" may land harder than
    // "what you left" — there is nothing of theirs to come back to.
    s4: () => ({
      subject: "what clusters is actually for",
      preheader: "the 60-second version, in case it never landed.",
    }),
    s5: () => ({
      subject: "one quick thing",
      preheader: "your workspace is saved and waiting.",
    }),
  },
  bodies: {
    // Incumbent body.
    b1: (c) => [
      { k: "p", t: "hey, quick note from the clusters team." },
      { k: "p", t: c.name
        ? `you started "${c.name}" a little while back, then things went quiet — no worries at all.`
        : "you set up a workspace a little while back, then things went quiet — no worries at all." },
      { k: "p", t: "the whole idea of clusters: drop in photos, notes, or files — camera roll, screenshots, references — and they arrange themselves into something you can actually use and share. two minutes is enough to see if it clicks." },
      { k: "btn", label: openCta(c) },
      { k: "p", t: SIGNOFF },
    ],
    // Brevity arm.
    b2: (c) => [
      { k: "p", t: "hey — quick one." },
      { k: "p", t: c.name ? `"${c.name}" is still saved, still empty.` : "your workspace is still saved, still empty." },
      { k: "p", t: "drop a few photos in and clusters arranges them for you. that's the whole thing." },
      { k: "btn", label: openCta(c) },
    ],
    // Procedural arm: the exact motion and what they'll see, rather than a
    // description of the idea. Aimed at users who never understood the product,
    // which is most of this audience.
    b3: (c) => [
      { k: "p", t: "hey, the clusters team here." },
      { k: "p", t: "here's the fastest possible version: open your board, select ten photos from your camera roll, drag them in. they land in a grid you can push around, group, and share as a link." },
      { k: "p", t: "no setup, no folders, nothing to name." },
      { k: "btn", label: openCta(c) },
      { k: "p", t: SIGNOFF },
    ],
  },
};

function nudgeDormantEarly(d: ActivateNudgeData): RenderedEmail {
  return renderFactorial(nudgeDormantEarlySpec, d.variant, {
    url: deepLink({ w: d.workspaceId, b: d.boardId, rt: d.resumeToken }, utm("nudge_dormant_early")),
    unsub: unsubUrl(d.unsubscribeToken),
    name: namedBoard(d),
    img: "",
  });
}

// ── whats_new (migration 0211) ──────────────────────────────────────────────
// The news win-back. Every other dormant email says a version of "your stuff is
// still here" — a status report, which for the ~172 never-activated dormant
// users describes nothing they ever had. This one carries the only thing that
// reliably earns a click from someone 30+ days gone: information they don't
// have yet. Copy comes from app_config 'lifecycle_whats_new' so publishing an
// edition is a row update, not a deploy.
//
// Two pictures may be in play and they are NOT interchangeable:
//   • imageUrl  — the product screenshot for this edition (may be absent; an
//                 edition is allowed to ship before its screenshot exists).
//   • thumbUrl  — the user's OWN board, the one personalisation with evidence
//                 behind it (welcome_board opens at 52.6%, board_waiting 48.0%).
// Whichever exists leads; if both do, the product shot leads and their board
// follows as the closing "and yours is still here" beat.
const EMAIL_ASSET_PREFIX = "https://clusters.soleilpictures.com/email/";

interface WhatsNewData {
  workspaceId?: string;
  boardId?: string;
  boardName?: string;   // pre-sanitized in renderTemplate
  thumbUrl?: string;    // signed /api/email-thumb URL (cron-computed)
  imageUrl?: string;    // product screenshot for this edition (may be absent)
  items: string[];
  ctaLabel?: string;
  version?: string;
  unsubscribeToken: string;
  // Single-use /resume token (migration 0235), minted per send by
  // lifecycle-email-cron. Optional: minting is best-effort, and without it the
  // CTA degrades to the plain app URL plus the sign-in caveat.
  resumeToken?: string;
  variant?: string;
}

const COUNT_WORDS = ["", "one", "two", "three", "four", "five", "six"];

function whatsNew(d: WhatsNewData): RenderedEmail {
  const url = deepLink({ w: d.workspaceId, b: d.boardId, rt: d.resumeToken }, utm("whats_new", d.version));
  const unsub = unsubUrl(d.unsubscribeToken);
  const items = d.items.filter((s) => !!s && !!s.trim()).slice(0, 6);
  const name = namedWelcomeBoard(d);
  const cta = d.ctaLabel && d.ctaLabel.trim() ? d.ctaLabel.trim() : "take a look";

  // Both prefixes are exact-origin checks: these URLs are embedded in mail that
  // clients fetch unauthenticated, so anything else degrades to text.
  const productImg = d.imageUrl && d.imageUrl.startsWith(EMAIL_ASSET_PREFIX)
    ? noteImg(d.imageUrl, "What's new in Clusters", url)
    : "";
  const ownImg = d.thumbUrl && d.thumbUrl.startsWith(EMAIL_THUMB_PREFIX)
    ? noteImg(d.thumbUrl, name ? `Your board "${name}"` : "Your board", url)
    : "";

  const countWord = COUNT_WORDS[items.length] || "a few";
  const yours = name
    ? `and "${name}" is still there, exactly how you left it.`
    : "and your workspace is still there, exactly how you left it.";
  const itemsText = items.map((i) => `· ${i}`).join("\n");

  if (d.variant === "B") {
    return {
      subject: "a few things shipped while you were away",
      html: renderPlainNote({
        preheader: "a quick note on what's changed in clusters lately.",
        bodyHtml:
          noteP("hey, the clusters team here.") +
          noteP("you've been away a bit, so here's the short version of what's changed:") +
          productImg +
          noteList(items) +
          (ownImg ? noteP(yours) + ownImg : noteP(yours)) +
          noteBtn(cta, url) +
          noteP("talk soon, the clusters team"),
        unsubscribeUrl: unsub,
      }),
      text:
`hey, the clusters team here.

you've been away a bit, so here's the short version of what's changed:

${itemsText}

${yours}

${cta}: ${url}

talk soon, the clusters team

Unsubscribe: ${unsub}`,
    };
  }

  return {
    subject: `${countWord} new things in clusters since you left`,
    html: renderPlainNote({
      preheader: "a few things have shipped since you were last here.",
      bodyHtml:
        noteP("hey, the clusters team here.") +
        noteP("it's been a little while — a few things have shipped since you were last in:") +
        productImg +
        noteList(items) +
        (ownImg ? noteP(yours) + ownImg : noteP(yours)) +
        noteBtn(cta, url) +
        noteP("talk soon, the clusters team"),
      unsubscribeUrl: unsub,
    }),
    text:
`hey, the clusters team here.

it's been a little while — a few things have shipped since you were last in:

${itemsText}

${yours}

${cta}: ${url}

talk soon, the clusters team

Unsubscribe: ${unsub}`,
  };
}

export function renderTemplate(name: TemplateName, data: Record<string, unknown>): RenderedEmail {
  switch (name) {
    case "waitlist_submitted":
      return waitlistSubmitted();
    case "waitlist_accepted":
      return waitlistAccepted();
    case "workspace_invite":
      return workspaceInvite({
        workspaceName: String(data.workspaceName ?? "your workspace"),
        inviterName:   String(data.inviterName   ?? "Someone"),
        role:          data.role != null ? String(data.role) : undefined,
        workspaceId:   data.workspaceId != null ? String(data.workspaceId) : undefined,
      });
    case "board_shared":
      return boardShared({
        boardName:   String(data.boardName  ?? "a board"),
        sharerName:  String(data.sharerName ?? "Someone"),
        role:        data.role != null ? String(data.role) : undefined,
        workspaceId: data.workspaceId != null ? String(data.workspaceId) : undefined,
        boardId:     data.boardId != null ? String(data.boardId) : undefined,
      });
    case "invite_accepted":
      return inviteAccepted({
        joinerName:  String(data.joinerName ?? "Someone"),
        boardName:   String(data.boardName  ?? "a board"),
        role:        data.role != null ? String(data.role) : undefined,
        workspaceId: data.workspaceId != null ? String(data.workspaceId) : undefined,
        boardId:     data.boardId != null ? String(data.boardId) : undefined,
      });
    case "pending_invite":
      return pendingInvite({
        inviterName:   String(data.inviterName   ?? "Someone"),
        workspaceName: String(data.workspaceName ?? "a workspace"),
        boardName:     data.boardName != null ? String(data.boardName) : undefined,
        role:          String(data.role ?? "viewer"),
        token:         String(data.token ?? ""),
        expiresAt:     data.expiresAt != null ? String(data.expiresAt) : undefined,
      });
    case "mention_email": {
      const surfaceRaw = String(data.surface ?? "workspace");
      const surface = (surfaceRaw === "dm" || surfaceRaw === "board" || surfaceRaw === "workspace")
        ? surfaceRaw : "workspace";
      return mentionEmailTpl({
        mentionerName:  String(data.mentionerName  ?? "Someone"),
        surface,
        surfaceContext: String(data.surfaceContext ?? "your workspace"),
        messagePreview: String(data.messagePreview ?? ""),
        workspaceId:    data.workspaceId != null ? String(data.workspaceId) : undefined,
        boardId:        data.boardId != null ? String(data.boardId) : undefined,
      });
    }
    case "comment_reply_email":
      return commentReplyEmailTpl({
        replierName:   String(data.replierName   ?? "Someone"),
        boardName:     String(data.boardName     ?? "a board"),
        workspaceName: String(data.workspaceName ?? "your workspace"),
        replyPreview:  String(data.replyPreview  ?? ""),
        workspaceId:   data.workspaceId != null ? String(data.workspaceId) : undefined,
        boardId:       data.boardId != null ? String(data.boardId) : undefined,
      });
    case "activate_nudge_1":
    case "activate_nudge_2": {
      const nudgeBoardName = String(data.boardName ?? "").replace(/[\r\n]/g, "").slice(0, 80).trim();
      const nudgeData = {
        workspaceId:      data.workspaceId != null ? String(data.workspaceId) : undefined,
        boardId:          data.boardId != null ? String(data.boardId) : undefined,
        boardName:        nudgeBoardName || undefined,
        unsubscribeToken: String(data.unsubscribeToken ?? ""),
        resumeToken:      resumeTokenOf(data.resumeToken),
        variant:          data.variant != null ? String(data.variant) : undefined,
      };
      return name === "activate_nudge_1" ? activateNudge1(nudgeData) : activateNudge2(nudgeData);
    }
    case "reengage_1": {
      const boardName = String(data.boardName ?? "").replace(/[\r\n]/g, "").slice(0, 80).trim();
      return reengage1({
        workspaceId:      data.workspaceId != null ? String(data.workspaceId) : undefined,
        boardId:          data.boardId != null ? String(data.boardId) : undefined,
        boardName:        boardName || undefined,
        unsubscribeToken: String(data.unsubscribeToken ?? ""),
        resumeToken:      resumeTokenOf(data.resumeToken),
        variant:          data.variant != null ? String(data.variant) : undefined,
      });
    }
    case "welcome_board": {
      const boardName = String(data.boardName ?? "").replace(/[\r\n]/g, "").slice(0, 80).trim();
      return welcomeBoard({
        workspaceId:      data.workspaceId != null ? String(data.workspaceId) : undefined,
        boardId:          data.boardId != null ? String(data.boardId) : undefined,
        boardName:        boardName || undefined,
        thumbUrl:         data.thumbUrl != null ? String(data.thumbUrl) : undefined,
        unsubscribeToken: String(data.unsubscribeToken ?? ""),
        resumeToken:      resumeTokenOf(data.resumeToken),
        variant:          data.variant != null ? String(data.variant) : undefined,
      });
    }
    case "board_waiting": {
      const boardName = String(data.boardName ?? "").replace(/[\r\n]/g, "").slice(0, 80).trim();
      return boardWaiting({
        workspaceId:      data.workspaceId != null ? String(data.workspaceId) : undefined,
        boardId:          data.boardId != null ? String(data.boardId) : undefined,
        boardName:        boardName || undefined,
        thumbUrl:         data.thumbUrl != null ? String(data.thumbUrl) : undefined,
        unsubscribeToken: String(data.unsubscribeToken ?? ""),
        resumeToken:      resumeTokenOf(data.resumeToken),
        variant:          data.variant != null ? String(data.variant) : undefined,
      });
    }
    case "whats_new": {
      const boardName = String(data.boardName ?? "").replace(/[\r\n]/g, "").slice(0, 80).trim();
      // items come from an admin-edited app_config row, so they get the same
      // newline-stripping / length-clamping every other free-text field gets
      // before it reaches a subject line or an HTML body.
      const rawItems = Array.isArray(data.items) ? data.items : [];
      const items = rawItems
        .map((i) => String(i ?? "").replace(/[\r\n]/g, "").slice(0, 120).trim())
        .filter((i) => i.length > 0);
      return whatsNew({
        workspaceId:      data.workspaceId != null ? String(data.workspaceId) : undefined,
        boardId:          data.boardId != null ? String(data.boardId) : undefined,
        boardName:        boardName || undefined,
        thumbUrl:         data.thumbUrl != null ? String(data.thumbUrl) : undefined,
        imageUrl:         data.imageUrl != null ? String(data.imageUrl) : undefined,
        items,
        ctaLabel:         data.ctaLabel != null ? String(data.ctaLabel).replace(/[\r\n]/g, "").slice(0, 40) : undefined,
        version:          data.version != null ? String(data.version).replace(/[^A-Za-z0-9._-]/g, "").slice(0, 32) : undefined,
        unsubscribeToken: String(data.unsubscribeToken ?? ""),
        resumeToken:      resumeTokenOf(data.resumeToken),
        variant:          data.variant != null ? String(data.variant) : undefined,
      });
    }
    case "nudge_dormant_early": {
      const boardName = String(data.boardName ?? "").replace(/[\r\n]/g, "").slice(0, 80).trim();
      return nudgeDormantEarly({
        workspaceId:      data.workspaceId != null ? String(data.workspaceId) : undefined,
        boardId:          data.boardId != null ? String(data.boardId) : undefined,
        boardName:        boardName || undefined,
        unsubscribeToken: String(data.unsubscribeToken ?? ""),
        resumeToken:      resumeTokenOf(data.resumeToken),
        variant:          data.variant != null ? String(data.variant) : undefined,
      });
    }
  }
}
