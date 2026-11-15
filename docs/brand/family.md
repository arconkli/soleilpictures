# The Soleil family

How the studio and its products are named, addressed and described to search engines, and the checklist for adding a product. Back to the [brand book](README.md).

## Names

**Soleil** is the family name. It is never a product on its own. In the legal text it is the short form for the company (`COMPANY` in `boards/src/auth/legalContent.js`), and in code it names the gold (`--soleil`). In public copy it always comes with a second word.

**Soleil Pictures** is the studio: the company, the parent and the legal party. It signs the terms, the copyright line and the endorsement.

**Soleil <Name>** is a product, in full. Today there are two:

- **Soleil Clusters**: the creative workspace and moodboard. Short form **Clusters**.
- **Soleil Scout**: text a picture and it lands on a canvas. Short form **Scout**.

Use the full name where a stranger meets the product: page titles, link cards, structured data, the first sentence of a docs page, a store listing. Use the short form inside the product and once the context is set: "Open Clusters", "Help improve Clusters?", "Your Clusters sign-in code". (`boards/index.html`; `boards/content/docs/`; `supabase/functions/_shared/email/templates.ts`.) The `alternateName` in structured data is the short form.

A product's name is one plain English word that says what it holds or does. Clusters holds clusters of references; Scout goes and looks. (New in this guide, read from the two names that exist.) A product names its main object once, in the interface, and keeps that word in email and docs. (New in this guide.)

Old names stay in code and stay out of copy. Clusters was Soleil Boards until May 2026, and the Worker, the package and the database still say board. The interface says cluster; the API, the database and developer docs say board. Neither is fixed to match the other. (Repo `CLAUDE.md`; `boards/content/docs/concepts.md`.)

## Architecture

The family is an endorsed house: the studio stands behind each product, and each product has its own name, its own mark and its own place on the web.

```
Soleil Pictures                the studio, parent, legal party
├── Soleil Clusters            product
└── Soleil Scout               product (lives inside Clusters today)
```

- A product does **not** wear the studio's half-sun. It gets its own mark drawn from the Soleil sun (see [marks.md](marks.md)).
- The studio does **not** need a product's mark on its site. It names its products in words: the studio's navigation links to "Clusters" by name (`index.html` at the repo root).
- The studio is a credential, said plainly: "What stands behind Clusters is a working film studio: it is built by Soleil Pictures and used on our own productions" (`boards/src/lib/seoLanding.js`).

## The endorsement line

The one line that ties a product to the studio is:

> **<Name> by Soleil Pictures**

It is the HTML email footer today, "Clusters by Soleil Pictures · clusters.soleilpictures.com" (`supabase/functions/_shared/email/theme.ts`; `supabase/templates/magic_link.html`). Use it in email footers, on the about or legal page, and at the foot of a landing page. Where a sentence reads better, public copy may say "built by Soleil Pictures, a working film studio".

The copyright line is separate and stays as it is: "© Soleil Pictures" (`boards/src/pages/ScoutPage.jsx`; the plain-text emails).

Never write "a part of Soleil Pictures", "Soleil Pictures presents", or a product name followed by "by Soleil" alone.

## Domains and addresses

| What | Pattern | Today |
|---|---|---|
| Studio site | `soleilpictures.com` | the static site at the repo root |
| A product | `<name>.soleilpictures.com` | clusters.soleilpictures.com |
| Product email sender | `<Name> <noreply@updates.soleilpictures.com>` | the Clusters sender |
| Replies | `hello@soleilpictures.com` | pinned by `boards/src/lib/emailReplyTo.test.mjs` |
| Security | `security@soleilpictures.com` | `boards/public/.well-known/security.txt` |
| Studio contact | `contact@soleilpictures.com` | the studio's "Contact Us" |
| Native app id | `com.soleilpictures.<name>` | `com.soleilpictures.clusters` (`boards/capacitor.config.ts`) |
| MCP registry name | com.soleilpictures/<name> | com.soleilpictures/clusters (`mcp/server.json`) |
| Social handle | `soleil<name>` | `@soleilclusters` (new in this guide as a pattern) |

In prose a domain is written lowercase with no scheme: clusters.soleilpictures.com. In structured data and llms.txt it carries https://.

Some subdomains are already taken by undeliverable system addresses and are never shown as a brand: `draft.`, `service.` and `scout.soleilpictures.com` (`boards/src/lib/mcpDrafts.js`, `boards/src/lib/apiAuth.js`, `boards/src/lib/scoutIdentity.js`). A new product checks its subdomain against these first. Scout's public page lives at clusters.soleilpictures.com/scout for this reason.

## Structured data

Each product describes itself as its own `Organization`, with the studio as `parentOrganization`. The studio lists each product back as a `subOrganization`. Both sides use the same `@id`s and the same one-sentence description, word for word. `sameAs` stays empty until the owner confirms a profile; only confirmed profiles go there, as on Clusters.

On the product's site (`boards/index.html` is the pattern):

```json
{
  "@type": "Organization",
  "@id": "https://<name>.soleilpictures.com/#organization",
  "name": "Soleil <Name>",
  "alternateName": "<Name>",
  "url": "https://<name>.soleilpictures.com/",
  "logo": {
    "@type": "ImageObject",
    "url": "https://<name>.soleilpictures.com/<name>-logo-dark.png",
    "width": 2048,
    "height": 2048
  },
  "description": "<One sentence, word for word the same on both sites.>",
  "sameAs": [],
  "parentOrganization": {
    "@id": "https://soleilpictures.com/#organization",
    "name": "Soleil Pictures",
    "url": "https://soleilpictures.com/"
  }
}
```

On the studio site (`index.html` at the repo root), the product is added under `subOrganization` with the same `@id`, `name`, `alternateName`, `url` and description. With two or more products, `subOrganization` becomes a list.

The reasons are in the comment above the Clusters graph: people search the brand "Soleil Clusters", so that is the entity the product site describes; the studio is its parent, not its name. `boards/src/lib/brandJsonLd.test.mjs` pins the pattern: one description on both sites, exactly one top-level `Organization` on the product site, no duplicate `@id`, and `sameAs` holds only profiles the owner has confirmed ("Adding one is a decision, not a fix"). A new product extends that test in the same commit. Structured data carries no price: a price there would be a hand-typed number.

Scout is not in the structured data of either site today: `boards/index.html` links to it only in its fallback page, and `index.html` at the repo root does not name it. A product is added by this pattern.

## New product checklist

Work through these in order. Each points at the page with the rule.

1. **Name.** Soleil <Name>, one plain word; short form <Name> inside the product. Check the word against existing products, plan names and the system subdomains above. ([Names](#names))
2. **Domain.** `<name>.soleilpictures.com`, bound before anything public points at it. ([Domains](#domains-and-addresses))
3. **Mark.** Draw it from the three-tone sun, arranged to say what the product does, with ink as the only other colour. Keep an SVG source. Make dark and light versions and check it at 16px. ([marks.md](marks.md))
4. **Wordmark.** The short name typed in Brandon capitals beside the mark. Not drawn. ([marks.md](marks.md))
5. **App icon.** The mark full bleed on night, one source for every platform. ([marks.md](marks.md))
6. **Favicon.** A version that holds on both a light and a dark browser tab. ([marks.md](marks.md))
7. **Link card.** 1200x630 on night, the product's wordmark, a Brandon headline, at most one gold accent. ([marks.md](marks.md))
8. **Landing page.** Product register: night ground, ink chrome, gold for the one action, the work carrying the colour. A soft gold glow is allowed behind the mark. ([README](README.md#two-registers))
9. **Fonts.** Add the product's domain to the Adobe Fonts kit `qtd2rwk` before launch, so the fonts load there. ([README](README.md#type))
10. **Tokens.** Start from `docs/brand/tokens.json` and the Clusters custom properties; add product-specific ones only where the product needs them. Tokens that belong to one product are prefixed with its name (`<name>-`) and listed on that product's page (new in this guide). ([clusters.md](clusters.md))
11. **Email.** The Darkroom look from `supabase/functions/_shared/email/theme.ts`, the product's mark on top, footer "<Name> by Soleil Pictures · <domain>". ([README](README.md#email))
12. **Words.** The family voice: present tense, plain, no exclamation marks, no emoji, numbers from code, deletes that offer Undo. ([voice.md](voice.md))
13. **Structured data.** The product's `Organization` with `parentOrganization`; the studio's `subOrganization`; the test extended. ([Structured data](#structured-data))
14. **Docs.** Public docs for every public surface, written in the same commit as the surface, as Clusters does under `boards/content/docs/`.
15. **This guide.** Add the product to the [family](#architecture), add its mark to [marks.md](marks.md), and record anything that does not match in [drift.md](drift.md).
