---
title: Video and Audio — Soleil Clusters
metaDescription: Video and audio cards in Soleil Clusters play inline on the canvas. Waveform audio players with cover art, one-at-a-time playback, and free-plan size caps.
h1: Video and audio
navLabel: Video and audio
section: files
order: 2
updated: 2026-08-08
answer: Video and audio files become playable cards on the canvas. Audio cards draw a real waveform and show cover art, and only one plays at a time so a board full of takes never becomes a wall of noise. Free accounts cap video at {{fact:freeVideoCap}} and audio at {{fact:freeAudioCap}}; {{fact:planName}} removes both caps.
faq:
  - q: Why does starting one audio card stop another?
    a: Deliberate. Boards commonly hold a dozen takes, and having several play over each other is never what someone wanted. Playback is exclusive across the board.
  - q: Can I trim a clip?
    a: No. Clusters plays media, it does not edit it. Trim in your editor and upload the version you want to show.
  - q: What formats work?
    a: Whatever the browser can play — H.264 MP4 and MP3 or WAV are the safe choices. An unplayable file still uploads and becomes a downloadable file card.
related:
  - /docs/files
  - /docs/canvas/cards
  - /docs/account/plans
---

Both play in place on the canvas. No lightbox, no separate player window — the
clip is a card among the reference stills it belongs with.

## Video

A video card plays inline. Move it, resize it, group it and comment on it like
anything else.

Free accounts cap video at **{{fact:freeVideoCap}}**. That is enough for a
reference clip or a cut-down, not for a full-resolution master.
{{fact:planName}} removes the cap and handles very large files by uploading them
in parts.

## Audio

Audio cards do more than provide a play button:

- A **real waveform**, drawn from the file — so you can see where the loud part is before playing it
- **Cover art**, when the file carries it
- Standard transport controls

**Only one audio card plays at a time** across the whole board. Starting a
second stops the first. On a board holding a dozen takes of the same cue, this
is the only behaviour that makes sense.

Free accounts cap audio at **{{fact:freeAudioCap}}**.

## Formats

Whatever the browser can play. H.264 in an MP4 container, and MP3 or WAV, are
the reliable choices.

A file the browser cannot play still uploads — it becomes a
[file card](/docs/files) with a download, rather than failing.

## What this is not

Clusters plays media. It does not edit it: no trimming, no cutting, no
adjusting audio levels. Do that in your editor and upload the version you want
people to see.

The [photo adjustments](/docs/canvas/images) available on image cards have no
video equivalent.

## Storage

Media counts against your storage quota like everything else —
{{fact:creatorStorage}} on {{fact:planName}}, with the meter in
**Settings → Billing**. Video is usually what fills it.
