---
title: Settings — Soleil Clusters
metaDescription: Every setting in Soleil Clusters — Profile, Appearance, Notifications, Connections, Plan and billing, Invite and earn, General, Card defaults and Documentation.
h1: Settings
navLabel: Settings
section: account
order: 0
updated: 2026-08-26
answer: Settings is one panel with a rail grouped into You, This workspace and Help. You covers Profile, Appearance, Notifications, Connections, Plan and billing, and Invite and earn. This workspace covers General and Card defaults. Help holds a searchable index of the whole documentation site. Open it from the cog or your avatar in the sidebar, or with Cmd-K and typing settings.
faq:
  - q: Are settings per device?
    a: No. They are stored on your account and follow you to any browser or device you sign in on, including the theme and the scroll-wheel mode.
  - q: What is the difference between the cog and my avatar?
    a: Nothing except where they land you. Both open the same panel — the cog on the workspace's General tab, the avatar on your Profile. Everything else is one click away in the same rail.
  - q: Where do I find my storage usage?
    a: Under Plan and billing, as a meter showing used against your quota.
  - q: Where are API tokens?
    a: Under Connections, alongside Soleil Scout and any apps you have approved. Tokens are shown once at creation and cannot be recovered afterwards.
related:
  - /docs/account/plans
  - /docs/account/theme-and-defaults
  - /docs/api/authentication
---

Open it from the sidebar — the **cog** or **your avatar**, bottom left — or with
`⌘K` → "settings". Both buttons open the same panel; they differ only in which
tab they land on, and every other tab is one click away in the same rail.

Settings are stored on your account, not the device, so they follow you
everywhere you sign in. **Nothing here has a Save button** — every change is
written as you make it, and a `Saved ✓` flashes in the header when it lands. A
text field commits when you click away or press `Enter`; a colour commits when
you close the picker.

The rail is grouped, and which group a setting is in tells you who it affects.

## You

Personal. Nobody else in the workspace sees these, and they follow your account
between devices.

### Profile

Profile picture, display name, email, and your
**[presence colour](/docs/collaborate/presence)** — the colour your cursor and
selection halos appear in to everyone else.

### Appearance

How Clusters looks and how the canvas answers your hands, in three sections:

- **Theme** — **System**, **Light** or **Dark**, plus accent colour and body
  font: a curated list of around twenty-five families plus anything from Google
  Fonts. **System** follows your device and is what you get before you choose
  anything, so switching your Mac or phone to dark switches Clusters with it.
  See [Theme and defaults](/docs/account/theme-and-defaults).
- **Layout** — clean mode, which hides the interface chrome for presenting
  (`⌘.`), and whether the sidebar starts open. Collapsing the sidebar with
  `⌘B` sets that preference too, so it follows your account rather than the
  browser you happen to be in.
- **Canvas** — whether a plain **scroll wheel** pans the
  [canvas](/docs/canvas) or zooms it. Pinching a trackpad zooms either way.

### Notifications

Independent switches for the emails Clusters sends you — mentions, comment
replies, workspace invites, cluster shares, accepted invites, schedule changes,
and product tips. Anything you turn off still reaches you in-app. See
[Notifications](/docs/collaborate/notifications).

### Connections

Everything that can reach your clusters without being this browser.

- **Soleil Scout** — the connect code that binds a phone number to this
  account, so texted photos land in your workspace. Also lists the phones
  already connected, and any number still waiting to prove it is yours. See
  [Soleil Scout](/docs/scout).
- **API access** — create and revoke
  [personal access tokens](/docs/api/authentication) for the
  [REST API](/docs/api) and [MCP](/docs/mcp), and disconnect apps you approved
  through [OAuth](/docs/api/oauth). Connecting an AI assistant usually needs no
  token at all, so the [MCP](/docs/mcp) endpoint is offered first, ready to
  copy. Each token gets a name and one of three levels — **Read only**,
  **Read & write**, or **Full access**, which is the only one that can delete.
  The token value is shown **once**, at creation: it is stored only as a hash
  and cannot be recovered, so a lost token is revoked and replaced.

### Plan & billing

Current plan, the Stripe customer portal for payment details and cancellation,
and the **storage meter** showing what you have used against your quota. See
[Plans](/docs/account/plans).

### Invite & earn

Your [referral](/docs/account/referrals) link, share targets, and the stats:
friends joined, how many got started, cards earned, free months.

## This workspace

Shared. Everyone in the workspace sees the same values. Editors and owners can
change Card defaults; only the owner can change the name, the icon, or run a
recovery. Viewers see everything read-only.

### General

What the workspace *is*: its **name** and its **icon**, which are what the
sidebar and the workspace switcher show. The switcher's ⋯ menu opens this tab
too.

Owners also get **Recovery** here — a rewind of every cluster in the workspace
at once, for after an accidental mass-delete. The pre-rewind state is kept, so
the rewind itself is reversible. See
[Trash and recovery](/docs/clusters/trash-and-recovery).

### Card defaults

What new cards *start as*, so you are not restyling every one. Existing cards
are never changed.

- **Notes** — background, text colour, font, size
- **Clusters** — whether new clusters open as
  [canvas or list](/docs/clusters/list-view)
- **Docs** — font
- **Shapes** — shape, stroke colour, fill colour, stroke width, line style

## Help

### Documentation

A searchable index of every page on this site, grouped the way the docs site is
grouped, with a one-line summary under each. Type into the box to filter — it
matches headings as well as page titles, so "scroll wheel" finds the
[keyboard shortcuts](/docs/keyboard-shortcuts) page even though no page is
called that.

Every link opens in a **new tab**, so following one never costs you what is on
your canvas.

## Sign out

At the foot of the rail, under every group. It asks first, and names the
account it is about to sign out of.

## Not in Settings

A few things live where they apply rather than in a settings screen:

| Setting | Where |
|---|---|
| Cluster cover / thumbnail | Right-click the [cluster](/docs/clusters) |
| Canvas background colour | Right-click the [canvas](/docs/canvas) |
| Public link expiry and indexing | The [Share](/docs/collaborate/sharing) dialog |
| Hiding [comments](/docs/collaborate/comments) | The eye toggle on the board |
| Deleting or leaving a workspace | The workspace switcher's ⋯ menu |

## On a phone

The panel fills the screen and works as a list: the rail is the first screen,
tapping a tab pushes it, and the back chevron in the header returns to the
list. The bottom nav's **Settings** tab opens it.
