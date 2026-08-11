# Soleil Scout

> Soleil Scout is a text-message ingest bot. You text photos, clips, voice notes, PDFs, links or notes from your phone and they land arranged on a Soleil Clusters canvas, grouped by what you said about them. There is no app to install and no signup — an account and a board are created behind you the first time you text. Voice notes are transcribed so you can search what you said. The web half is live; the bot is not deployed yet, so signups are queued.

_Source: https://clusters.soleilpictures.com/docs/scout · Updated 2026-08-11_

Scout exists because nobody installs an app in a parking lot on one bar of
signal. It lives in the messages app already open on the phone.

> **Warning:** Scout is **not fully live**. The web half — the signup box, the
> instant sign-in links, the account plumbing — is deployed. The bot itself is
> not running, so no message is sent or received today. Joining at
> [/scout](https://clusters.soleilpictures.com/scout) puts you on the list and you are texted
> when it goes live. This page describes how it behaves once it is.

## The idea

Text what you are looking at. It lands on an infinite canvas your whole team can
open.

Two hundred photos in an afternoon all land in one undifferentiated camera roll.
Saying what a thing is while standing in front of it is the cheapest possible
moment to organize it — and it is the only moment when you actually know.

## How it works

1. **Text the number.** Send your first photo. A board and an account are created behind you — no form, no password.
2. **Say what it is.** Add "Scene 4 diner" or "power drops look sketchy". Scout reads it and titles the group.
3. **Keep shooting.** Send twelve more. They batch into one tidy grid instead of twelve replies and twelve piles.
4. **Tap the link.** Land on your canvas, signed in, with exactly the photos you just sent already selected.
5. **File it later.** Everything collects in your Scout Bin. Say "put these in Diner Recce" and Scout confirms what will move before it moves anything.

## What you can send

| You send | You get |
|---|---|
| Photos | Image cards at full resolution. iPhone HEIC is converted so it opens outside Safari |
| Video | A [video card](/docs/canvas/cards) with a poster frame. iPhone HEVC is converted so it plays in Chrome and Firefox |
| Voice notes | An audio card **plus a transcript**, so the words are searchable |
| Audio files | An audio card |
| PDFs | A [PDF card](/docs/files/pdf) that opens in the viewer |
| Links | A rich embed for YouTube, Vimeo, TikTok and the like; a preview card otherwise |
| Plain text | A sticky note next to the imagery it refers to |

Free-plan size limits are the same ones the canvas applies to a dropped file —
30 MB for video, 50 MB for audio,
50 MB for a PDF. Anything larger, and any other file type, needs
[Creator](/docs/account/plans). Scout says which files it could not take rather
than dropping them quietly.

### Where and when a photo was taken

Scout reads the capture time and, where the phone included it, the coordinates
from a photo's EXIF data and keeps both on the card. When a batch has
coordinates, the group's heading carries a map link for the place.

Nothing is looked up, sent anywhere, or shown publicly — it travels with the
card, the same way a photo's average colour does.

## Batching

Twelve photos means twelve messages seconds apart. Scout waits until you have
stopped — roughly twenty seconds of quiet — then lays everything out once and
sends **one** reply.

While it works, a single message is edited in place through the stages rather
than sending a new one each time: *Got 12 photos — working on it…* → *Uploading
3 of 12…* → *Arranging on Scout Bin…* → the confirmation.

## The Scout Bin

Unfiled things collect in your **Scout Bin**. It is the default destination, so
you never have to decide where something goes at the moment you are shooting it.

Say `/board Diner Recce` and that thread's target changes — the target is
sticky, so everything after goes there until you change it again. `/board` with
no name puts you back in the Bin.

If the board does not exist, Scout offers to make it and waits for you to reply
`CREATE`. It never invents a board from a name it merely heard, because a typo
would otherwise become a second board with half your work in it.

Moves are always **confirmed before they happen**, and a rendered contact sheet
of what is about to move is sent before the text asking you to confirm. Moves
can be undone.

## Finding things again

Say `find diner`, or `/find diner`, and Scout tells you which boards match and
links you to the one with the most hits.

It searches titles, notes, whatever you said about a photo when you sent it, and
**the text of your voice notes** — which is the whole reason they are
transcribed. It only ever searches boards you can already write to.

## Commands

| Command | Effect |
|---|---|
| `/help` | What Scout can do |
| `/board <name>` | Send everything after this to that cluster; offers to create it if it does not exist |
| `/board` | Back to the Scout Bin |
| `/bin` | What is waiting to be filed, and how old |
| `/find <text>` | Search everything you have sent |
| `/delete` | Remove the batch you just sent, with an undo |
| `/code <code>` | Connect this phone to an existing account |
| `STOP` | Stop messaging you entirely. `START` resumes |

Anything that is not a command is treated as content — or, if it is an
instruction ("put these in Diner Recce") it is obeyed, and if it is a question
it is answered.

## Stopping

Text **STOP** and Scout stops. It is recorded against your number, so nothing
further is sent and the signup queue is blocked as well. **START** resumes.

Stopping does not touch your boards, your photos or your account. To delete the
account itself, use Settings → Profile in the app.

## Connecting to an existing account

If you already have a Clusters account, **Settings → Scout** gives you a connect
code. Text `/code <code>` and the phone is bound to your account, so texted
photos land in the workspace you already use.

If you started from Scout with no account, a **claim** flow attaches an email
address to the shell account created behind your number.

## Links

Confirmations include a link into the canvas with the cards you just sent
already selected. For accounts with no email yet, that is a signed link that
signs you in directly — valid for 30 minutes, then it expires and you request
another.

## Limits

Texted cards count against your [card allowance](/docs/canvas/cards) like any
other. The free allowance is per account — see [Plans](/docs/account/plans) — and
Scout tells you your own number if you ask it "how much is this?".

Scout warns you once, at 75% of the cap, and tells you where you stand in each
confirmation past halfway. At the cap it says so plainly rather than silently
dropping photos.

There is also a rolling daily ceiling on how much one number can send. It is
abuse protection rather than a plan limit, and it sits far above anything a
day's scouting produces.

## Transport

iMessage is the confirmed transport. SMS and RCS are **not** confirmed, and
nothing here promises Android until they are. This page will say so when that
changes.
