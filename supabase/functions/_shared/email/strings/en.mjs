// en: the English words of every email Clusters sends, and the source each
// other language is translated from. The keys are <template>.<part>; pieces
// several emails share are under common.; the sign-in code email is magic_link.
// and the trial-ending email is trial_ending.
//
// A value is a plain sentence with {placeholders}. {name}, {inviter} and the
// like are a person's display name or an email address, exactly as typed:
// keep it as it comes and never change it. {board} is a cluster's name and
// {workspace} a workspace's name, also as typed; the word "cluster" is what the
// app calls a board. {url} is a link. A counted noun is an object of plural
// forms ("one", "other", and the others the language needs), and {count} is
// the number. Keep every {placeholder} of the English in the translation.
//
// Emails read in a hurry and in a small inbox row: keep subjects short, and
// keep the lowercase, plain voice of the notes. No HTML belongs in a value.
//
// Not here, on purpose: the brand line ("Clusters by Soleil Pictures"), the
// wordmark, the postal address and the copyright line stay English in every
// language. The emails below that read English for everyone (waitlist,
// product update, what's new, share activity, schedule, the two paused nudges
// and the owner's alerts) keep their own words in templates.ts.
export default {
  // ── Pieces every email shares ──────────────────────────────────────────────
  // A button's words followed by an arrow, in the lifecycle notes. {label} is the button's words.
  "common.cta_arrow": "{label} →",
  // A line of the plain-text version: a button's words, then the link it opens.
  "common.label_url": "{label}: {url}",
  // The last line of the plain-text version of a lifecycle note. {url} is a link that turns the notes off.
  "common.unsubscribe_text": "Unsubscribe: {url}",
  // The small line under a lifecycle note. {link} is the link, written with the words of common.unsubscribe_link.
  "common.unsubscribe_note": "Not into these? {link}.",
  // The words of that link.
  "common.unsubscribe_link": "Unsubscribe",
  // The link in the footer of mentions, replies and invite rewards that turns that kind of email off.
  "common.turn_off_link": "Turn these emails off",
  // The same, as a line of the plain-text version. {url} is the link.
  "common.turn_off_text": "Turn these emails off: {url}",
  // Under a button in a lifecycle note whose link would land the reader at the sign-in screen.
  "common.signed_out_caveat": "signed out? we'll email you a 6-digit code — no password to dig up.",
  // The closing line of a lifecycle note, from the team.
  "common.signoff": "talk soon, the clusters team",
  // The opening line of a lifecycle note, from the team.
  "common.note_hello": "hey, the clusters team here.",
  // A message someone wrote, quoted in the plain-text version. {text} is what they wrote.
  "common.text_quote": "\"{text}\"",
  // The description of a picture of the reader's own cluster. {name} is the cluster's name.
  "common.board_alt_named": "Your board \"{name}\"",
  // The same, for a cluster with no name.
  "common.board_alt": "Your board",
  // Stands in for a missing person's name inside other sentences, so it must read as a plain noun phrase (a pronoun or "someone").
  "common.fallback_person": "Someone",
  // Stands in for a missing workspace name inside other sentences, so it must read as a plain noun phrase, as in "in your workspace".
  "common.fallback_your_workspace": "your workspace",
  // Stands in for a missing workspace name inside other sentences, so it must read as a plain noun phrase, as in "a workspace".
  "common.fallback_workspace": "a workspace",
  // Stands in for a missing cluster name inside other sentences, so it must read as a plain noun phrase.
  "common.fallback_board": "a board",
  // Stands in for a missing cluster name inside other sentences, so it must read as a plain noun phrase.
  "common.fallback_cluster": "a cluster",
  // Stands in for a missing team name inside other sentences, so it must read as a plain noun phrase.
  "common.fallback_team": "a team",
  // Stands in for a missing file name inside other sentences, so it must read as a plain noun phrase.
  "common.fallback_file": "a file",
  // Stands in for a missing document title inside other sentences, so it must read as a plain noun phrase.
  "common.fallback_document": "a document",

  // ── What the person added (the counts and tiles in two lifecycle notes) ────
  // Each is one kind of card, counted: "a photo" for one, "38 photos" for more. Read in a list: "38 photos, 4 notes and a PDF".
  "added.image": { "one": "a photo", "other": "{count} photos" },
  "added.video": { "one": "a video", "other": "{count} videos" },
  "added.note": { "one": "a note", "other": "{count} notes" },
  "added.link": { "one": "a link", "other": "{count} links" },
  "added.doc": { "one": "a doc", "other": "{count} docs" },
  "added.pdf": { "one": "a PDF", "other": "{count} PDFs" },
  "added.file": { "one": "a file", "other": "{count} files" },
  "added.audio": { "one": "an audio file", "other": "{count} audio files" },
  // The small label above each tile in the row of what the person added, one word for the kind of card.
  "strip.image": "photo",
  "strip.video": "video",
  "strip.note": "note",
  "strip.link": "link",
  "strip.doc": "doc",
  "strip.pdf": "PDF",
  "strip.file": "file",
  "strip.audio": "audio",

  // ── workspace_invite: someone added the reader to their workspace (reader has an account) ──
  // {inviter} is who added them. {workspace} is the workspace's name.
  "workspace_invite.subject": "{inviter} added you to {workspace}",
  "workspace_invite.eyebrow": "Workspace",
  "workspace_invite.headline": "You're in {workspace}.",
  // One sentence per role they were added with. {role} in the last one is any other role, in lowercase.
  "workspace_invite.subtitle_member": "{inviter} added you as member — jump in and build together.",
  "workspace_invite.subtitle_editor": "{inviter} added you as editor — jump in and build together.",
  "workspace_invite.subtitle_viewer": "{inviter} added you as viewer — jump in and build together.",
  "workspace_invite.subtitle_admin": "{inviter} added you as admin — jump in and build together.",
  "workspace_invite.subtitle_coowner": "{inviter} added you as coowner — jump in and build together.",
  "workspace_invite.subtitle_other": "{inviter} added you as {role} — jump in and build together.",
  "workspace_invite.cta": "Open workspace",

  // ── board_shared: someone shared a cluster with the reader (reader has an account) ──
  // {sharer} is who shared it. {board} is the cluster's name.
  "board_shared.subject": "{sharer} shared \"{board}\" with you",
  "board_shared.eyebrow": "Cluster shared",
  "board_shared.headline": "{sharer} wants to build with you.",
  // One sentence per kind of access. {role} in the last one is any other role, in lowercase.
  "board_shared.subtitle_viewer": "You've got viewer access to \"{board}\" — hop in.",
  "board_shared.subtitle_editor": "You've got editor access to \"{board}\" — hop in.",
  "board_shared.subtitle_other": "You've got {role} access to \"{board}\" — hop in.",
  "board_shared.cta": "Open cluster",

  // ── invite_accepted: someone the reader invited has joined; sent to the person who invited them ──
  // {joiner} is who joined.
  "invite_accepted.eyebrow": "They're in",
  "invite_accepted.headline": "{joiner} just joined you.",
  // They joined one cluster. {board} is its name. One sentence per kind of access; {role} in the last one is any other role, in lowercase.
  "invite_accepted.subject": "{joiner} joined \"{board}\"",
  "invite_accepted.subtitle_viewer": "They now have viewer access to \"{board}\" — go say hi and build together.",
  "invite_accepted.subtitle_editor": "They now have editor access to \"{board}\" — go say hi and build together.",
  "invite_accepted.subtitle_other": "They now have {role} access to \"{board}\" — go say hi and build together.",
  "invite_accepted.cta": "Open board",
  // They joined a whole workspace. {workspace} is its name; the first two are for someone who can only look, the other for someone who can edit.
  "invite_accepted.workspace_subject": "{joiner} joined {workspace}",
  "invite_accepted.workspace_subtitle_viewer": "They can now see everything in {workspace}, every cluster and file. Go say hi.",
  "invite_accepted.workspace_subtitle_editor": "They can now see and edit everything in {workspace}, every cluster and file. Go say hi and build together.",
  // The button names the workspace; a long name reads "your workspace" instead.
  "invite_accepted.workspace_cta_named": "Open {workspace}",
  "invite_accepted.workspace_cta_generic": "Open your workspace",

  // ── invite_reward: a friend the reader invited added their first card, so the reader earned more room ──
  // {count} is the number of cards earned and {storage} the storage, written like "0.5GB". When a number is missing the sentence says just "more".
  "invite_reward.eyebrow": "Invite reward",
  "invite_reward.subject": { "one": "You earned {count} more cards", "other": "You earned {count} more cards" },
  "invite_reward.subject_more": "You earned more cards",
  "invite_reward.headline": { "one": "You earned {count} more cards.", "other": "You earned {count} more cards." },
  "invite_reward.headline_more": "You earned more cards.",
  "invite_reward.subtitle_cards_storage": {
    "one": "A friend you invited just added their first card to Clusters, so you get {count} more cards and {storage} more storage.",
    "other": "A friend you invited just added their first card to Clusters, so you get {count} more cards and {storage} more storage.",
  },
  "invite_reward.subtitle_cards": {
    "one": "A friend you invited just added their first card to Clusters, so you get {count} more cards and more storage.",
    "other": "A friend you invited just added their first card to Clusters, so you get {count} more cards and more storage.",
  },
  "invite_reward.subtitle_storage": "A friend you invited just added their first card to Clusters, so you get more cards and {storage} more storage.",
  "invite_reward.subtitle_plain": "A friend you invited just added their first card to Clusters, so you get more cards and more storage.",
  "invite_reward.cta": "Open Clusters",
  "invite_reward.caveat": "You're getting this because you invited someone.",

  // ── edit_request: someone who can view a shared cluster asked to edit it; sent to the person who shared it ──
  // {name} is who asked. {board} is the cluster's name.
  "edit_request.subject": "{name} asked to edit “{board}”",
  "edit_request.eyebrow": "Edit request",
  "edit_request.headline": "{name} asked to edit.",
  "edit_request.subtitle": "{name} can see “{board}” and asked to edit it.",
  "edit_request.caveat": "Not now? Ignore this. They keep view access.",
  // The button. {name} is the asker's first name; the second is for when we only have an email address.
  "edit_request.cta_named": "Let {name} edit",
  "edit_request.cta_them": "Let them edit",

  // ── edit_granted: the sharer said yes to an edit request; sent to the person who asked ──
  // {name} is the person who shared the cluster. {board} is its name.
  "edit_granted.subject": "{name} said yes: you can edit “{board}”",
  "edit_granted.eyebrow": "You can edit",
  "edit_granted.headline": "{name} said yes.",
  "edit_granted.subtitle": "You can now edit “{board}”.",
  // The button names the cluster; a long name reads "cluster" instead.
  "edit_granted.cta_named": "Open {board}",
  "edit_granted.cta_generic": "Open cluster",

  // ── pending_invite: an invitation to someone with no account yet (a stranger reads this) ──
  // {inviter} is who invited them, usually an email address. {workspace} and {board} are names. {cards} is how many free cards they start with. {days} is how long the link works. The five subtitles and the caveat are plurals: their forms follow {cards} and {days}.
  "pending_invite.subject": "You've been invited to collaborate on Clusters",
  "pending_invite.eyebrow": "Invitation",
  "pending_invite.headline": "{inviter} invited you.",
  // Invited to a whole workspace, as a member, an editor or a viewer.
  "pending_invite.subtitle_workspace_member": {
    "one": "You've been invited to join {workspace} as a member. You'll start with {cards} free cards — sign in and we'll set up your account.",
    "other": "You've been invited to join {workspace} as a member. You'll start with {cards} free cards — sign in and we'll set up your account.",
  },
  "pending_invite.subtitle_workspace_editor": {
    "one": "You've been invited to join {workspace} as an editor. You'll start with {cards} free cards — sign in and we'll set up your account.",
    "other": "You've been invited to join {workspace} as an editor. You'll start with {cards} free cards — sign in and we'll set up your account.",
  },
  "pending_invite.subtitle_workspace_viewer": {
    "one": "You've been invited to join {workspace} as a viewer. You'll start with {cards} free cards — sign in and we'll set up your account.",
    "other": "You've been invited to join {workspace} as a viewer. You'll start with {cards} free cards — sign in and we'll set up your account.",
  },
  // Invited to one cluster inside a workspace, as an editor or a viewer.
  "pending_invite.subtitle_board_editor": {
    "one": "You've been invited to join \"{board}\" in {workspace} as an editor. You'll start with {cards} free cards — sign in and we'll set up your account.",
    "other": "You've been invited to join \"{board}\" in {workspace} as an editor. You'll start with {cards} free cards — sign in and we'll set up your account.",
  },
  "pending_invite.subtitle_board_viewer": {
    "one": "You've been invited to join \"{board}\" in {workspace} as a viewer. You'll start with {cards} free cards — sign in and we'll set up your account.",
    "other": "You've been invited to join \"{board}\" in {workspace} as a viewer. You'll start with {cards} free cards — sign in and we'll set up your account.",
  },
  "pending_invite.cta": "Accept invitation",
  "pending_invite.caveat": {
    "one": "We'll email you a 6-digit code to sign in. The invite link works for {days} days.",
    "other": "We'll email you a 6-digit code to sign in. The invite link works for {days} days.",
  },

  // ── team_invite: an invitation to join a team (a stranger may read this) ──
  // {inviter} is who invited them. {team} is the team's name. {days} is how long the invitation works. The caveat is a plural: its forms follow {days}.
  "team_invite.subject": "You've been invited to a team on Clusters",
  "team_invite.eyebrow": "Team invitation",
  "team_invite.headline": "{inviter} invited you.",
  "team_invite.subtitle_admin": "Join {team} on Clusters as an admin. Your own workspaces stay yours: the team never sees them.",
  "team_invite.subtitle_viewer": "Join {team} on Clusters as a viewer. Your own workspaces stay yours: the team never sees them.",
  "team_invite.subtitle_member": "Join {team} on Clusters as a member. Your own workspaces stay yours: the team never sees them.",
  "team_invite.cta": "Join the team",
  "team_invite.caveat": {
    "one": "Sign in with this email address and we'll send you a 6-digit code. The invite works for {days} days.",
    "other": "Sign in with this email address and we'll send you a 6-digit code. The invite works for {days} days.",
  },

  // ── mention_email: someone @mentioned the reader in a message ──
  // {name} is who mentioned them. {context} is the cluster's or workspace's name. {preview} is the start of the message.
  "mention_email.eyebrow": "Mention",
  "mention_email.headline": "{name} mentioned you.",
  // The subject and the line under the headline: in a direct message, in a cluster, in a workspace.
  "mention_email.subject_dm": "{name} mentioned you",
  "mention_email.subject_board": "{name} mentioned you in {context}",
  "mention_email.subject_comment": "{name} mentioned you in a comment in {context}",
  "mention_email.subject_workspace": "{name} mentioned you in {context}",
  "mention_email.subtitle_dm": "In a direct message.",
  "mention_email.subtitle_board": "In {context}.",
  "mention_email.subtitle_comment": "In a comment in {context}.",
  "mention_email.subtitle_workspace": "In {context}.",
  // The preview line an inbox shows beside the subject. The second is for a mention with no text.
  "mention_email.preheader": "{name}: {preview}",
  "mention_email.preheader_empty": "{name}: mentioned you",
  "mention_email.cta": "Open in Clusters",
  "mention_email.cta_comment": "Open the comment",

  // ── comment_reply_email: someone replied to the reader's comment on a cluster ──
  // {name} is who replied. {board} and {workspace} are names. {preview} is the start of the reply.
  "comment_reply_email.subject": "{name} replied to your comment",
  "comment_reply_email.eyebrow": "Reply",
  "comment_reply_email.headline": "{name} replied.",
  "comment_reply_email.subtitle": "On \"{board}\" in {workspace}.",
  "comment_reply_email.preheader": "{name}: {preview}",
  "comment_reply_email.preheader_empty": "{name}: replied to your comment",
  "comment_reply_email.cta": "Open comment",

  // ── file_shared: someone shared a single file or document with the reader ──
  // {name} is who shared it. {file} is the file's name, already tidied for an email.
  "file_shared.subject": "{name} shared \"{file}\" with you",
  "file_shared.headline_doc": "{name} shared a document with you.",
  "file_shared.headline_file": "{name} shared a file with you.",
  "file_shared.eyebrow_doc": "Document shared",
  "file_shared.eyebrow_file": "File shared",
  // What they can do: edit a document, only read it, comment on a file, only view it.
  "file_shared.subtitle_doc_edit": "You can view and edit \"{file}\".",
  "file_shared.subtitle_doc_view": "You can view \"{file}\".",
  "file_shared.subtitle_file_comment": "You can view and comment on \"{file}\".",
  "file_shared.subtitle_file_view": "You can view \"{file}\".",
  "file_shared.cta_doc": "Open document",
  "file_shared.cta_file": "Open file",

  // ── file_commented: someone commented on a file the reader shared ──
  // {name} is who commented. {file} is the file's name. {preview} is the start of the comment.
  "file_commented.subject": "{name} commented on \"{file}\"",
  "file_commented.eyebrow": "Comment",
  "file_commented.headline": "{name} commented.",
  "file_commented.subtitle": "On \"{file}\".",
  "file_commented.preheader": "{name}: {preview}",
  "file_commented.preheader_empty": "{name}: left a comment",
  "file_commented.cta": "Open file",

  // ── activate_nudge_1: a note to someone who signed up and has done little since ──
  // {name} is their cluster's name. {phrase} is what they added, like "38 photos, 4 notes and a PDF".
  // Two notes: what they have put on the cluster so far, and a first-picture nudge for an empty one.
  // Opening line of "what you've added", ending in a colon when the tiles follow it, or a full stop after {phrase} when they do not.
  "activate_nudge_1.added_named_tiles": "here's what you've put on \"{name}\" so far:",
  "activate_nudge_1.added_named_phrase": "here's what you've put on \"{name}\" so far: {phrase}.",
  "activate_nudge_1.added_plain_tiles": "here's what you've put on your board so far:",
  "activate_nudge_1.added_plain_phrase": "here's what you've put on your board so far: {phrase}.",
  "activate_nudge_1.added_body": "it's all saved. boards really click at about ten things — paste an image from any tab (⌘V), or drop a whole folder on the canvas and it files itself.",
  // The preview line in the inbox. {count} is how many things they added.
  "activate_nudge_1.added_preheader": {
    "one": "the thing you added is saved. a few more and it starts to take shape.",
    "other": "the {count} things you added are saved. a few more and it starts to take shape.",
  },
  "activate_nudge_1.added_subject_named": "here's \"{name}\" so far",
  "activate_nudge_1.added_subject_plain": "here's your board so far",
  // The nudge for a cluster with nothing on it yet.
  "activate_nudge_1.empty_named": "you made \"{name}\" — it's open and waiting for its first picture.",
  "activate_nudge_1.empty_plain": "your board is open and waiting for its first picture.",
  "activate_nudge_1.empty_body": "the quickest way in: copy an image anywhere on the web and paste it onto the board (⌘V), or drop a whole folder on the canvas and it files itself into clusters.",
  "activate_nudge_1.empty_preheader": "paste an image from any tab, or drop a folder. it arranges itself.",
  "activate_nudge_1.empty_subject_named": "\"{name}\" is ready for its first picture",
  "activate_nudge_1.empty_subject_plain": "your board is ready for its first picture",
  // The button, in both notes.
  "activate_nudge_1.cta_named": "open \"{name}\"",
  "activate_nudge_1.cta_plain": "open clusters",

  // ── reengage_1: a win-back note to someone who built something and went quiet ──
  // {name} is their cluster's name. Two versions of the note (the second one starts "quick nudge").
  "reengage_1.subject_named": "\"{name}\" is right where you left it",
  "reengage_1.subject_plain": "your board's right where you left it",
  "reengage_1.preheader": "it's all still there, right where you left it.",
  "reengage_1.opener_named": "you built \"{name}\" in clusters, then went quiet. happens to the best of us.",
  "reengage_1.opener_plain": "you built something real in clusters, then went quiet. happens to the best of us.",
  "reengage_1.body": "it's all still there, exactly how you left it. no pressure, but if a few new things have piled up since, this is a good moment to drop them in.",
  "reengage_1.lead_in": "pick up where you left off:",
  "reengage_1.cta_named": "open \"{name}\"",
  "reengage_1.cta_plain": "open my board",
  "reengage_1.b_subject_named": "your board \"{name}\" is still here",
  "reengage_1.b_subject_plain": "your boards are still here",
  "reengage_1.b_preheader": "the easy place to put whatever's been piling up.",
  "reengage_1.b_nudge_named": "quick nudge: \"{name}\" is still sitting in your workspace.",
  "reengage_1.b_nudge_plain": "quick nudge: your boards are still sitting in your workspace.",
  "reengage_1.b_body": "if new references or ideas have been piling up, this is the easy place to put them.",
  "reengage_1.b_lead_in": "jump back in:",
  "reengage_1.b_cta_named": "open \"{name}\"",
  "reengage_1.b_cta_plain": "open my boards",

  // ── welcome_board: the day-after welcome, with a picture of the reader's own cluster when there is one ──
  // {name} is their cluster's name. Each opener has a form for when the picture follows it and a form for when it does not.
  "welcome_board.subject": "look what you made",
  "welcome_board.preheader": "one day in, and your board is already taking shape.",
  "welcome_board.opener_named_picture": "you started \"{name}\" yesterday — here's how it's looking already.",
  "welcome_board.opener_named_text": "you started \"{name}\" yesterday — it's already taking shape.",
  "welcome_board.opener_plain_picture": "you started a board yesterday — here's how it's looking already.",
  "welcome_board.opener_plain_text": "you started a board yesterday — it's already taking shape.",
  "welcome_board.body": "it's saved and waiting whenever you want to keep going — drop in more photos, notes, or files and they arrange themselves.",
  // A tip for people who signed up on a phone.
  "welcome_board.desk_tip": "one tip: open it on your computer when you can — the full studio, a bigger canvas, every tool.",
  "welcome_board.cta": "pick up where you left off",

  // ── board_waiting: a win-back note to someone whose cluster has been quiet for about two weeks ──
  // {name} is their cluster's name. {phrase} is what they added, like "38 photos, 4 notes and a PDF".
  "board_waiting.subject_named": "\"{name}\" is still taking shape",
  "board_waiting.subject_plain": "your board is still taking shape",
  "board_waiting.preheader": "it's saved and waiting whenever you want to pick it back up.",
  // Opener: with a picture of the cluster after it, and without.
  "board_waiting.opener_named_picture": "remember \"{name}\"? here's how you left it:",
  "board_waiting.opener_named_text": "remember \"{name}\"? it's still sitting in your workspace.",
  "board_waiting.opener_plain_picture": "remember this? here's how you left it:",
  "board_waiting.opener_plain_text": "your board's still sitting in your workspace.",
  // What they had added. The first is followed by a row of small pictures of the last few.
  "board_waiting.added_tiles": "you'd added {phrase}. the last few:",
  "board_waiting.added_phrase": "you'd added {phrase}.",
  "board_waiting.body": "it's all saved, exactly how you left it. if a few new things have piled up since, this is a good moment to drop them in.",
  "board_waiting.cta_named": "open \"{name}\"",
  "board_waiting.cta_plain": "open my board",

  // ── trial_ending: the Creator trial ends in about three days and the card on file will be charged ──
  // {at} is the moment the trial ends, with its time zone, or the words of trial_ending.fallback_at. {amount} is what will be charged, or the words of trial_ending.fallback_amount.
  "trial_ending.subject": "Your Creator trial ends in about three days",
  "trial_ending.preheader": "Nothing has been charged yet. Your trial ends {at}.",
  "trial_ending.eyebrow": "Creator trial",
  "trial_ending.headline": "Your Creator trial ends in about three days.",
  "trial_ending.subtitle": "It ends {at}. If you keep Creator, your card will be charged {amount} then. To stop it, cancel before then in Settings → Plan & billing — you won't be charged, and everything you've made stays exactly where it is.",
  "trial_ending.cta": "Manage billing",
  "trial_ending.caveat": "Questions? Reply to this email — a person reads it.",
  // When the date is missing: "It ends in about three days."
  "trial_ending.fallback_at": "in about three days",
  // When the price is missing: "will be charged the Creator price then", and the plan's own cadence.
  "trial_ending.fallback_amount": "the Creator price",
  "trial_ending.fallback_price_month": "the Creator monthly price",
  "trial_ending.fallback_price_year": "the Creator annual price",
  // {date} is a date and time in this language, in UTC.
  "trial_ending.charge_at": "{date} UTC",
  // {price} is the amount with its currency, like $12. The second is a yearly price.
  "trial_ending.price_month": "{price}/month",
  "trial_ending.price_year": "{price}/year",
  // ── checkout: not an email: the line Stripe shows beside its button on a Creator trial's checkout page (create-checkout-session) ──
  "checkout.trial_note": "We'll email you about three days before your trial ends. Cancel before then in Settings and you pay nothing.",

  // ── magic_link: the sign-in code email (Supabase fills in the code) ──
  // {code} is the 6-digit code. The page keeps the code's own look; only the words change.
  "magic_link.subject": "{code} is your Clusters sign-in code",
  "magic_link.title": "Your Clusters sign-in code",
  "magic_link.preheader": "Your Clusters sign-in code: {code}",
  "magic_link.eyebrow": "Sign-in code",
  "magic_link.headline": "Here's your code.",
  "magic_link.lead": "Enter this 6-digit code on the sign-in screen.",
  "magic_link.small": "It works for an hour. Asked for more than one? Only the newest works. Didn't request this? You can safely ignore this email.",
};
