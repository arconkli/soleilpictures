# AI Mood Board Maker

> Soleil Clusters connects to Claude, ChatGPT, Cursor, VS Code and other MCP apps, and anyone can try it from Claude or ChatGPT with no account. Ask an assistant and it creates the board, pulls in images from links you give it, and lays them out. It arranges your own references rather than generating pictures.

_Source: https://clusters.soleilpictures.com/tools/ai-mood-board-maker · Updated 2026-11-14_

Point Claude at your clusters and ask. It builds the board, brings in the references, and lays them out.

Used by: Soleil Pictures · Universal Pictures · Blumhouse · NYU

## It arranges your references. It does not invent them.

Most tools that answer to "AI mood board" generate the images. This one does not, and that is the point. A reference board is an argument about a real look — a lens, a film stock, a colourist’s hand, a frame somebody actually shot. Fill it with pictures that never existed and you have a board nobody can match on the day. Bring your own references and the assistant does the tedious half: collecting, arranging, labelling, keeping it tidy as it grows.

- Works with the images and links you already have
- Pulls references from URLs you give it, in one pass
- Lays them out as justified rows or balanced masonry columns

## What "ask for a mood board" actually does

The assistant gets a set of tools, not a text box. It can make a cluster, add image, note, link, video and PDF cards, import a list of URLs in one go, group cards that belong together, put section headings over them, and re-arrange the whole board on request. Ask it to tidy up and it re-flows the layout; ask it to pull twelve references and it fetches them and files them.

- Creates clusters and cards, in bulk
- Imports from a list of links — safe to run twice, nothing duplicates
- Re-arranges an existing board without touching what you positioned by hand

## Connecting is a URL and one button

Soleil Clusters is its own OAuth 2.1 authorization server, listed in the official Model Context Protocol registry as com.soleilpictures/clusters. Your client discovers the sign-in flow by itself, opens a browser, and you approve once. No key to generate, nothing to paste into a configuration file, and no separate account — signing in is a single email box that makes the account if you do not have one.

- Nothing to install for the hosted server
- An npm package for local files, if you want to upload video from your own disk
- Disconnect any time under Settings → Connections

## Connect it from Claude or ChatGPT

Both take the same address, https://clusters.soleilpictures.com/api/v1/mcp. In Claude, on claude.ai or in the desktop app, open Settings → Connectors, add a custom connector and paste it. In ChatGPT, turn on developer mode under Settings → Apps → Advanced settings, then create an app from Settings → Apps and paste the same address; on a Business or Enterprise workspace an admin may need to allow developer mode first. Either one then draws the cluster inside the chat when you ask to see it. An AI that cannot add a connector can still hand you a board as a make-it link, which shows the board before anyone signs in. The MCP docs (/docs/mcp) have the steps for every app, the make-it link page (/docs/make-link) says how that link works, and the security page (/docs/security) says what a connected app can and cannot reach.

- No account yet: https://clusters.soleilpictures.com/mcp builds a draft cluster you keep with a link and your email
- A make-it link carries the board after the #, so nothing reaches Clusters until you keep it
- Connected apps are listed under Settings → Connections → Connected apps, where you can disconnect one

## It reaches exactly what you reach

A connected assistant runs as you, under the same permissions as your browser session — so it can see the clusters you can see, and nothing else. Deleting is a separate permission from writing, deliberately, so an assistant can be allowed to build without being allowed to throw anything away. Every call it makes is recorded, with the name of the tool it used, in an audit log you can read.

- Same permissions as your own account, enforced by the database
- Deleting is opt-in and off by default
- An audit log of every action, naming the tool

## How to build a mood board with your assistant

1. **Add the URL to your client** — In Claude, or any MCP client, add https://clusters.soleilpictures.com/api/v1/mcp as a connector. There is nothing to install.
2. **Approve it once** — A browser opens, you sign in with your email, and you press Allow. If you do not have an account yet, that screen makes one.
3. **Ask for what you want** — Describe the board in plain language — the project, the references you have, how you want them grouped.
4. **Open it and take over** — The board is a normal cluster. Drag things, add notes, share the link. The assistant started it; it is yours.

## Frequently asked questions

### Does it generate images with AI?

No. It works with references you already have, or that you point it at with a link. It builds and arranges the board; it does not invent pictures. For reference work that is the right way round — a board full of images nobody can actually shoot is not much use on the day.

### Which assistants work with it?

Claude, ChatGPT, Cursor, VS Code and any other app that speaks the Model Context Protocol. Anyone can try it from Claude or ChatGPT with no account: the assistant builds a draft and you keep it with a link. The hosted server is a URL, so anything that can add a remote MCP connector can use it. There is also an npm package, soleil-clusters-mcp, for clients that need to read files off your own machine.

### Does it work with ChatGPT?

Yes. In ChatGPT, turn on developer mode under Settings → Apps → Advanced settings, create an app from Settings → Apps, and paste https://clusters.soleilpictures.com/api/v1/mcp. On a Business or Enterprise workspace an admin may need to allow developer mode first. ChatGPT then builds the board in your account and draws it inside the chat. To try it with no account, use https://clusters.soleilpictures.com/mcp instead: ChatGPT builds a draft cluster and gives you a link to keep it.

### Which mood board apps have an MCP server?

As of 14 November 2026: Soleil Clusters has one, listed in the official Model Context Protocol registry as com.soleilpictures/clusters. Miro publishes an official MCP server. Storyflow’s pricing page says Claude, ChatGPT, Gemini and Grok work on its boards through MCP. The registry’s one Milanote entry is published by a third party, not by Milanote. PureRef is a desktop program for Windows, Mac and Linux, and neither its site nor the registry lists an MCP server for it; a community project on GitHub, PureRef MCP, writes .pur files from images on your computer for PureRef to open.

### Do I need to be a developer?

No. You add one URL to your assistant and press Allow in the browser. There is no key to generate and nothing to paste into a configuration file.

### Can the assistant delete my work?

Only if you let it. Deleting is a separate permission from writing and is not granted by default, so an assistant can build boards without being able to remove anything. You can disconnect it at any time under Settings → Connections, which stops it working immediately.

### Can it see all of my boards?

It sees exactly what your account sees — no more. It runs as you, under the same database permissions as your browser session, so a cluster you cannot open is one it cannot open either.

### Is it free?

Yes. Connecting an assistant costs nothing and works on the free plan. The usual plan limits apply to what it creates, exactly as they would if you made those cards yourself — the free Demo tier covers 25 cards or 5GB of files, whichever comes first, and the clusters it makes cost none of them.

