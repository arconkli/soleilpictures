# Clusters as the obvious way to organize — design

Date: 2026-10-18. Status: approved by the owner; building behind a preview-only
hold (`clusterNudgesAllowed()`), released on the owner's "ship it".

Counts and baselines stay out of this file: the repo is public. They live in
the session plan and in the admin reads.

## Why

New accounts land on the root cluster, Studio, and nearly everything they add
stays loose there. Few people ever make a second cluster, and many clusters
that do get made are never named or are deleted soon after. Reading the code
showed clusters were hard to reach:

- The rail Cluster tool is one of eight identical icons.
- The first-board panel hides the Cluster tile (`firstBoardCopy.js`).
- Each cluster costs one card on the free plan.
- Nothing turns selected cards into a cluster.
- "Move to cluster…" disappears when Studio is the only cluster.
- Most create paths leave the cluster named "Untitled cluster".

The owner's view: a cluster is the most important tool, and it should read
that way.

In this product's data, using a cluster on day one has not predicted return
within depth bands. Research on filing finds that forcing people to file does
not, on its own, help. This change is therefore a measured bet, not an assumed
fix. It also helps sharing: a project in its own cluster can be shared alone,
and invitees are the strongest return signal on record.

## Decisions (owner, 2026-10-18)

1. Nudge by default and never block. People keep landing on Studio.
2. A labeled "+ New cluster" button after the breadcrumb on every board. The
   rail's Cluster tool moves to the top in its own section, bigger, with its
   name under the icon.
3. An empty Studio adds "Working on more than one thing? Start a cluster for
   each" under the drop area. Dropping images stays the primary first act.
4. Clusters stop counting toward the free card cap (card weight 0). The cap
   itself does not change. Linked clusters (`boardlink`) still weigh 1.
5. An existing pile on Studio gets one dismissible offer to move it into a
   cluster. Nothing is ever moved without a click.
6. It ships to everyone, with a before/after read fixed in advance and no
   holdout.

## What changes

- **Make a cluster from what is already there.**
  - "New cluster from N cards" next to "Group (N)".
  - "Move to → New cluster…", which works even when Studio is the only
    cluster.
  - "Turn into cluster" on a canvas group.
  - "New cluster" in the list view's selection bar.
  - One undo reverses the move and deletes the new cluster.
- **Name at birth.** Every path asks for a name or focuses it. Suggested names
  come from the canvas group name, then a shared filename stem, then the first
  note's title.
- **Reach.** Cluster appears in the double-click quick-add menu. **C** arms the
  rail tool.
- **Studio bar.** On a return visit, when Studio holds six or more loose cards,
  a bar offers once per device: "N cards on Studio aren't in a cluster · Move
  them into one". It replaces the one-shot `group` power reveal.
- **Second idea.** A paste or drop onto a board that already holds six or more
  cards, at least three hours after the last add there, offers "Start a new
  cluster with these" on its toast.
- **Free clusters.** The release migration changes `_tg_card_weight_by_kind`.
  A `board` card weighs 0 only when its id is a real board in the same
  workspace, so relabeling a note does not dodge the cap. The backfill runs
  with user triggers disabled so it stamps no activity.

## Instruments

- `cluster_create.via` gains: `folder_import`, `files_empty`,
  `from_selection`, `from_list_selection`, `move_to_new`, `from_group`,
  `studio_sweep`, `second_idea`, `topbar`, `empty_studio`.
- `cluster_rename {board_id, via, from_default, len}` records a real name
  change. The name itself is never sent.
- `cluster_nudge {surface, action}` covers the Studio bar, the second-idea
  offer, the empty-Studio line and the top-bar button: shown, accepted,
  dismissed.

## Pre-registered read

Windows: a leading read 2 weeks after the release deploy, and an outcome read
at 4 and 8 weeks. Never read inside 3 days of a ship. Source-adjust every
comparison by acquisition channel. Baseline cohorts are first visits from
2026-09-13 to 2026-10-04, and from 2026-10-05 to the release.

| Role | Metric |
|---|---|
| Primary | Share of new card-placers with a named cluster (not the default name) holding ≥5 non-cluster cards within 7 days of their first visit |
| Behaviour | ≥2 such clusters by day 14 |
| Behaviour | Share of first-week cards loose on Studio |
| Behaviour | Share of new clusters still default-named after 7 days |
| Behaviour | Share of new clusters deleted |
| Feature use | Each new `via` |
| Feature use | `cluster_nudge` accept rates |
| Guardrail (must not fall) | Share of first visits that place ≥1 non-cluster card |
| Outcome (the bet) | 7-day return on honest visits (`_admin_visits`), plus returned-and-built, by day-one depth band |

At current volume, a four-week read can resolve only a large change in return.
A null outcome does not show clusters don't matter, and the readout has to say
so.
