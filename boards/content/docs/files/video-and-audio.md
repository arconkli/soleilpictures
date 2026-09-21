---
title: Video and Audio — Soleil Clusters
metaDescription: Video and audio cards in Soleil Clusters play inline on the canvas. Audio draws a real waveform decoded from the file, with cover art and one-at-a-time play.
h1: Video and audio
navLabel: Video and audio
section: files
order: 2
updated: 2026-08-08
answer: Video and audio files become playable cards on the canvas. Audio cards draw a real waveform decoded from the file itself, and only one plays at a time so a board full of takes never becomes a wall of noise. Free accounts cap video at {{fact:freeVideoCap}} and audio at {{fact:freeAudioCap}}; {{fact:planName}} removes both caps.
faq:
  - q: Why does starting one audio card stop another?
    a: Deliberate. Boards commonly hold a dozen takes, and having several play over each other is never what someone wanted. Playback is exclusive across the board.
  - q: Can I trim a clip?
    a: No. Clusters plays media, it does not edit it. Trim in your editor and upload the version you want to show.
  - q: Can a video loop like a GIF?
    a: Yes. Right-click the card for Autoplay and Loop. Autoplay is always muted because browsers block clips that start themselves with sound, and a clip only plays while it is on screen.
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

### Autoplay and looping

Right-click a video card for **Autoplay (muted)** and **Loop**. Together they
turn a short clip into the thing a GIF used to be on a reference board — a
moving still you never have to press play on — while the file stays a real
video you can scrub, download and hand to an editor.

Autoplay is **muted**, and not as a preference: every browser blocks an
autoplaying clip that makes noise, and a board of self-starting soundtracks
would fight the one-at-a-time rule audio cards follow. Unmute from the card's
own controls when you want to hear it.

A clip only plays while it is **on screen**. Scroll it out of view and it pauses.
On a board holding twenty takes, autoplaying all of them at once is what makes a
canvas stutter, so this is the behaviour rather than a setting.

Free accounts cap video at **{{fact:freeVideoCap}}**. That is enough for a
reference clip or a cut-down, not for a full-resolution master.
{{fact:planName}} removes the cap and handles very large files by uploading them
in parts.

## Audio

Audio cards do more than provide a play button:

- A **real waveform**, drawn from the file — so you can see where the loud part is before playing it
- **Cover art**, lifted from the file's own tag when it has one — or set by hand on any audio card
- Standard transport controls

**Only one audio card plays at a time** across the whole board. Starting a
second stops the first. On a board holding a dozen takes of the same cue, this
is the only behaviour that makes sense.

Free accounts cap audio at **{{fact:freeAudioCap}}**.

### Cover art

MP3, M4A and FLAC files can carry artwork inside them, and Clusters reads it as
the file uploads — a released track arrives on the canvas looking like itself.

WAV and AIFF have no standard way to carry a picture, so a loop exported to
either will not have one. Right-click any audio card for **Set cover image**
to add one by hand; a cover you set that way is never overwritten.

### Downloading audio

Hover an audio card and a download button appears next to the transport. It is
there for anyone who can see the card, including a signed-out visitor on a
[shared or published link](/docs/collaborate/sharing) — the same rule images
have always followed.

The file comes back under its **original name**, not the card's title. Renaming
a card to something readable never costs you the extension, which is what makes
the file openable.

To take several at once, switch to [list view](/docs/clusters/list-view),
select the ones you want and press **Download** — one zip, original names
intact. Zips are capped at **{{fact:zipMaxFiles}} files** or
**{{fact:zipMaxSize}}**, whichever comes first; past either, download in
batches. In the phone and tablet apps, files download one at a time.

### Tempo and key

Sample and loop packs are named by machine — `SFL_120_Gmin_Loop_Piano.wav`,
`Cymatics - Orchid Kick 3 - 140 BPM.wav` — so the tempo and key are usually
already written down. Clusters reads them out of the filename as the file
uploads and puts them on the card, where you can sort and filter by them in
[list view](/docs/clusters/list-view).

Both fields are editable: click the tempo or the key under the waveform and
type. What you type wins permanently and is never overwritten.

Clusters does **not** listen to the audio to work either one out. Key detection
on a single-instrument loop is guesswork — a kick loop has no key, and a hi-hat
loop will report one anyway — and a wrong key is worse than an empty one,
because you will trust it and your track will clash. If the name carries
nothing, the field stays blank until you fill it in.

### When a card has no waveform

The waveform is decoded from the file as it uploads. Decoding holds the whole
track in memory, so files over **{{fact:audioWaveformCap}}** or longer than
**{{fact:audioWaveformMinutes}}** are skipped — as is anything in a format your
browser cannot decode.

Those cards show an even, flat strip instead. The file still uploads, still
plays, and still seeks; there is simply no shape to draw. A flat strip means
"we don't know what this looks like", and it is deliberately not a
guessed-looking waveform.

Cards that were uploaded before waveforms existed get theirs filled in quietly
in the background, a couple at a time, while you have the cluster open.

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
**Settings → Plan & billing**. Video is usually what fills it.
