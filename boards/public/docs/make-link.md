# The make-it link

> An AI without the Clusters app can make you a board. It writes the board into a link to https://clusters.soleilpictures.com/make, or as text you paste there, and the page shows the board at once. Enter your email and the code we send, and it becomes a cluster in your account, its pictures copied in. The board rides in the part of the link after the #, which a browser never sends to a server, so nothing reaches Clusters until you keep it. An AI with the app should use it.

_Source: https://clusters.soleilpictures.com/docs/make-link · Updated 2026-10-28_

An AI that can't reach Clusters can still hand you a board. It writes the
board into a link, or as text, and `https://clusters.soleilpictures.com/make` shows it straight
away: sections in their colours, notes sized to their words, pictures at their
own shape, laid out as Clusters lays out a board an AI makes over the
[API](/docs/api/cards). You keep it with your email, and it becomes a cluster
in your account.

## Use the app first

If your AI has the Clusters app (ChatGPT or Claude with Clusters added, or any
[MCP client](/docs/mcp)), it builds the board in your account and shows it in
the chat. That is always the better way: the board is real from the start, the
AI can keep working on it, and it can add documents and arrange what is there.

The make-it link is for every other AI, and for a chat where the app isn't
added yet.

## How it works

1. Ask the AI for a board "for Clusters" (the prompt below says how).
2. It answers with a link to `https://clusters.soleilpictures.com/make#…`, or with the board
   as text.
3. Open the link, or paste the text at `https://clusters.soleilpictures.com/make`. The board
   shows at once.
4. To keep it, enter your email and the 6-digit code we send. It becomes a
   cluster of its own in your workspace, and its pictures are copied in.
   Someone already signed in keeps it with one button, and picks the workspace
   when they can add clusters to more than one.

Nothing is saved until you keep it. The board is in the link's fragment, the
part after `#`, which a browser never sends to a server: the page reads it in
your browser, and Clusters sees it only when you keep it.

## Ask your AI for one

Paste this into any AI, with your idea in place of the brackets:

```text
Make me a board for Soleil Clusters about [your idea].

Give it to me as one link, built like this:
https://clusters.soleilpictures.com/make#title=NAME&section=SECTION&pic=PICTURE_ADDRESS|CAPTION&note=TITLE|BODY&palette=TITLE|#HEX Name,#HEX Name&end=N

- Start each section with section=Name, or section=Name|blue for its colour.
- pic= is the https address of a real picture on the web.
- note= is Title|Body. Write \n for a new line in the body.
- Percent-encode every value (a space is %20), leave each | as it is,
  and finish with end= the number of cards before it.
- Up to 60 cards, 40 of them pictures.

If the link would be too long for this chat, write the board as text instead:
# Board name, ## Section, ### Note title and its lines under it,
![caption](picture address), and Palette: #hex Name, #hex Name.
```

## The link

`https://clusters.soleilpictures.com/make#` followed by `key=value` pairs joined by `&`, as in a
query string. Each value is percent-encoded. Cards come in the order they are
written.

- `title=` names the board, and the cluster it becomes.
- `section=Name` starts a section, and every card after it goes in it until the
  next. `section=Name|colour` gives it a colour: one of the
  [named colours](/docs/api/cards), a plain colour word (`red` is `rose`), or a
  `#hex`. Leave it out and Clusters picks one, as it does over the API. A
  section named again carries on where it was.
- `pic=address` is a picture, and `pic=address|caption` one with a caption.
- `note=Title|Body` is a note, and `note=Body` one with no title. `\n` in the
  body starts a new line, and a line starting `- ` is a bullet.
- `palette=Title|#101820 Ink,#f2aa4c Sodium` is a palette: colours with their
  names, separated by commas.
- `end=N` says how many cards came before it. It makes nothing: it is how the
  page tells a link a chat cut short from a whole one.

A `|` inside a value is written `%7C`. A link a chat shows with each `&`
written `&amp;` reads the same. `name` and `board` also name the board,
`group` is a section, `img`, `image`, `picture` and `photo` are pictures,
`text` is a note, and `colors` or `colours` a palette.

```text
https://clusters.soleilpictures.com/make#title=Tokyo%20noir%2C%201974&section=Look|blue&pic=https%3A%2F%2Fimages.example.com%2Fstreet.jpg|Wet%20street&palette=Night|%23101820%20Ink%2C%23f2aa4c%20Sodium&section=Story&note=Logline|A%20night-shift%20cabbie%20finds%20a%20reel%20of%20film.&end=4
```

## The board as text

When a link would be too long, the AI can write the board as text, and you
paste it at `https://clusters.soleilpictures.com/make`:

```markdown
# Tokyo noir, 1974

## Look (blue)
![Wet street at night](https://images.example.com/street.jpg)
Palette: #101820 Ink, #f2aa4c Sodium, #c0392b Tail light

## Story
### Logline
A night-shift cabbie finds a reel of film in his back seat.

### Tone
- Rain, neon, long lenses
- Quiet, then sudden
```

- `#` names the board. `##` starts a section, with an optional colour in
  brackets: `## Look (blue)` or `## Look {#3f7ab5}`. Brackets that hold no
  colour stay in the name, as in `## Act One (1974)`.
- `###`, or a line in bold, titles a note, and the lines under it are its body.
  A paragraph under no title is a note of its own.
- `![caption](address)` is a picture, and so is a picture's address alone on
  its line.
- `Palette:` and its colours, or a line of two or more `#hex` colours, is a
  palette.
- When there are headings, lines before the first are left out (an AI's "Here
  is your board:").

A link pasted into the box is read as a link.

## Limits

- One board holds up to 60 cards, 40
  of them pictures, in up to 12 sections. Past those the
  rest is left out, and the page says how much.
- The first 24,000 characters of a link or text are read.
- A board's name is up to 120 characters, a note's body
  1,500 and a picture's caption 200;
  longer ones are shortened.
- A picture's address must be `https` on a public site. One that doesn't load
  in your browser is left out, and the board is laid out without it; keeping
  the board never fetches it.
- A link the AI writes inside a note keeps its words and loses its address, so
  nothing on the page is a link someone else wrote.
- Keeping a board needs room for its cards in your plan. A new account is free
  up to 50 cards and 5GB; with less room
  than the board needs, you can keep its first cards or see the
  [plans](/docs/account/plans).
- One address can keep 10 boards a minute.
