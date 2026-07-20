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
  | "nudge_dormant_early";

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
];

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const SIGN_IN_URL = "https://clusters.soleilpictures.com/sign-in";
const APP_URL     = "https://clusters.soleilpictures.com/";

// Build a deep link that AuthGate consumes into localStorage post-sign-in
// so the app lands on the right workspace/board automatically. Extra `utm`
// params survive consumeDeepLink (which strips only ?w/?b) into analytics.js
// last-touch, so lifecycle CTA clicks attribute with no new tracking infra.
function deepLink(params: { w?: string; b?: string } = {}, utm: Record<string, string> = {}): string {
  const qs = new URLSearchParams();
  if (params.w) qs.set("w", params.w);
  if (params.b) qs.set("b", params.b);
  for (const [k, v] of Object.entries(utm)) if (v) qs.set(k, v);
  const tail = qs.toString();
  return tail ? `${APP_URL}?${tail}` : APP_URL;
}

function plain(lines: string[]): string {
  return lines.filter((l) => l !== "").join("\n");
}

// ── Lifecycle "simple note" helpers ─────────────────────────────────────────
const UNSUB_BASE = "https://clusters.soleilpictures.com/api/unsubscribe";

function unsubUrl(token: string): string {
  return `${UNSUB_BASE}?u=${encodeURIComponent(token)}&k=email_lifecycle`;
}

function utm(campaign: string): Record<string, string> {
  return { utm_source: "email", utm_medium: "lifecycle", utm_campaign: campaign };
}

const NOTE_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function noteP(text: string): string {
  return `<p style="margin:0 0 18px; font:400 15px/1.65 ${NOTE_FONT}; color:#1a1a1a;">${escapeHtml(text)}</p>`;
}

// The lifecycle CTA. Formerly a bare inline text-link — the founder notes opened
// well (welcome_board ~58%) but almost nobody clicked through, so the CTA is now
// a bulletproof (table-based) button that reads as a real tap target in
// Gmail/Outlook/Apple Mail. A dark pill on the light note background, left-
// aligned to sit in the note's flow (not a centered marketing blast). The muted
// caveat under it heads off the dead-end when a lapsed session lands the click
// on the sign-in wall: the deep link is preserved through OTP either way.
function noteBtn(label: string, url: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:6px 0 6px;">
                  <tr>
                    <td bgcolor="#1a1a1a" style="background:#1a1a1a; border-radius:8px;">
                      <a href="${escapeHtml(url)}" style="display:inline-block; padding:0 24px; height:46px; line-height:46px; font:600 15px/46px ${NOTE_FONT}; color:#faf9f7; text-decoration:none; border-radius:8px;">${escapeHtml(label)} &rarr;</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 18px; font:400 12px/1.5 ${NOTE_FONT}; color:#8a8780;">signed out? we'll email you a 6-digit code — no password to dig up.</p>`;
}

// A linked image inside the note body (welcome_board embeds the user's own
// board thumbnail). width= attribute + inline max-width keep it bounded in
// Outlook and fluid everywhere else.
function noteImg(src: string, alt: string, href: string): string {
  return `<p style="margin:4px 0 18px;"><a href="${escapeHtml(href)}" style="text-decoration:none;"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" width="440" style="width:100%; max-width:440px; height:auto; display:block; border-radius:10px; border:1px solid #e7e4df;"></a></p>`;
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
// Each builder renders one of two copy variants ('A' default / 'B'); the bandit
// (migration 0174) picks which variant a recipient gets and learns the winner.
interface ActivateNudgeData {
  workspaceId?: string;
  boardId?: string;     // the user's most recent cluster (nullable — see 0183)
  boardName?: string;   // pre-sanitized in renderTemplate
  unsubscribeToken: string;
  variant?: string;
}

// "Untitled cluster" reads worse than no name at all in a subject/CTA.
function namedBoard(d: ActivateNudgeData): string | null {
  const n = (d.boardName || "").trim();
  return n && !/^untitled/i.test(n) ? n : null;
}

function activateNudge1(d: ActivateNudgeData): RenderedEmail {
  const url = deepLink({ w: d.workspaceId, b: d.boardId }, utm("activate_nudge_1"));
  const unsub = unsubUrl(d.unsubscribeToken);
  const name = namedBoard(d);
  if (d.variant === "B") {
    const readyLine = name ? `"${name}" is ready when you are.` : "your board is ready when you are.";
    return {
      subject: "3 photos is all it takes",
      html: renderPlainNote({
        preheader: "drop three photos onto a board and it becomes something you can use and share.",
        bodyHtml:
          noteP("hey, the clusters team here.") +
          noteP("the 60-second version of clusters: drop three photos onto a board — camera roll, screenshots, references — and it becomes something you can actually use and share.") +
          noteP(readyLine) +
          noteBtn("add 3 photos", url) +
          noteP("talk soon, the clusters team"),
        unsubscribeUrl: unsub,
      }),
      text:
`hey, the clusters team here.

the 60-second version of clusters: drop three photos onto a board — camera roll, screenshots, references — and it becomes something you can actually use and share.

${readyLine}

add 3 photos: ${url}

talk soon, the clusters team

Unsubscribe: ${unsub}`,
    };
  }
  const opener = name
    ? `you made "${name}" — it's just sitting empty. the fastest way to see what clusters can do: open it and drop in a few photos. camera roll, screenshots, references — we arrange them for you.`
    : "you're in, but your canvas is still empty. drop a few photos on it — camera roll, screenshots, references — and clusters arranges them for you.";
  const cta = name ? `open "${name}"` : "open clusters";
  return {
    subject: "your cluster is one photo away",
    html: renderPlainNote({
      preheader: "drop a few photos in — camera roll, screenshots, references — we arrange them.",
      bodyHtml:
        noteP("hey, quick note from the clusters team.") +
        noteP(opener) +
        noteP("give it a minute?") +
        noteBtn(cta, url) +
        noteP("talk soon, the clusters team"),
      unsubscribeUrl: unsub,
    }),
    text:
`hey, quick note from the clusters team.

${opener}

give it a minute?

${cta}: ${url}

talk soon, the clusters team

Unsubscribe: ${unsub}`,
  };
}

function activateNudge2(d: ActivateNudgeData): RenderedEmail {
  const url = deepLink({ w: d.workspaceId, b: d.boardId }, utm("activate_nudge_2"));
  const unsub = unsubUrl(d.unsubscribeToken);
  const name = namedBoard(d);
  if (d.variant === "B") {
    return {
      subject: "before you go",
      html: renderPlainNote({
        preheader: "most people start with one messy photo drop. it sorts itself out from there.",
        bodyHtml:
          noteP("hey, last one from us, promise.") +
          noteP("most people who stick with clusters started with one messy photo drop: a moodboard, a project, a pile of references. it sorts itself out from there.") +
          noteP("two minutes to see if it clicks?") +
          noteBtn("drop in some photos", url) +
          noteP("talk soon, the clusters team"),
        unsubscribeUrl: unsub,
      }),
      text:
`hey, last one from us, promise.

most people who stick with clusters started with one messy photo drop: a moodboard, a project, a pile of references. it sorts itself out from there.

two minutes to see if it clicks?

drop in some photos: ${url}

talk soon, the clusters team

Unsubscribe: ${unsub}`,
    };
  }
  const waiting = name
    ? `"${name}" is still waiting. one photo drop is all it takes to see whether clusters clicks for you — everything you add arranges itself into a board you can share.`
    : "your canvas is still waiting. one photo drop is all it takes to see whether clusters clicks for you — everything you add arranges itself into a board you can share.";
  const cta = name ? `open "${name}"` : "open clusters";
  return {
    subject: "last note from us",
    html: renderPlainNote({
      preheader: "one photo drop is all it takes to see whether clusters clicks for you.",
      bodyHtml:
        noteP("hey again, we'll keep this one short, then we'll leave you be.") +
        noteP(waiting) +
        noteP("two minutes, in and out. if it's not your kind of thing, genuinely no hard feelings.") +
        noteBtn(cta, url) +
        noteP("talk soon, the clusters team"),
      unsubscribeUrl: unsub,
    }),
    text:
`hey again, we'll keep this one short, then we'll leave you be.

${waiting}

two minutes, in and out. if it's not your kind of thing, genuinely no hard feelings.

${cta}: ${url}

talk soon, the clusters team

Unsubscribe: ${unsub}`,
  };
}

interface ReengageData {
  workspaceId?: string;
  boardId?: string;
  boardName?: string;   // pre-sanitized in renderTemplate
  unsubscribeToken: string;
  variant?: string;
}

function reengage1(d: ReengageData): RenderedEmail {
  const url = deepLink({ w: d.workspaceId, b: d.boardId }, utm("reengage_1"));
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

function welcomeBoard(d: WelcomeBoardData): RenderedEmail {
  const url = deepLink({ w: d.workspaceId, b: d.boardId }, utm("welcome_board"));
  const unsub = unsubUrl(d.unsubscribeToken);
  const name = namedWelcomeBoard(d);
  // A lot of new users sign up on a phone and never see the full app; a quiet,
  // device-neutral nudge to open it on a computer (the cron has no device
  // signal, so this rides every welcome_board).
  const deskTip = "one tip: open it on your computer when you can — the full studio, a bigger canvas, every tool.";
  const img = d.thumbUrl && d.thumbUrl.startsWith(EMAIL_THUMB_PREFIX)
    ? noteImg(d.thumbUrl, name ? `Your board "${name}"` : "Your board", url)
    : "";
  if (d.variant === "B") {
    const openerB = img
      ? "hey — one day in, and your board already looks like this:"
      : "hey — one day in, and your board is already taking shape.";
    const saved = name
      ? `"${name}" is saved and waiting. add a few more photos and watch it take shape.`
      : "it's saved and waiting. add a few more photos and watch it take shape.";
    return {
      subject: "look what you made",
      html: renderPlainNote({
        preheader: "one day in, and your board is already taking shape.",
        bodyHtml:
          noteP(openerB) +
          img +
          noteP(saved) +
          noteP(deskTip) +
          noteBtn("keep building", url) +
          noteP("talk soon, the clusters team"),
        unsubscribeUrl: unsub,
      }),
      text:
`${openerB}

${saved}

${deskTip}

keep building: ${url}

talk soon, the clusters team

Unsubscribe: ${unsub}`,
    };
  }
  const opener = name
    ? (img ? `you started "${name}" yesterday — here's how it's looking already.`
           : `you started "${name}" yesterday — it's already taking shape.`)
    : (img ? "you started a board yesterday — here's how it's looking already."
           : "you started a board yesterday — it's already taking shape.");
  return {
    subject: name ? `"${name}" is off to a good start` : "your board is off to a good start",
    html: renderPlainNote({
      preheader: "it's saved and waiting whenever you want to keep going.",
      bodyHtml:
        noteP("hey, the clusters team here.") +
        noteP(opener) +
        img +
        noteP("it's saved and waiting whenever you want to keep going — drop in more photos, notes, or files and they arrange themselves.") +
        noteP(deskTip) +
        noteBtn("pick up where you left off", url) +
        noteP("talk soon, the clusters team"),
      unsubscribeUrl: unsub,
    }),
    text:
`hey, the clusters team here.

${opener}

it's saved and waiting whenever you want to keep going — drop in more photos, notes, or files and they arrange themselves.

${deskTip}

pick up where you left off: ${url}

talk soon, the clusters team

Unsubscribe: ${unsub}`,
  };
}

// ── board_waiting (migration 0194) ──────────────────────────────────────────
// The picture-powered win-back: an activated user who built a real board and
// then went quiet (~14d). Same own-thumbnail pull as welcome_board, but framed
// as "it's still here" rather than "look what you made". Sits above reengage_1
// in the cron priority (reengage_1 is the text fallback for dormant users whose
// board has no stored thumbnail). Reuses WelcomeBoardData — identical shape.
function boardWaiting(d: WelcomeBoardData): RenderedEmail {
  const url = deepLink({ w: d.workspaceId, b: d.boardId }, utm("board_waiting"));
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
function nudgeDormantEarly(d: ActivateNudgeData): RenderedEmail {
  const url = deepLink({ w: d.workspaceId, b: d.boardId }, utm("nudge_dormant_early"));
  const unsub = unsubUrl(d.unsubscribeToken);
  const name = namedBoard(d);
  const cta = name ? `open "${name}"` : "open clusters";
  if (d.variant === "B") {
    return {
      subject: "still here whenever you want it",
      html: renderPlainNote({
        preheader: "no rush — your workspace is saved and waiting whenever you are.",
        bodyHtml:
          noteP("hey, the clusters team here.") +
          noteP("we haven't seen you in a little while — totally fine, life happens. just wanted you to know your workspace is saved and waiting whenever you want it.") +
          noteP("if you've got a project, a moodboard, or a pile of references sitting around, clusters is the easy place to drop them and watch them arrange themselves.") +
          noteBtn(cta, url) +
          noteP("talk soon, the clusters team"),
        unsubscribeUrl: unsub,
      }),
      text:
`hey, the clusters team here.

we haven't seen you in a little while — totally fine, life happens. just wanted you to know your workspace is saved and waiting whenever you want it.

if you've got a project, a moodboard, or a pile of references sitting around, clusters is the easy place to drop them and watch them arrange themselves.

${cta}: ${url}

talk soon, the clusters team

Unsubscribe: ${unsub}`,
    };
  }
  const opener = name
    ? `you started "${name}" a little while back, then things went quiet — no worries at all.`
    : "you set up a workspace a little while back, then things went quiet — no worries at all.";
  return {
    subject: "your workspace is still here",
    html: renderPlainNote({
      preheader: "it's saved and waiting whenever you want to give it another look.",
      bodyHtml:
        noteP("hey, quick note from the clusters team.") +
        noteP(opener) +
        noteP("the whole idea of clusters: drop in photos, notes, or files — camera roll, screenshots, references — and they arrange themselves into something you can actually use and share. two minutes is enough to see if it clicks.") +
        noteBtn(cta, url) +
        noteP("talk soon, the clusters team"),
      unsubscribeUrl: unsub,
    }),
    text:
`hey, quick note from the clusters team.

${opener}

the whole idea of clusters: drop in photos, notes, or files — camera roll, screenshots, references — and they arrange themselves into something you can actually use and share. two minutes is enough to see if it clicks.

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
        variant:          data.variant != null ? String(data.variant) : undefined,
      });
    }
  }
}
