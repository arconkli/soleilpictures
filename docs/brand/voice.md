# Voice

Soleil writes the way it builds: plainly, about what the thing does. The Clusters voice is the family voice, and the studio uses it too, with a little more feeling when it talks about its films. Back to the [brand book](README.md).

## How Soleil writes

- **Present tense, about what happens.** Say what the thing does now, not how good it is. "A note is the general-purpose card: a caption, a brief, a to-do list, a paragraph of context beside a set of images." (`boards/content/docs/canvas/notes.md`)
- **"You" for the reader, "people" for everyone.** "You will get a one-time code — there is no password." "Two people can type in the same note at once." (`boards/content/docs/canvas/notes.md`) The product does not speak as "I". "We" is the company, in legal text and in email.
- **Short sentences, concrete nouns.** References, storyboards, shot lists, scripts, scenes. The working vocabulary of a production, because that is who reads it.
- **Sentence case** for headings, buttons, menus and email headlines. Title case only in search-page titles. Capitals only for small Brandon eyebrows and the studio wordmark.
- **No exclamation marks. No emoji.** Typographic marks such as ✓ ✗ ⚠ ★ are fine; they are type, not decoration.
- **No hype and no superlatives.** Not "best", not "revolutionary", not "seamless".
- **Say what we do; never say nobody else does.** (`boards/src/lib/billingCopy.js`.) A comparison is true of the other product too, or it is not written.
- **Honest about limits.** "There is no store app yet, and we say so." (`boards/src/lib/seoLanding.js`.) When the answer is no, write "No." and then why.
- **Numbers come from code.** No limit, price or count is typed by hand in public copy. Docs use `{{fact:…}}` placeholders resolved by `boards/scripts/gen-docs.mjs`; plan copy comes from `boards/src/lib/billingCopy.js`, where "every line here must be true and enforced in code".
- **Answer first.** A docs page opens with the answer, then the detail. "What is the difference between a cluster and a board?" "Nothing. They are the same object." (`boards/content/docs/concepts.md`)

### Do and don't

| Do | Don't |
|---|---|
| "The free plan is a real plan, not a countdown." | "Our amazing free plan!" |
| "No credit card. Nothing to install." | "Get started in seconds, totally free!" |
| "Notes also grow downward on their own as you type past the bottom edge, and shrink back as you delete." | "We've massively improved notes." |
| "Card deleted" with Undo | "Card successfully deleted!" |
| "Make a new link? The old link stops working." | "Are you sure?" with Yes and No |
| "Soleil Clusters is a creative workspace and moodboard for film, photo, design and brand teams." | "The only moodboard built for film." |

The don'ts are written for this page; the dos are live copy (the notes row is from `boards/content/docs/canvas/notes.md`).

## Cluster and board

The interface says **cluster**. The API, the database, the code and the developer docs say **board**. Both are right in their own place, and neither is "fixed" to match the other (repo `CLAUDE.md`). When both audiences meet, say it once: "boards (the app calls them clusters)" (`mcp/src/server.js`).

Two edges, ruled here (new in this guide):

- Anything a person reads inside the product or in its email says cluster: buttons, toasts, nudges, sign-in, notifications.
- A search page may use "mood board" or "reference board", because that is the name of the category people search for. Once the page talks about the object in the product, it says cluster.

Where public copy still says board for the object, it is in [drift.md](drift.md).

## Interface words

- **Buttons are the verb.** One to three words, sentence case: "Open", "Rename", "Copy link", "Create cluster", "Delete permanently". No "OK", no "Yes / No". A trailing ellipsis means the command asks for more: "Move to…".
- **Pending states** use the ellipsis character: "Sending…", "Signing in…".
- **Full stops.** A toast that is a short phrase ends without one ("Card deleted", "Copied"); a toast that is a sentence, or two, ends with one ("Checkout canceled. Nothing was charged."). Empty states and errors are sentences and end with one. This is read from the live copy, which mostly agrees; a few short toasts, such as "Code copied.", still carry a full stop.
- **Success is short and past tense**, object first, no "successfully": "Link copied". A next step may follow a dash: "Invite message copied — paste it anywhere."
- **Empty states** state the fact, then hint: "No comments yet." "Drop a tag onto a card or cluster to apply it."
- **Confirmations** name the consequence and the way back: "Also removes any replies. You can undo this right after." A permanent one says so: "This cannot be undone."
- **Walls name the fix**: "Your storage is full. Delete files or empty the trash to make room."

## The undo toast

Deleting shows an undo toast. That is the convention across the family (repo `CLAUDE.md`; `boards/src/lib/undoToast.js`). The message is the object and a past-tense verb: "Card deleted", "Comment deleted", "Cluster deleted". The action is always "Undo". It stays for six seconds (`ttl` in `boards/src/lib/undoToast.js`). If the undo can no longer apply, it says why and what to do instead: "The board changed since — press ⌘Z to step back instead."

A product that deletes without an undo has to ask first, and the question names what will be lost.

## Numbers and dates

Dates, times and counts show in the reader's locale: Clusters passes no fixed locale to `toLocaleString` or `toLocaleDateString`, and asks for a medium date with a short time, or for month, day and time, rather than a format of its own. A few billing and import lines are fixed to US English today. Figures are tabular: `body` sets `font-variant-numeric: tabular-nums`, and `.t-meta` and `.t-mono` repeat it, so columns of numbers line up in tables and meta lines. Sample figures in marketing are labelled as examples and never presented as real results (new in this guide).

## Errors

An error says three things, in this order: **what failed**, **what did not happen**, **what to do**. No blame, no codes.

- "Could not read that cluster — nothing was copied. Try again in a moment."
- "Couldn't read that file — it doesn't look like Fountain or Final Draft."
- "This cluster's owner is out of storage — nothing more can be uploaded here until they make room."

The middle part matters most. Someone who has just lost a moment's work needs to know their work is safe before they need to know how to retry.

## Email

The words of an email never change when its look does (`supabase/functions/_shared/email/theme.ts`).

- **Subjects** name the person and the thing: `"<name> shared "<cluster>" with you"`. An email to someone who has no account carries nothing a stranger typed: "You've been invited to collaborate on Clusters."
- **Headlines** are a short sentence with a full stop: "You're in." "We got your application."
- **One action** per email, a verb and an object: "Open cluster", "Accept invitation".
- **Footer**: "<Name> by Soleil Pictures · <domain>". See [family.md](family.md).
- Product lifecycle notes may loosen into a plain lowercase note from the team, signed "talk soon, the clusters team" (`supabase/functions/_shared/email/templates.ts`). They are still plain, specific and free of hype.

## Sign-in email

The live Clusters sign-in email is the template for any product's (`supabase/templates/magic_link.html`, generated by `boards/scripts/gen-magic-link.mjs`). It has no button and no link: mail scanners open links and use up one-time codes, so the code is the one action.

- **Subject:** "<code> is your <Name> sign-in code"
- **Eyebrow:** "Sign-in code"
- **Headline:** "Here's your code."
- **Body:** "Enter this 6-digit code on the sign-in screen."
- **Code:** the code itself, large, on the panel tile.
- **Small print:** "It works for an hour. Asked for more than one? Only the newest works. Didn't request this? You can safely ignore this email."
- **Footer:** "<Name> by Soleil Pictures · <domain>"

The hour must match the sign-in code's expiry setting.

## The studio, about its films

The studio may speak about its films with more feeling than a product speaks about a button. It still never sells.

- A logline says who, what happens, and what is at stake, in one sentence: "After stealing a time machine, a reckless drunk juggles trying to (literally) live with his past self while going on adventures throughout time." (`projects.html` at the repo root.)
- Labels stay standard and plain: "Feature Film", "TV Series", "In Development", "Pre-Production".
- About the company, describe what it does: "Soleil Pictures is a film and television production company." Avoid "rising" and "pushing the boundaries": they are claims, not descriptions. The current studio copy uses both; see [drift.md](drift.md).
- Names of people stay on the pages that are about them. Taglines and posters do the feeling; the copy does the facts.

## Social posts

Social posts sound natural, not corporate: the voice of someone showing what they made, not of a brand announcing it (the owner's call, 2026-10-27). They follow the same rules as everything else: no hype, no emoji in Soleil's own voice, and any number comes from the product's code. A "Used by" line names companies only, as plain text, never as logos, because a logo reads as an endorsement and a name is a fact (`boards/src/lib/usedBy.js`).

## Words to keep straight

- **Soleil Clusters** in full where a stranger meets it; **Clusters** inside. Same for Scout. See [family.md](family.md).
- **Notices** are the gold nudges; **notifications** are the bell. Don't mix them.
- **Darkroom** is the email look's name inside the code. Readers never see it.
- "Unlimited" is never used for anything that has a cap (`boards/src/lib/publicClaims.test.mjs`).
