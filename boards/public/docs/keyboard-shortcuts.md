# Keyboard shortcuts

> Press ? anywhere in Soleil Clusters to see the shortcut list without leaving the page. The essentials are V to select, H or Space to pan, N for a note, A for an arrow, Cmd-K to search everything, Cmd-Z to undo, and Shift-1 to fit the whole board on screen.

_Source: https://clusters.soleilpictures.com/docs/keyboard-shortcuts · Updated 2026-10-12_

Press `?` on any canvas to see this list in the app, where it shows the right
modifier key for your platform. On Windows and Linux, every `⌘` below is `Ctrl`.

## Tools

| Key | Action |
|---|---|
| `V` | Select / move |
| `H` or `Space` | Pan the canvas |
| `N` | Add a note |
| `D` | Free-draw |
| `A` | Arrow |
| `G` | Add a grid |
| `Esc` | Back to select · close whatever is on top — a menu, a dialog, Settings |



## Navigate

| Key | Action |
|---|---|
| `⌘K` or `/` | Search and commands |
| `⌘B` | Toggle sidebar |
| `⌘.` | Clean mode — hide all chrome |

`⌘K` is the fastest way to get anywhere. It searches cluster names, card
contents, notes, docs and tags, and it also runs commands — "share", "trash",
"theme", "invite" all work as typed input.

## Sidebar

In the sidebar's cluster tree. `Tab` reaches the rows; these act on the focused one.

| Key | Action |
|---|---|
| `Enter` or `Space` | Open the cluster |
| `→` / `←` | Expand · collapse the clusters inside it |
| `F2` | Rename the cluster — `Enter` saves, `Esc` cancels |
| `⇧F10` or `Menu` | The row's menu — the same one right-click opens |

## Edit

| Key | Action |
|---|---|
| `⌘Z` / `⌘⇧Z` | Undo · redo |
| `⌘C` / `⌘X` / `⌘V` | Copy · cut · paste |
| `⌘D` | Duplicate |
| `⌘A` | Select all |
| `⌘G` | Group selection |
| `[` / `]` | Send backward · forward |
| `⌫` or `Del` | Delete selection |

> **Note:** Undo is per-session and per-board. It undoes your own edits, not a
> collaborator's — in a shared board, undo that could revert someone else's work
> would be worse than no undo at all.

## View

| Key | Action |
|---|---|
| `F` | Show or hide [Files](/docs/clusters/list-view) beside the board |
| `⌘I` | [Info](/docs/canvas/cards#info) — the selection, or the cluster when nothing is selected |
| `⌘0` | Reset zoom |
| `⌘+` / `⌘−` | Zoom in · out |
| `⇧1` | Fit everything |
| `⇧2` | Fit selection |
| `Space`-drag | Pan with any tool active |
| Scroll | Pan the canvas — or zoom, if you swap it |
| `⌘`-scroll | Zoom at the pointer |

Zoom and pan are remembered per cluster. Reopening a board puts you back where
you were rather than at the origin.

### Swapping what the wheel does

**Settings → Appearance → Scroll wheel.** Scrolling pans by default and `⌘`-scroll
zooms; set it to **Zoom** and they trade places, so a plain scroll zooms at the
pointer and `⌘`, `Alt` or `Shift` pans. `⌘K` → "scroll wheel" flips it without
opening settings.

Which one is right depends on what you came from — PureRef and Miro zoom on
scroll, Figma and Milanote pan — which is why it is a setting and not a default
we picked for you.

Pinching a trackpad zooms in either mode, and always will: a pinch reaches the
browser as a `Ctrl`-scroll, so `Ctrl` means zoom whatever else is configured.

## Files

In [Files](/docs/clusters/list-view), beside the board or full screen. Beside
the board, these keys go to whichever side the pointer was last over.

| Key | Action |
|---|---|
| `Tab` | Into the folders — one stop each, where `Enter` opens it and `Space` selects it — then the files, as a single stop |
| `←` `→` `↑` `↓` | Move through files — in the grid, `↑` / `↓` go to the nearest tile in the next row |
| `Enter` | Select the highlighted file |
| `⇧Space` | Add the highlighted file to the selection, or take it out — the keyboard version of a tile's round check |
| `Space` or double-click | Quick look — `←` / `→` step through the files, `Space` or `Esc` closes |
| `⌘I` | Info for the selection, or the cluster — in full-screen Files, remembered on your device |
| `F2` | Rename the selected file or folder — `Enter` saves, `Esc` cancels |
| `⇧F10` | The right-click menu, for the selection |
| `⌘A` | Select every file showing — search and filters apply |
| `Esc` | Clear the selection |
| `⌫` or `Del` | Delete the selection, with undo |
| `⌘Z` / `⌘⇧Z` | Undo · redo |

## Audio

| Key | Action |
|---|---|
| `Enter` | Play · pause the selected clip |
| `L` | Loop the selected clip |
| `Space` | Audition the highlighted row (Files, list layout) |

`Enter` rather than `Space` on the canvas, because `Space` is already the pan
modifier there and arrows already move cards. In [Files](/docs/clusters/list-view)
neither is taken, so auditioning a pack is `↓` and `Space` — and when a clip
finishes, the next one starts on its own.

Both canvas keys only fire when exactly one audio card is selected; otherwise
they fall through to whatever else is listening.

## Player

While the [review player](/docs/files/video-and-audio#the-review-player) is
open, it has the keyboard — nothing reaches the board behind it. Press `?` in
the player for this list.

**Transport**

| Key | Action |
|---|---|
| `Space` | Play · pause |
| `J` / `K` / `L` | Play backward · stop · forward — again to go faster |
| `K+J` / `K+L` | Tap: one frame back · forward. Hold: play slowly |
| `←` / `→` | One frame back · forward |
| `,` / `.` | One frame back · forward |
| `⇧←` / `⇧→` | One second back · forward |
| `Home` / `End` | First · last frame |
| `⇧<` / `⇧>` | Slower · faster |
| `0–9` | Type a timecode, frame or seconds to jump to |

**Marking**

| Key | Action |
|---|---|
| `I` / `O` | Set in · out |
| `⇧I` / `⇧O` | Go to in · out |
| `⇧Space` | Play from in to out |
| `⌥L` | Loop (between in and out, or the whole clip) |
| `⌥X` | Clear in and out |

**View**

| Key | Action |
|---|---|
| `⌥=` / `⌥−` | Zoom the timeline in · out |
| `⌥0` | Fit the whole clip in the timeline |
| `⇧Z` | Zoom the timeline to in and out |
| `Z` | Zoom the picture: fit · 100% · 200% — drag to look around |
| `G` | Framing guides — again for the next one |
| `F` | Full screen |
| `M` | Mute |
| `⇧↑` / `⇧↓` | Volume up · down |

**Review**

| Key | Action |
|---|---|
| `\` | Flip to the version you compare with |
| `⌘C` | Copy the timecode |
| `⇧⌘C` | Copy a link to this frame |
| `?` | Show these shortcuts |
| `Esc` | Close the player |

## Notes

| Key | Action |
|---|---|
| Double-click | Edit a note or a title |
| `⌘Z` / `⌘⇧Z` | Undo · redo text — history survives closing the note |
| `⌘B` / `⌘I` / `⌘U` | Bold · italic · underline |
| `⌘\` | Clear formatting — links and comments stay |
| `@` | Mention a board, doc, or card |

## Document

These apply inside a [document](/docs/documents), not on the canvas.

| Key | Action |
|---|---|
| `⌘Z` / `⌘⇧Z` | Undo · redo — text while typing; pages & structure otherwise |
| `⌘⌥1` / `⌘⌥0` | Heading 1 · body |
| `⌘⇧7` / `⌘⇧8` / `⌘⇧9` | Numbered · bullet · task list |
| `⌘⇧H` / `⌘E` | Highlight · inline code |
| `⌘\` | Clear formatting — links and comments stay |
| `⌘⇧L` / `⌘⇧E` / `⌘⇧R` | Align left · center · right |
| `⌘K` / `⌘⌥M` | Link · comment |
| `⌘F` | Find and replace |

## Gestures

Not keys, but worth knowing:

- **Double-click empty canvas** opens an add menu at your cursor.
- **Right-click** anything for its full menu — cards, groups, and the canvas background each have their own.
- **Hold `Alt` while dragging** to bypass [snapping](/docs/canvas/snapping-and-alignment).
- **Paste a URL** onto the canvas to create a link card that unfurls its preview.
- **Drag files from your desktop** straight onto the canvas.
