# Video and audio

> Video and audio files become playable cards on the canvas. Audio cards draw a real waveform decoded from the file itself, and only one plays at a time so a board full of takes never becomes a wall of noise. Free accounts cap video at 30 MB and audio at 50 MB; Creator removes both caps.

_Source: https://clusters.soleilpictures.com/docs/files/video-and-audio · Updated 2026-08-08_

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

Free accounts cap video at **30 MB**. That is enough for a
reference clip or a cut-down, not for a full-resolution master.
Creator removes the cap and handles very large files by uploading them
in parts.

## Audio

Audio cards do more than provide a play button:

- A **real waveform**, drawn from the file — so you can see where the loud part is before playing it
- **Cover art**, set by hand on any audio card
- Standard transport controls

**Only one audio card plays at a time** across the whole board. Starting a
second stops the first. On a board holding a dozen takes of the same cue, this
is the only behaviour that makes sense.

Free accounts cap audio at **50 MB**.

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
intact. Zips are capped at **500 files** or
**500 MB**, whichever comes first; past either, download in
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
track in memory, so files over **25 MB** or longer than
**10 minutes** are skipped — as is anything in a format your
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
100GB on Creator, with the meter in
**Settings → Plan & billing**. Video is usually what fills it.
