// Per-template builders. Each takes its template-specific data and
// returns { subject, html, text } ready to hand to Resend.
//
// Adding a new template:
//   1. add an entry in TEMPLATE_NAMES + TemplateName
//   2. add a builder function below
//   3. wire it in renderTemplate's switch
//   4. update send-transactional-email's accepted template list

import { renderEmail } from "./layout.ts";

export type TemplateName =
  | "waitlist_submitted"
  | "waitlist_accepted"
  | "workspace_invite"
  | "board_shared"
  | "mention_email"
  | "comment_reply_email";

export const TEMPLATE_NAMES: TemplateName[] = [
  "waitlist_submitted",
  "waitlist_accepted",
  "workspace_invite",
  "board_shared",
  "mention_email",
  "comment_reply_email",
];

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const SIGN_IN_URL = "https://clusters.soleilpictures.com/sign-in";
const APP_URL     = "https://clusters.soleilpictures.com/";

// Build a deep link that AuthGate consumes into localStorage post-sign-in
// so the app lands on the right workspace/board automatically.
function deepLink(params: { w?: string; b?: string } = {}): string {
  const qs = new URLSearchParams();
  if (params.w) qs.set("w", params.w);
  if (params.b) qs.set("b", params.b);
  const tail = qs.toString();
  return tail ? `${APP_URL}?${tail}` : APP_URL;
}

function plain(lines: string[]): string {
  return lines.filter((l) => l !== "").join("\n");
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
  }
}
