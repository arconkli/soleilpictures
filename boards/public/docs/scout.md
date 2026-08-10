# Soleil Scout

> Soleil Scout is a text-message ingest bot. You text photos, links or notes from your phone and they land arranged on a Soleil Clusters canvas, grouped by what you said about them. There is no app to install and no signup — an account and a board are created behind you the first time you text. The web half is live; the phone line is not connected yet, so signups are queued.

_Source: https://clusters.soleilpictures.com/docs/scout · Updated 2026-08-08_

Scout exists because nobody installs an app in a parking lot on one bar of
signal. It lives in the messages app already open on the phone.

> **Warning:** Scout is **not fully live**. The web half — the signup box, the
> instant sign-in links, the account plumbing — is deployed. The bot itself has
> no phone line connected, so no message is sent or received today. Joining at
> [/scout](https://clusters.soleilpictures.com/scout) puts you on the list and you are texted
> when the line is live. This page describes how it behaves once it is.

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

## Batching

Twelve photos means twelve messages seconds apart. Scout waits until you have
stopped — roughly twenty seconds of quiet — then lays everything out once and
sends **one** reply.

While it works, a single message is edited in place through the stages rather
than sending a new one each time: *Got 12 photos — working on it…* → *Uploading
3 of 12…* → *Arranging on Scout Inbox…* → the confirmation.

## The Scout Bin

Unfiled things collect in your **Scout Bin**. It is the default destination, so
you never have to decide where something goes at the moment you are shooting it.

Say `/board Diner Recce` and that thread's target changes — the target is
sticky, so everything after goes there until you change it again.

Moves are always **confirmed before they happen**, and a rendered contact sheet
of what is about to move is sent before the text asking you to confirm. Moves
can be undone.

## Commands

| Command | Effect |
|---|---|
| `/help` (or `/start`) | What Scout can do |
| `/board <name>` | Send everything after this to that cluster |
| `/bin` (or `/inbox`) | Back to the Scout Bin |
| `/link` | A signed link into your canvas |
| `/code <code>` | Connect this phone to an existing account |

Anything that is not a command is treated as content — or, if it is a question,
answered.

## Connecting to an existing account

Binding a phone to an account you already have is built but not switched on,
for the same reason as everything else here: there is no line to text. When it
is, you will get a connect code from your settings and text it once.

If you started from Scout with no account, a **claim** flow attaches an email
address to the shell account created behind your number.

## Links

Confirmations include a link into the canvas with the cards you just sent
already selected. For accounts with no email yet, that is a signed link that
signs you in directly — valid for 30 minutes, then it expires and you request
another.

## Limits

Texted cards count against your [card allowance](/docs/canvas/cards) like any
other. On the free plan that is **100 cards**.

Scout warns you once, at 75% of the cap, and tells you where you stand in each
confirmation past halfway. At the cap it says so plainly rather than silently
dropping photos.

## Transport

iMessage is the confirmed transport. SMS and RCS are **not** confirmed, and
nothing here promises Android until they are. This page will say so when that
changes.
