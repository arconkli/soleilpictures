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
  | "pending_invite"
  | "mention_email"
  | "comment_reply_email"
  | "activate_nudge_1"
  | "activate_nudge_2"
  | "reengage_1";

export const TEMPLATE_NAMES: TemplateName[] = [
  "waitlist_submitted",
  "waitlist_accepted",
  "workspace_invite",
  "board_shared",
  "pending_invite",
  "mention_email",
  "comment_reply_email",
  "activate_nudge_1",
  "activate_nudge_2",
  "reengage_1",
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

function noteLink(label: string, url: string): string {
  return `<p style="margin:2px 0 18px; font:600 15px/1.65 ${NOTE_FONT};"><a href="${escapeHtml(url)}" style="color:#1a1a1a; text-decoration:underline;">${escapeHtml(label)} &rarr;</a></p>`;
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
  const subtitle = `${d.inviterName} added you as ${role}. Jump in to see what they're working on.`;
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
  const headline = `${d.sharerName} shared a board.`;
  const subtitle = `You've got ${role} access to "${d.boardName}".`;
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
  const subtitle = `You've been invited to join ${target} as ${roleLabel}. Sign in to get started — we'll set up your account.`;
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
interface ActivateNudgeData {
  workspaceId?: string;
  unsubscribeToken: string;
}

function activateNudge1(d: ActivateNudgeData): RenderedEmail {
  const url = deepLink({ w: d.workspaceId }, utm("activate_nudge_1"));
  return {
    subject: "your board's still blank",
    html: renderPlainNote({
      preheader: "the fastest way in: drop three things you're into onto a board.",
      bodyHtml:
        noteP("hey — andrew here, one of the people behind clusters.") +
        noteP("saw you signed up but haven't actually built anything yet. no judgment — a blank canvas is the worst part.") +
        noteP("the move is to not overthink it: dump three things you're into onto a board and let it cluster itself. takes about a minute, and it's basically the whole point.") +
        noteP("want to give it a shot?") +
        noteLink("open clusters", url) +
        noteP("— andrew, soleil"),
      unsubscribeUrl: unsubUrl(d.unsubscribeToken),
    }),
    text:
`hey — andrew here, one of the people behind clusters.

saw you signed up but haven't actually built anything yet. no judgment — a blank canvas is the worst part.

the move is to not overthink it: dump three things you're into onto a board and let it cluster itself. takes about a minute, and it's basically the whole point.

want to give it a shot?

open clusters: ${url}

— andrew, soleil

—
Unsubscribe: ${unsubUrl(d.unsubscribeToken)}`,
  };
}

function activateNudge2(d: ActivateNudgeData): RenderedEmail {
  const url = deepLink({ w: d.workspaceId }, utm("activate_nudge_2"));
  return {
    subject: "last note from me",
    html: renderPlainNote({
      preheader: "for the stuff that lives in 40 open tabs and six group chats.",
      bodyHtml:
        noteP("hey, andrew again — i'll keep this one short, then i'll leave you be.") +
        noteP("clusters is for the stuff that lives in 40 open tabs and six group chats: references, ideas, things you don't want to lose. you drop it in, it organizes itself into boards you can actually share.") +
        noteP("if that sounds at all like your kind of thing, it's worth two minutes to start one. if it's not, genuinely no hard feelings.") +
        noteP("— andrew, soleil") +
        noteLink("build my first board", url),
      unsubscribeUrl: unsubUrl(d.unsubscribeToken),
    }),
    text:
`hey, andrew again — i'll keep this one short, then i'll leave you be.

clusters is for the stuff that lives in 40 open tabs and six group chats: references, ideas, things you don't want to lose. you drop it in, it organizes itself into boards you can actually share.

if that sounds at all like your kind of thing, it's worth two minutes to start one. if it's not, genuinely no hard feelings.

— andrew, soleil

build my first board: ${url}

—
Unsubscribe: ${unsubUrl(d.unsubscribeToken)}`,
  };
}

interface ReengageData {
  workspaceId?: string;
  boardId?: string;
  boardName?: string;   // pre-sanitized in renderTemplate
  unsubscribeToken: string;
}

function reengage1(d: ReengageData): RenderedEmail {
  const url = deepLink({ w: d.workspaceId, b: d.boardId }, utm("reengage_1"));
  const hasName = !!d.boardName;
  const subject  = hasName ? `"${d.boardName}" is right where you left it` : "your board's right where you left it";
  const ctaLabel = hasName ? `open "${d.boardName}"` : "open my board";
  const opener   = hasName
    ? `you built something real in clusters — "${d.boardName}" — and then went quiet. happens to the best of us.`
    : "you built something real in clusters and then went quiet. happens to the best of us.";
  return {
    subject,
    html: renderPlainNote({
      preheader: "it's all still there, right where you left it.",
      bodyHtml:
        noteP("hey — andrew, soleil.") +
        noteP(opener) +
        noteP("it's all still there, exactly how you left it. no pressure, but if a few new things have piled up since, this is a good moment to drop them in.") +
        noteP("pick up where you left off:") +
        noteLink(ctaLabel, url),
      unsubscribeUrl: unsubUrl(d.unsubscribeToken),
    }),
    text:
`hey — andrew, soleil.

${opener}

it's all still there, exactly how you left it. no pressure, but if a few new things have piled up since, this is a good moment to drop them in.

pick up where you left off:

${ctaLabel}: ${url}

—
Unsubscribe: ${unsubUrl(d.unsubscribeToken)}`,
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
      return activateNudge1({
        workspaceId:      data.workspaceId != null ? String(data.workspaceId) : undefined,
        unsubscribeToken: String(data.unsubscribeToken ?? ""),
      });
    case "activate_nudge_2":
      return activateNudge2({
        workspaceId:      data.workspaceId != null ? String(data.workspaceId) : undefined,
        unsubscribeToken: String(data.unsubscribeToken ?? ""),
      });
    case "reengage_1": {
      const boardName = String(data.boardName ?? "").replace(/[\r\n]/g, "").slice(0, 80).trim();
      return reengage1({
        workspaceId:      data.workspaceId != null ? String(data.workspaceId) : undefined,
        boardId:          data.boardId != null ? String(data.boardId) : undefined,
        boardName:        boardName || undefined,
        unsubscribeToken: String(data.unsubscribeToken ?? ""),
      });
    }
  }
}
