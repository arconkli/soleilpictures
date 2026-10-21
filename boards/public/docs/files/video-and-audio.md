# Video and audio

> Video and audio files become playable cards on the canvas. Audio cards draw a real waveform decoded from the file itself, and only one plays at a time so a board full of takes never becomes a wall of noise. There is no size or length limit on any plan; large files upload in parts automatically, and the only limit is your drive.

_Source: https://clusters.soleilpictures.com/docs/files/video-and-audio · Updated 2026-10-21_

Both play in place on the canvas — the clip is a card among the reference
stills it belongs with, which is what a
[video reference board](/tools/video-reference-board) is. A video also opens in a full review player when you
need to look at it frame by frame.

## Video

A video card plays inline. Move it, resize it, group it and comment on it like
anything else. At rest it shows its poster frame and its length in the corner.
Hover it for its controls: play, one frame back and forward, a scrubber along
the bottom edge that lands on exact frames, the timecode, mute, and **⤢** to
open the review player. The controls stay a usable size at any zoom.

Clicking a clip you haven't selected selects it, like any card. Click it again
to play or pause, or use the play button in its middle. Double-click it to open
the review player on that frame. On a board you can only view, one click plays.
Dragging the card never starts it.

### The review player

**⤢** on a video card, a double-click on it, **Open in player** in its
right-click menu (on the board or in [Files](/docs/clusters/list-view)), or
**Open in player** in Quick look opens the clip full size in a dark room, on the
frame you were on. Click the picture to play or pause; double-click for full
screen. In full screen the controls step aside while it plays and come back when
the pointer moves; on a touch screen, a tap brings them back without pausing.
When you close it, the card shows the frame you left on.

Under the picture, the timeline fills the width. Below it, from left to right:
- the timecode, the clip's length and its frame rate;
- the transport: set in, a frame back, play, a frame forward, set out;
- loop, speed, framing guides, volume and full screen.

- **Frame by frame.** `←` and `→` (or `,` and `.`) step one frame, `⇧←` and `⇧→`
  one second. Hold the step buttons to keep going. The timecode counts the frame
  actually on screen, in the clip's own frame rate. Until that rate is read, it
  counts at 24 and shows the rate as `≈24`. A phone clip with a variable frame
  rate says **VFR**: its frame numbers are close, not exact.
- **J, K, L.** Play backward, stop, and play forward; press again to go faster —
  the speed shows over the picture. Hold `K` and tap `J` or `L` to inch a frame;
  keep holding to play slowly.
- **The timeline.** Hover it for a preview of that frame, its timecode, and how
  far it is from the playhead. Drag to scrub; hold `⇧` while dragging to move a
  frame at a time. **+** and **−** (or `⌥=`, `⌥−`, pinch, `⌘`-scroll) zoom in
  around the playhead until every frame has its own tick, with seconds marked
  above. The strip above the timeline shows where you are in the whole clip:
  drag it to move along. `⌥0` fits the whole clip again. While playing zoomed in,
  the timeline follows the playhead.
- **Jump to a frame.** Click the timecode, or just start typing, and enter
  `01:00:10:12`, a frame number like `240`, seconds like `10.5s`, or a nudge like
  `+12` or `-1s`.
- **Timecode, frames or seconds.** The chip next to the length switches the
  readout. **Source timecode** counts from the start timecode the camera or
  editor wrote into the file. **Clip timecode** counts from `00:00:00:00`.
  Click the length to show the time left instead. `⌘C` copies the timecode.
- **In, out and loop.** `I` and `O` set an in and an out point. They show as
  brackets on the timeline that you can drag, and as a chip with the length
  between them. `⇧I` and `⇧O` go to them, and `⇧Space` plays from in to out once.
  `⌥L` loops between them, or the whole clip when neither is set. `⌥X` clears
  them.
- **Speed** from a quarter to double, from its button or `⇧<` and `⇧>`. The
  speed is remembered, and so are the volume and how the timecode reads.
- **Framing guides** for 2.39, 2.00, 1.90, 1.85, 16:9, 4:3, 1:1 and 9:16, action
  and title safe, thirds and a centre cross. `G` steps through them.
- **Look closer.** `Z` zooms the picture from fit to 100% (one pixel of the file
  per pixel of your screen) to 200%; drag to look around. `Z` again fits it.
- **Share a frame.** `⇧⌘C`, or **Copy link to this frame** in the picture's
  right-click menu, copies a link that opens this player paused on this frame,
  for anyone who can open the cluster.
- **Versions.** A clip with [versions](/docs/files#versions) shows them along
  the top. Switching keeps the frame, in, out and loop. **Compare** puts a second
  version behind the one on show: `\` or the **A | B** buttons flip between the
  two on the same frame.

`Esc` closes it. `?` lists every key, and so does
[Player](/docs/keyboard-shortcuts#player).

In [Quick look](/docs/clusters/list-view#quick-look) a clip plays with lighter
controls over its bottom edge: play, frame steps (`,` and `.`), J/K/L, mute
(`M`), the scrubber with its preview, and **Open in player**. `K` pauses there;
`Space` closes Quick look as it does for any file, and `←` and `→` still move
between files.

A file the browser can't decode — ProRes outside Safari, for instance — says
so, rather than showing a black frame, and offers the download.

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

### What Clusters knows about a clip

Right-click a video and choose [**Info**](/docs/canvas/cards#info), or select it
and press `⌘I`. Clusters reads the file's own container — MP4, MOV and M4V —
and reports what an editor would look for:

| | |
|---|---|
| **Resolution** | The picture's size, turned the right way up for a phone clip shot on its side |
| **Duration** | The length, to the second |
| **Frame rate** | Exactly — 23.976 is not 24 — and marked *variable* for a phone recording whose frames don't arrive evenly |
| **Codec** | H.264 and its profile, HEVC, ProRes (by flavour), AV1, VP9 |
| **Start timecode** | When the camera or editor wrote one, drop-frame at 29.97 and 59.94 |
| **Audio** | Its codec, sample rate and channels — or *None* |

A clip is read as it uploads, from the file on your computer. One uploaded
before this existed is read the first time someone opens Info on it, a few
kilobytes from the start (and end) of the file rather than the whole clip, and
what it finds is kept on the card. WebM and other containers report less.

There is no size or length limit on video, on any plan — a reference clip, a
cut-down or a full-resolution master all land the same way, and very large
files upload in parts. The only limit is your [drive](/docs/files#storage).

## Audio

Audio cards do more than provide a play button:

- A **real waveform**, drawn from the file — so you can see where the loud part is before playing it
- **Cover art**, lifted from the file's own tag when it has one — or set by hand on any audio card
- Standard transport controls

**Only one audio card plays at a time** across the whole board. Starting a
second stops the first. On a board holding a dozen takes of the same cue, this
is the only behaviour that makes sense.

There is no size limit on audio either, on any plan.

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

To take several at once, open the [full Files page](/docs/clusters/list-view) (`F`),
select the ones you want and press **Download** — one zip, original names
intact. Zips are capped at **500 files** or
**500 MB**, whichever comes first; past either, download in
batches.

### Tempo and key

Sample and loop packs are named by machine — `SFL_120_Gmin_Loop_Piano.wav`,
`Cymatics - Orchid Kick 3 - 140 BPM.wav` — so the tempo and key are usually
already written down. Clusters reads them out of the filename as the file
uploads and puts them on the card, where you can sort and filter by them in
[Files](/docs/clusters/list-view).

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

The review player plays the file as it is. It does not manage colour or show
HDR, it can't play sound while you scrub, and backward play steps through
frames rather than running smoothly. Compared versions line up by time from
their first frame, so two cuts with different heads won't match frame for frame.

## Storage

Media counts against your storage quota like everything else —
5GB free, 1TB on Creator, with the meter in
**Settings → Plan & billing**. Video is usually what fills it.
