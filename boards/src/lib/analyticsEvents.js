// analyticsEvents.js — canonical event names + the self-documenting catalog
// for the landing / waitlist / pricing funnel. Import EV.* instead of string
// literals so names never drift; this file is the single source of truth that
// the admin breakdown RPC's curated list mirrors. (Existing literals elsewhere
// are intentionally left as-is — these constants have the same string values.)

export const EV = Object.freeze({
  // ── Landing (sign-in) ──
  LANDING_VIEW:            'landing_view',                // SignIn screen mounted
  LANDING_FIELD_ENGAGE:    'landing_field_engage',        // first input into a field {field:'email'|'code'}
  LANDING_INVITE_PREFILL:  'landing_invite_prefill_seen', // invite email pre-filled
  LANDING_JOIN_PREFILL:    'landing_join_prefill_seen',   // ?join= landing named the cluster {had_name}
  EMAIL_SUBMIT:            'email_submit',                // OTP send ok {resend}
  EMAIL_SUBMIT_ERROR:      'email_submit_error',          // OTP send failed {reason,resend}
  OTP_VERIFY:              'otp_verify',                  // code verified ok {is_webview,webview_app}
  // ── Did verification actually reach the product? ──
  // About one in eight signups completes email verification and is then never
  // seen again: last_sign_in_at is set server-side, but there is no workspace,
  // no board, no event and no error. Nothing ran. Supabase's /auth/v1/verify
  // stamps last_sign_in_at BEFORE redirecting here, so the gap between "signed
  // in" and "our JS executed" was completely unmeasured — and that gap is where
  // they are being lost.
  //
  // AUTH_LANDED is the first line of JS to run on a callback URL; it may be
  // anonymous, because the code hasn't been exchanged yet. AUTH_SESSION_READY
  // fires once a session exists and therefore carries user_id, which is what
  // makes it joinable to auth.users. A user with last_sign_in_at and NO
  // auth_session_ready never completed the landing — that subtraction is the
  // whole measurement.
  AUTH_LANDED:             'auth_landed',                 // browser executed our JS on a callback URL {method:'code'|'hash',is_webview,webview_app,standalone} — beaconed immediately, so it survives a tab closed one second later
  AUTH_SESSION_READY:      'auth_session_ready',          // a session actually exists on this device {method,is_webview,webview_app,ms_since_landed}
  OTP_VERIFY_ERROR:        'otp_verify_error',            // code verify failed {reason}
  LANDING_EDIT_EMAIL:      'landing_edit_email',          // "edit" clicked on the code step
  LANDING_CALLBACK_ERROR:  'landing_callback_error',      // magic-link ?code= exchange failed {reason}
  LANDING_SCROLL:          'landing_scroll',              // reveal scroll depth crossed {depth}
  LANDING_EXPLORE_CLICK:   'landing_explore_click',       // "Explore a live board" clicked
  LANDING_FOOTER_CLICK:    'landing_footer_click',        // footer legal/email link {target}
  LANDING_DWELL:           'landing_dwell',               // time on landing {ms,max_depth}
  LANDING_BACKDROP_CLICK:  'landing_backdrop_click',      // clicked the decorative "living board" behind the sign-in box {tgt} — every layer of it is aria-hidden ornament, but visitors read it as a real app and click it (div.sb-cards was the top dead-click target on /). The click now focuses the email field instead of dying, and this measures how often that intent shows up

  // ── Welcome / Waitlist ──
  WELCOME_VIEW:            'welcome_view',                // welcome screen mounted
  WELCOME_CTA:             'welcome_cta',                 // {target:'waitlist'|'pricing'}
  WELCOME_SIGNOUT:         'welcome_signout',             // "use a different email"
  WELCOME_DWELL:           'welcome_dwell',               // {ms}
  SUBMIT_SOCIALS_OPEN:     'submit_socials_open',         // waitlist modal opened
  WAITLIST_FIELD_ENGAGE:   'waitlist_field_engage',       // first input into a link row
  // waitlist_rows_changed was REMOVED — declared, never emitted. The row count
  // it was meant to carry already rides on SUBMIT_SOCIALS_DONE {link_count}.
  SUBMIT_SOCIALS_DONE:     'submit_socials_done',         // submitted {link_count} (must-land)
  SUBMIT_SOCIALS_ERROR:    'submit_socials_error',        // submit failed {message}
  WAITLIST_ABANDON:        'waitlist_abandon',            // closed without submit {rows,had_input}
  WAITLIST_MODAL_DWELL:    'waitlist_modal_dwell',        // {ms}
  WAITLIST_STATUS_VIEW:    'waitlist_status_view',        // status page {status}
  WAITLIST_PLAN_TOGGLE:    'waitlist_plan_toggle',        // {plan}
  WAITLIST_SUBSCRIBE_CTA:  'waitlist_subscribe_cta',      // skip-the-wait subscribe {plan} (must-land)
  WAITLIST_SIGNOUT:        'waitlist_signout',
  WAITLIST_ACCEPTED_SEEN:  'waitlist_accepted_seen',      // tier flipped {tier} (must-land)
  WAITLIST_STATUS_DWELL:   'waitlist_status_dwell',       // {ms,status}
  GATE_DEAD_END:           'gate_dead_end',               // waitlist user dwelled on /welcome with no queue entry + no CTA — the silent leak {dwell_ms}

  // ── Pricing / Checkout ──
  PRICING_VIEW:            'pricing_view',                // {surface:'page'|'modal',header?}
  PRICING_PLAN_TOGGLE:     'pricing_plan_toggle',         // {plan,surface}
  PRICING_DEMO_CTA:        'pricing_demo_cta',            // {surface,tier}
  PRICING_CREATOR_INTENT:  'pricing_creator_intent',      // {plan,surface,already_paid} (must-land)
  PRICING_SIGNOUT:         'pricing_signout',
  PRICING_ABANDON:         'pricing_abandon',             // modal closed w/o checkout {header,plan,surface}
  PRICING_DWELL:           'pricing_dwell',               // {ms,surface}
  CHECKOUT_OPEN:           'checkout_open',               // {plan,surface} (must-land)
  CHECKOUT_ERROR:          'checkout_error',              // {plan,surface,message}
  BILLING_PORTAL_OPEN:     'billing_portal_open',         // {surface,via?} (must-land)
  BILLING_PORTAL_ERROR:    'billing_portal_error',        // {surface,message}
  CHECKOUT_SUCCESS:        'checkout_success',            // success page mounted {has_session_id}
  CHECKOUT_VERIFY_RESULT:  'checkout_verify_result',      // {result:'activated'|'pending'|'failed',reason?}
  CHECKOUT_STALLED:        'checkout_stalled',            // >30s without activation
  CHECKOUT_VERIFY_RETRY:   'checkout_verify_retry',       // "verify now" clicked
  CHECKOUT_MISSING_SESSION:'checkout_missing_session',    // no ?session_id
  CHECKOUT_SUPPORT_CLICK:  'checkout_support_click',      // {surface:'stalled'|'missing_session'}
  CHECKOUT_ACTIVATED_SEEN: 'checkout_activated_seen',     // tier→paid celebration {tier,plan} (must-land)
  CHECKOUT_SUCCESS_DWELL:  'checkout_success_dwell',      // {ms,outcome}
  SUBSCRIPTION_STARTED:    'subscription_started',        // SERVER (stripe-webhook, checkout.session.completed) {plan,amount_total_cents,currency,session_id} — ground-truth paid conversion, fires even if the buyer never returns to /pricing/success
  BILLING_FLAG:            'billing_flag',                // SERVER (stripe-webhook refund/dispute + billing-reconcile-cron) {kind,action,charge_id?,customer_id} — money went backwards or the mirror drifted; the operator-review pointer

  // ── Upsell behavioral telemetry (up_* family — lib/upsellMetrics.js +
  //    hooks/useUpsellExposure.js). WHY users who see the Creator pitch don't
  //    click. Every up_* row carries the exposure ENVELOPE {surface,header,via,
  //    copy_rev,exposure_n,tier,cap_pct,demo_cards,acct_days}; the pricing_*
  //    events above keep firing unchanged (0110 funnels read them) and only
  //    GAIN these props at their call sites. Read layer: admin_upsell_scorecard
  //    + admin_upsell_exposures (migration 0197). ──
  UP_EXPOSURE_SUMMARY:     'up_exposure_summary',         // ONE dense terminal row per exposure — the analyzable unit; 0197 counts THESE as exposures, not pricing_view {outcome:'cta'|'invite_alt'|'demo_cta'|'dismiss'|'hidden',dismiss_method:'x'|'backdrop'|'maybe_later'|'esc'|'nav'|null,plan_final,toggles_n,toggle_seq,dwell_ms,ttfi_ms,feat_rows,feat_ms,price_hes_ms,cta_hes_ms,rage_n,dead_n,error_seen} (beacon; once — first of hide/unmount/pagehide)
  UP_FEATURE_HOVER:        'up_feature_hover',            // pointer lingered ≥300ms on a Creator feature row — "they read this pitch line" {row,key,ms} (once per row per exposure; keys = billingCopy.CREATOR_FEATURE_KEYS)
  UP_CHIP_CLICK:           'up_chip_click',               // demo topbar "Get Creator" pill clicked {near,count,limit} (was DARK — only the downstream modal pricing_view fired)
  UP_SETTINGS_CLICK:       'up_settings_upgrade_click',   // Settings→Billing "Upgrade to Creator →" clicked (was DARK)
  UP_INVITE_ALT_CLICK:     'up_invite_alt_click',         // modal's "Or invite friends to earn more free cards →" alternative clicked {header,plan,dwell_ms} (was DARK; referral_open{surface:'cap_modal'} still fires downstream)
  UP_CAP_TOAST_VIEW:       'up_cap_toast_view',           // approaching-limit demo-cap warning toast shown {count,limit,at:'near'} (logEventOnce per pageload; was DARK). At the actual limit owners get the cap-hit modal instead (pricing_view header:'cap-hit'); the collaborator at-owner's-limit toast is deliberately untracked (upgrading THEIR account wouldn't lift it)
  UP_SUPPRESSED:           'up_suppressed',               // an upgrade surface was DELIBERATELY not shown to a demo user {surface:'chip'|'first_value'|'list_toolbar',reason,cap_pct,demo_cards,limit,acct_days,elig_rev} — reason:'no_cards'|'same_day'|'below_floor'|'low_intensity'|'cap_unknown'|'not_demo'. Without this row, "nobody converted" and "nobody was ever asked" are indistinguishable, and the pitch-targeting change is unmeasurable. logEventOnce per surface per pageload — NEVER per render
  UP_CAP_TOAST_CTA:        'up_cap_toast_cta',          // the approaching-limit toast's action was clicked {count,limit,at:'near'} (must-land). The toast's only button used to be "Invite friends" — the free path — so its action rate was structurally dark; this is the paired click for UP_CAP_TOAST_VIEW
  UP_TRACE:                'up_trace',                    // coalesced micro-interaction batch {from_t,to_t,n,ev:[{t,k,tgt,...}]} — k:'click'|'dead'|'rage'|'input'|'cta'|'invite_alt'|'demo_cta'|'dismiss'|'hide'|'show'; armed ONLY when surface!=='public_page' && !isJourneyOpen() so it never overlaps ps_trace/lp_trace; never captures input values

  // ── Ad offer (fbclid instant-demo) ──
  // ad_offer_view/enter/dwell/abandon retired with AdWelcome's deletion
  // (instant_entry shipped 100% arm B; no rows since 2026-06-26). Historical
  // rows remain queryable in analytics_events by their raw names.
  INSTANT_ENTRY_SKIP:      'instant_entry_skip',          // instant_entry arm B: the pre-app offer gate was SKIPPED — user dropped straight into the seeded board {arm} (offer deferred to first_value_upgrade_*)

  // ── Post-signup journey (the high-resolution, AI-analyzable first-session trace —
  //    see lib/journey.js + migration 0161 admin_journey_* RPCs). Every ps_* event
  //    carries the journey ENVELOPE in props: {jid,seq,t_ms,phase,from_phase,tier,
  //    onb_seeded,onb_done,ad_pending,boards,gcards,route} so a single ORDER BY
  //    (props->>'seq')::bigint reconstructs each new user's exact path + timings.
  //    Opened (once per new uid) the moment tier resolves; closed at activation.
  //    Dense by design — NOT human-curated; query it with SQL. ──
  PS_SIGNUP:               'ps_signup',                   // first authenticated entry for a genuinely-new user (journey anchor) {is_new,ms_since_otp,tier} — emitted once per uid by beginJourney
  PS_APP_ENTER:            'ps_app_enter',                // the App workspace actually mounted {tier}
  PS_TIER_STALL:           'ps_tier_stall',               // get_my_tier still loading past 4s — the dark <Splash> stall (plain event, session-stitched, may precede journey open) {waited_ms}
  PS_TIER_RESOLVED:        'ps_tier_resolved',            // tier gate resolved + routing decision made {tier,dur_ms,ad_pending} — dur_ms = how long the splash took
  PS_SEED_START:           'ps_seed_start',               // onboarding seed effect began composing cards {board_id,showcase}
  PS_SEED_SKIP:            'ps_seed_skip',                // seed effect bailed at a gate (was SILENT) {gate} — gate:'loading'|'already_seeded'|'doc_not_ready'|'not_personal_root'|'canvas_not_empty'
  PS_SEED_DONE:            'ps_seed_done',                // seed effect finished placing starter cards {n,board_id,tutorial_board_id,showcase}
  PS_HEARTBEAT:            'ps_heartbeat',                // ~12s liveness beat while the journey is open + tab visible (capped) {idle_ms,visible,beat} — the stall locator
  PS_PAUSE:                'ps_pause',                    // tab hidden mid-journey — the LAST event before a bounce pins the fall-off phase + stall {idle_ms,beat} (beacon)
  PS_TRACE:                'ps_trace',                    // COALESCED micro-interaction batch {from_t,to_t,n,ev:[{t,k,tgt,...}]} — k:'click'|'scroll'|'focus'|'input'|'key'|'route'|'hide'|'show'; never captures input values or typed characters
  PS_END:                  'ps_end',                      // journey closed {reason} — reason:'activated'|'session_end'|'signed_out' (beacon); no further ps_* for this uid
  ONBOARDING_SHOWCASE_ABANDON: 'onboarding_showcase_abandon', // hid the arm-B showcase without clearing it {board_id,ms} (beacon)

  // ── Onboarding (first-run) ──
  ONBOARDING_VIEW:         'onboarding_view',             // first-card coachmark shown {board_id}
  ONBOARDING_SEED:         'onboarding_seed',             // starter cards + tutorial board seeded into the root board {n,board_id,tutorial_board_id}
  ONBOARDING_FIRST_CARD:   'onboarding_first_card',       // user placed their OWN first card during onboarding (activation north-star). Once-guard is per-DEVICE localStorage, so it re-fires on a second device — funnel reads must COUNT DISTINCT user_id (profiles.first_card_at is the stamp of truth)
  ONBOARDING_NEST:         'onboarding_nest',             // first time the seed note is dragged into the tutorial board — the retention AHA {board_id,source_board_id,n}
  ONBOARDING_DISMISS:      'onboarding_dismiss',          // onboarding ended {reason:'placed'|'dismissed'|'nested'}
  ONBOARDING_STEP:         'onboarding_step',             // arm-B guided tour funnel {step,action:'view'|'advance'|'skip',via?}
  ONBOARDING_INTENT:       'onboarding_intent',           // project_first ask answered {intent:'moodboard'|'storyboard'|'references'|'exploring'}
  // welcome_showcase experiment (arm B): the curated brand demo is seeded onto
  // the root, shown as a "this is a demo" banner, then cleared in one click.
  ONBOARDING_SHOWCASE_VIEW:    'onboarding_showcase_view',    // the demo showcase banner was shown {board_id} (logEventOnce)
  ONBOARDING_SHOWCASE_CLEARED: 'onboarding_showcase_cleared', // user cleared the demo showcase to start their own {n,board_id}

  // ── First-value upgrade nudge (demo, once per account) ──
  FIRST_VALUE_UPGRADE_VIEW:   'first_value_upgrade_view',   // soft banner shown at first genuine card {board_id}
  FIRST_VALUE_UPGRADE_CTA:    'first_value_upgrade_cta',    // "See Creator" clicked → opens first-value modal (must-land) {board_id}
  FIRST_VALUE_UPGRADE_DISMISS:'first_value_upgrade_dismiss',// "Not now" clicked {board_id}

  // ── First-card friction (the MISSING half of the funnel: attempts + failures,
  //    not just successes) — see frictionSignal.js + the admin First-Card Friction
  //    view (admin_first_card_friction / admin_time_to_first_card RPCs). Emit the
  //    enum strings below EXACTLY (snake_case) so the GROUP BY never fragments —
  //    NOTE the UI's setUpgradeReason('cap-hit') hyphen is NOT a valid reason here.
  EMPTY_BOARD_SHOWN:       'empty_board_shown',             // the empty-board tile panel (.cnv-empty-tiles) became visible {board_id,tiles_n,is_prompt,escalated} — logEventOnce per board per page-load. THE denominator for card_create_intent: of the users who entered the app and never placed a card, all but a handful never fired a single intent, and without this row "never saw the panel" and "saw it and it didn't read as clickable" are the same measurement. It is the most-shown surface a new user meets and it was the only one emitting nothing.
  CARD_CREATE_INTENT:      'card_create_intent',            // user did something that signals "make a card" {method,board_id} — method:'dblclick'|'dblclick_menu'|'add_menu'|'context_menu'|'tool_place'|'drag_in'|'paste'|'empty_cta'|'mobile_nav'. (tile ids: image|note|file|doc|script|board) Fired BEFORE the mutator so a blocked create still has a preceding intent.
  CARD_CREATE_BLOCKED:     'card_create_blocked',           // an intent that produced no card {reason,method?,board_id} — reason:'demo_cap'|'demo_cap_cell'|'server_cap'|'demo_blocked'|'read_only'|'place_miss'|'stale_paste'|'noop_svg'|'mutator_null' ('server_cap' = the card_index trigger refused a write the client gate had allowed — a stale cached count; it was previously swallowed silently)
  CARD_CREATE_STUCK:       'card_create_stuck',             // new user appears stuck placing a first card {reason,intents,seconds,method_last} — reason:'timeout'|'rage' (logEventOnce per page-load)
  MOBILE_LIFT_HINT_SHOWN:  'mobile_lift_hint_shown',        // first time a touch user's drag-from-a-card panned instead of moving — one-time press-and-hold hint shown {board_id}
  MOBILE_LIFT_CANCELLED:   'mobile_lift_cancelled',         // a touch drag that STARTED on a card resolved to a pan, so the card didn't move {board_id,held_ms,travel_px,hint_seen}. Fires EVERY time, unlike the once-per-device hint above, because the question it answers is a distribution: held_ms and travel_px separate someone deliberately panning from someone trying to hold and losing it to finger drift. Those two look identical in the hint event, and which one dominates decides whether TOUCH_LIFT_TOLERANCE is set right

  // ── Camera-roll photo picker (the mobile activation path — measures adoption
  //    AND multi-select depth, the thing that turns one photo into a populated
  //    board in a single gesture) ──
  PHOTO_PICK_OPEN:         'photo_pick_open',               // the image/* multi-select chooser was opened {source:'plus_empty'|'add_sheet'|'tour'|'momentum',board_id}
  PHOTO_PICK_COMMIT:       'photo_pick_commit',             // files chosen from the chooser {n_selected,source,board_id} — n_selected is the multi-select depth
  MOMENTUM_NUDGE_SHOWN:    'momentum_nudge_shown',          // one-time "add a few more" beat after the first phone photo batch, short of a populated board {board_id,after} (also the desktop project_first completion port)
  DEPTH_DOCK_SHOWN:        'depth_dock_shown',              // the compact "add images" dock became visible on a board holding at least one card but fewer than the return threshold {board_id,cards} — logEventOnce per board per page-load. The empty-board panel is the ONLY surface carrying "pick several at once", and it unmounts the moment any card exists, so the message lands once and never again; this measures the surface that carries it the rest of the way
  DEPTH_DOCK_DISMISSED:    'depth_dock_dismissed',          // hand-dismissed via its X {board_id,cards} — a dock that is dismissed early and often is in the way, which is the signal to pull it rather than tune it
  CLUSTER_AUTO_OPEN:       'cluster_auto_open',             // a cluster placed as the board's FIRST genuine card auto-opened into its own empty canvas {board_id,new_board_id}. Placing an empty container is the single most common opening move and the one that most often ends two cards later; opening it lands the user on the image-first panel instead of a canvas holding one closed box
  CLUSTER_AUTO_OPEN_BACK:  'cluster_auto_open_back',        // the user took the toast's way out and returned to the parent {board_id} — auto-navigation is a liberty, so the escape hatch is measured. If this runs high the behaviour is wrong and should come out, not be tuned
  POWER_REVEAL_SHOWN:      'power_reveal_shown',            // JIT power hint surfaced when the user's content made a feature relevant {reveal,board_id,n_cards}
  POWER_REVEAL_ENGAGED:    'power_reveal_engaged',          // its action button was clicked {reveal}
  POWER_REVEAL_DISMISSED:  'power_reveal_dismissed',        // hand-dismissed via the toast X {reveal}; TTL expiry logs nothing, so expired = shown − engaged − dismissed

  // ── Onboarding failure paths (previously SILENT — a broken seed/persist left no signal) ──
  ONBOARDING_SEED_FAILED:            'onboarding_seed_failed',             // a seed step threw {stage,reason} — stage:'create_board'|'add_cards'|'persist'
  ONBOARDING_SETTINGS_PERSIST_FAILED:'onboarding_settings_persist_failed', // merge_profile_settings rejected {op,reason} — op:'seed'|'dismiss'
  ONBOARDING_FIRST_SOURCE_FAILED:    'onboarding_first_source_failed',     // set_first_source rejected {reason} (fired inside analytics.js where the RPC lives)

  // ── Experiments (A/B harness, see experiments.js + profiles.settings.experiments) ──
  EXPERIMENT_ENROLLED:     'experiment_enrolled',           // a genuinely-new user was assigned an arm at first seed {key,arm} (arms also ride every event as exp_<key>)

  // ── Product activity ──
  APP_OPEN:                'app_open',                    // app mounted with tier loaded {tier} — session/retention marker
  CARD_PLACED:             'card_placed',                 // GENUINE card(s) placed on a board {n,kind,cards_after,board_id,workspace_id,actor} — seeds excluded (see firstValueTrigger.areSeedCards); powers the admin Command Center live ticker. A placement beacon, NOT a depth metric: read depth as sum(n), and note the remix clone batch logs remix_clone instead of this (addCards suppressPlaced). `cards_after` is the board's genuine count AFTER the add, so "how many boards crossed the return threshold" is a query on this row instead of a workspace join
  IMPORT_BATCH:            'import_batch',                // ONE row per file-ingest invocation {n_files,n_accepted,n_blocked,source,kinds,board_id} — source:'drop'|'picker'|'photo_picker'|'list_drop'. The batch size is otherwise UNRECOVERABLE: the image path calls addCard once per file, so selecting ten photos logs ten card_placed{n:1} and is indistinguishable from ten separate placements except by clustering timestamps. Multi-select depth is the sharpest thing separating users who fill a board from users who place one card and stop, and photo_pick_commit only ever saw the camera-roll picker — never drag-drop, the any-file picker, or the list view
  ACTIVATED:               'activated',                   // first POPULATED board — a board crossed the genuine-card threshold {board_id,n} (the activation bar)
  CARD_MOMENTUM:           'card_momentum',               // a board crossed MOMENTUM_THRESHOLD genuine cards {board_id,n,threshold} — the SECOND, higher activation bar. Return-by-day-one-card-count is flat across the low bands and climbs steeply only well into double digits, so the band `activated` certifies returns no better than placing nothing at all. `activated` deliberately keeps its old meaning (dormancy gates and 90 days of history read it); this marks where the correlation actually is. Decide which one lifecycle email keys off once this has data.
  CARD_DELETED:            'card_deleted',                // card(s) removed {n,kinds:{kind:count},board_id} — creation was measured from six angles and removal from none, so NET content growth could not be computed and a board being emptied looked exactly like a board standing still. Deliberately NOT a work event: deleting is editing, but counting it as work would let a user who only ever removes things read as active
  ARROW_CREATED:           'arrow_created',             // an arrow was drawn {kind:'anchored'|'free',board_id} — anchored = between two cards/groups, free = dragged on empty canvas. The Arrow tool holds one of eight PRIMARY rail slots and emitted nothing whatsoever: arrows aren't cards, so card_placed never sees them, and no other event fired. It was the one tool in the app whose usage could not be counted at all

  // ── Collaboration actually happening ──
  // Invites were measured; collaboration was not. invite_sent, invite_link_*
  // and share_link_copied all describe the moment someone ASKS a colleague to
  // join, and then the record stops — presence, co-editing and comments emitted
  // nothing at all. That made the growth loop unfalsifiable: we could see
  // invitations go out and never tell whether anyone actually worked together,
  // which is the only part of it that predicts a return.
  COLLAB_SESSION:          'collab_session',              // this user shared a board with ≥1 live peer {board_id,peak_peers,ms} — emitted ONCE per board per app session, when the overlap ends, so a flaky socket can't inflate it
  COMMENT_CREATE:          'comment_create',              // a comment was posted {board_id,is_reply,anchor_kind,has_mention,len_bucket} — never the text
  COMMENT_RESOLVE:         'comment_resolve',             // a comment thread was resolved or reopened {board_id,resolved}

  // ── In-product engagement (breadth / depth / intent / loop / return — batched, high-signal) ──
  BOARD_OPEN:              'board_open',                  // opened/navigated to a board {board_id,depth,is_subboard}
  CARD_EDIT:               'card_edit',                   // edited a card's content (once per card per session) {kind,board_id}
  DOC_EDIT:                'doc_edit',                    // edited a doc surface (once per doc per session) {board_id}
  // Search, measured by SHAPE and never by content. q_len/terms/n_results say
  // whether search is working — a high zero-result rate, or results that are
  // never opened — without storing a single word anyone typed. The query text
  // would answer "what are people looking for that doesn't exist", which is the
  // better question, and is deliberately not collected: this repo has never put
  // typed content in the analytics table and one useful metric is not a reason
  // to start.
  SEARCH_RUN:              'search_run',                  // ran a search / command {has_results,q_len,terms,n_results,surface}
  SEARCH_RESULT_OPEN:      'search_result_open',          // a result was actually opened {rank,kind,n_results} — the missing half of search_run: a search that returns rows nobody opens has failed just as completely as one that returns none
  SHARE_OPEN:              'share_open',                  // opened the share surface {board_id}
  // A link was actually put on the clipboard. Previously DARK for every copy
  // made from inside the ShareModal (only the one-tap toolbar path emitted
  // anything, as share_open{quick:true}), so "opened the dialog" was the last
  // observable step and the copy itself was invisible. {kind:'view'|'invite',surface,board_id}
  SHARE_LINK_COPIED:       'share_link_copied',
  APP_TRACE:               'app_trace',                   // COALESCED micro-interaction batch for ESTABLISHED users {from_t,to_t,n,ev:[{t,k,tgt,...}]} — k:'dead'|'rage'|'key'|'route'. The third and last trace: lp_trace covers anonymous visitors on public pages, ps_trace covers a new user's FIRST session and closes at activation, and until this existed the largest population — signed-in people using the product they came back for — emitted nothing, so every friction finding we had was about someone's first hour. Deliberately quieter than ps_trace (an established session runs for hours, not minutes): plain clicks are DROPPED and only the evidence we have no other source for is kept. Never captures input values or typed characters — modifier commands only
  RETURN_SESSION:          'return_session',              // app_open on a later calendar day than last-seen {days_since_last_seen,tier}
  LIFECYCLE_LAND:          'lifecycle_land',              // arrived from a lifecycle email CTA, read off ?lc=<email_type>.<version> {email_type,content_version,signed_in} — the FIRST-PARTY click signal. Resend proxies every click through its own host and reports userAgent "Amazon CloudFront" on all of them, so its click webhook can't separate bot prefetch from a human and can't show whether anyone actually landed. This can. Fires once per page-load REGARDLESS of session — win-back recipients average 27 days since last sign-in, so nearly every one of them lands signed_in:false, and gating this on a user id (as it was until 2026-08-14) hid the entire wall-abandonment population. The param is stripped only once signed in, so it survives the OTP roundtrip
  LIFECYCLE_RESUME:        'lifecycle_resume',            // a lifecycle click that landed signed-OUT subsequently got a session {email_type,content_version} — i.e. they hit the sign-in wall and made it through anyway. lifecycle_land{signed_in:false} minus this is the wall's kill count, and the metric the /resume signed link is meant to move

  // ── View modes + list-mode "drive" usage (previously DARK: the Cluster Browser
  //    shipped with zero instrumentation, and upload-gate rejections left no
  //    signal beyond an eventual pricing_view{header:'storage'}) ──
  VIEW_MODE_SWITCH:        'view_mode_switch',            // canvas↔list toggle {view:'canvas'|'list',board_id,via:'topbar'|'toast'|'reveal'|'power_reveal'} — 'reveal' = the list-surface Reveal-on-canvas action; 'power_reveal' = the list_drive JIT hint; the tour's terminal advance rides onboarding_step instead
  LIST_BROWSER_VIEW:       'list_browser_view',           // ListSurface mounted (once per board per session) {board_id,files,subclusters}
  LIST_ADD_FILES:          'list_add_files',              // files handed to the list-mode ingest {board_id,n,via:'toolbar'|'drop'}
  LIST_UPSELL_CTA:         'list_upsell_cta',             // "Any file, any size — Creator" clicked in the list toolbar {board_id} (must-land)
  UPLOAD_BLOCKED:          'upload_blocked',              // an upload was refused {reason:'owner_not_paid'|'server_403'|'server_quota',surface:'canvas'|'list',ext,size_bucket,n} — owner_not_paid = client hard-block (free owner, non-standard file); server_* = party /mpu 403/402

  // ── Export + download (previously COMPLETELY DARK) ──
  // Everything the product can turn a board INTO — board PNG/PDF, screenplay
  // Fountain/Final Draft/PDF, doc HTML/Markdown/JSON, and the per-image
  // download — shipped with zero instrumentation. So "does anyone export?" and
  // "is anyone pulling full-res images off a public share link?" were both
  // unanswerable, which is exactly what you need to know before deciding
  // whether output is worth gating.
  EXPORT_RUN:              'export_run',                  // an export was produced {format:'png'|'pdf'|'fountain'|'fdx'|'html'|'markdown'|'json',surface:'canvas'|'doc',doc_mode,board_id}
  EXPORT_ERROR:            'export_error',                // the export threw {format,surface,reason}
  FILE_DOWNLOAD:           'file_download',               // a single asset was downloaded {kind:'image',adjusted,is_public} — is_public marks a download taken by an anonymous visitor on /share or /c, which is currently unrestricted

  // ── Public share viewer (/share/<token>, anonymous) ──
  SHARE_VIEW:              'share_view',                  // public viewer mounted {share_token,board_id,root_id,include_subboards,valid}
  SHARE_SUBBOARD_OPEN:     'share_subboard_open',         // navigated into a sub-board {share_token,board_id,from_board_id,depth,cached}
  SHARE_CTA_CLICK:         'share_cta_click',             // signup CTA clicked {surface:'topbar'|'prompt'|'invalid_page'|'badge'|'signin'|'remix',share_token} (must-land)
  SHARE_DWELL:             'share_dwell',                 // time on the public viewer {ms,share_token,board_id,boards_opened}
  SHARE_PROMPT_VIEW:       'share_prompt_view',           // engagement prompt shown {trigger:'dwell'|'subboard'}
  SHARE_PROMPT_DISMISS:    'share_prompt_dismiss',        // prompt dismissed {trigger,visible_ms}

  // ── Referral / "Invite friends, earn free cards" (migration 0163) ──
  // Client-fired; the three conversion events (signup/activated/reward_granted)
  // are fired SERVER-side from the signup + first-card triggers into analytics_events.
  REFERRAL_OPEN:           'referral_open',               // opened the invite surface {surface:'cap_toast'|'nudge'|'cap_modal'|'menu'|'reward_toast'|'paid_nudge'}
  REFERRAL_TAB_VIEW:       'referral_tab_view',           // Invite & earn account tab mounted {has_code}
  REFERRAL_LINK_COPIED:    'referral_link_copied',        // copied the ?ref= link {surface}
  REFERRAL_LINK_SHARED:    'referral_link_shared',        // shared the link {surface,channel:'native'|'whatsapp'|'x'|'email'|'sms'}
  // referral_nudge_view / _cta / _dismiss (the ≤2026-07-11 5-card banner,
  // superseded by invite_nudge_*) were REMOVED from the catalog: nothing has
  // emitted them since, and a constant that no code fires reads as a measured
  // thing when it is really an absence. The historical rows keep their names,
  // and the SQL that reads them (0163, 0190, 0231) uses string literals — it
  // never referenced these constants.
  REFERRAL_SIGNUP:         'referral_signup',             // SERVER: friend signed up via a referral {source,code}
  REFERRAL_ACTIVATED:      'referral_activated',          // SERVER: referee created first genuine card
  REFERRAL_REWARD_GRANTED: 'referral_reward_granted',     // SERVER: referrer credited {referee,amount}

  // ── Collaborator invites (the "build together" growth loop) ──
  // The banner fires at the activation beat (3 genuine cards) and routes into
  // the ShareModal's Invite People section. INVITE_SENT is the k-factor
  // numerator the referral ledger can't see — it only records signups.
  INVITE_NUDGE_VIEW:       'invite_nudge_view',           // "build this together" banner shown {surface}
  INVITE_NUDGE_CTA:        'invite_nudge_cta',            // banner CTA clicked → Share panel (must-land)
  INVITE_NUDGE_DISMISS:    'invite_nudge_dismiss',        // banner dismissed {surface}
  INVITE_SENT:             'invite_sent',                 // collaborator invite(s) submitted {role,result:'granted'|'pending',n,surface} (must-land)

  // ── Invite links ("anyone with this link joins as editor/viewer", 0189) ──
  INVITE_LINK_CREATED:     'invite_link_created',         // link minted/reused in ShareModal {role,expiry,board_id,surface} (must-land)
  INVITE_LINK_VIEW:        'invite_link_view',            // join confirm card rendered on /share {share_token,role} (once per token/session)
  INVITE_LINK_JOIN_CLICK:  'invite_link_join_click',      // "Join as …" clicked {share_token,role} (must-land)
  INVITE_LINK_CLAIMED:     'invite_link_claimed',         // SERVER: claim_collab_link granted access {board_id,role,status}
  INVITE_LINK_CLAIM_FAILED:'invite_link_claim_failed',    // claim_collab_link raised after signup/click {reason}
  // Client-side outcome for EVERY claim, not just the granting one. The server
  // event above only fires on the fresh-join branch — 'upgraded' | 'already' |
  // 'noop' all return early and left the funnel dark (join clicks with neither
  // a success nor a failure recorded). {status} (must-land)
  INVITE_LINK_CLAIM_RESULT:'invite_link_claim_result',

  // ── Remix ("Make a copy" — clone a public board into your workspace, 0168) ──
  REMIX_CLONE:             'remix_clone',                 // a shared/public board was cloned into the user's workspace {kind:'token'|'slug',n}
  REMIX_FAILED:            'remix_failed',                // remix consume failed {kind,stage,reason}

  // ── Public marketing boards (/c/<slug> + /explore, migration 0136) ──
  EXPLORE_VIEW:            'explore_view',                // /explore index mounted {count}
  EXPLORE_SEARCH:          'explore_search',              // /explore search used (once/session) {q}
  EXPLORE_CARD_CLICK:      'explore_card_click',          // /explore card → /c/<slug> {slug,pos,sort,topic,has_query}

  // ── Public landing pages (uniform lp_* engagement family — lib/landingMetrics.js
  //    + hooks/useLandingEngagement.js). EVERY public page (the 9 SEO pages, /,
  //    /pricing, /explore, /c/<slug>, /share aggregate) fires the same schema so
  //    the admin_landing_scorecard RPC GROUP BYs one event set. Every lp_* row
  //    carries the base {page,page_kind} — page = canonical spec path ('/tools/…',
  //    '/', '/pricing', '/explore', '/c/<slug>', '/share' — NEVER a share token);
  //    page_kind = tool|compare|hub|home|pricing|explore|public_board|share.
  //    Page-specific legacy events (landing_*, pricing_*, share_*, explore_*,
  //    seo_landing_view) keep firing unchanged — funnels in 0110/0180 read them. ──
  SEO_LANDING_VIEW:        'seo_landing_view',            // SEO landing mounted {path,kind} (pre-dated the lp_* family; kept for the 0180 RPCs)
  LP_VIEW:                 'lp_view',                     // page mounted (once per pageload)
  LP_SCROLL:               'lp_scroll',                   // scroll depth crossed {depth} — thresholds .1/.25/.5/.75/.9/1, each once
  LP_DWELL:                'lp_dwell',                    // time on page {ms,max_depth} (once; first of hide/pagehide/unmount)
  LP_CTA_CLICK:            'lp_cta_click',                // CTA clicked {pos,href,intent:'signup'|'nav'} (must-land beacon; CTR counts intent='signup' only)
  LP_SECTION:              'lp_section',                  // section first ≥50% visible {section,idx,t_ms}
  LP_FAQ:                  'lp_faq',                      // FAQ <details> opened {idx,q}
  LP_EXAMPLE_CLICK:        'lp_example_click',            // example-board link → /c/<slug> {slug,pos} (must-land beacon)
  LP_TRACE:                'lp_trace',                    // ANON-ONLY coalesced micro-interaction batch {from_t,to_t,n,ev:[{t,k,tgt,...}]} — k:'click'|'dead'|'rage'|'cta'|'scroll'|'input'|'hes'|'hide'|'show'; never captures input values or typed characters

  // ── Soleil Scout signup box (/scout). The phone number itself NEVER appears
  //    in props — the server-side row in scout_signups is the only place it
  //    lives, and that table denies anon/authenticated outright. ──
  SCOUT_SIGNUP_SUBMIT:     'scout_signup_submit',         // box submitted {pos:'hero'|'closing'}
  SCOUT_SIGNUP_OK:         'scout_signup_ok',             // accepted {pos,status:'queued'|'texted',is_new}
  SCOUT_SIGNUP_ERROR:      'scout_signup_error',          // refused {pos,reason:'invalid'|'rate'|'server'|'network'}

  // ── Tags (the ambient hover-to-explore rework — see project_tags_rework).
  //    Zero tag events existed before; this is how we finally measure whether
  //    tagging pays off. ──
  TAG_COLLECTION_OPEN:     'tag_collection_open',         // opened a tag's cross-board collection {tag_id,via:'card_chip'|'board_chip'|'hover'|'sidebar'|'doc'}
  TAG_HOVER_OPEN:          'tag_hover_open',              // a rich tag hover popover opened {tag_id,surface:'doc'|'entity_popover'}
  // tag_search, tag_dismiss and tag_auto_promote were REMOVED: the first two
  // were never wired and the third was a "(Phase 4)" placeholder for work that
  // was never built. Search is measured by SEARCH_RUN; add these back if and
  // when something actually emits them.
  TAG_MANUAL_APPLY:        'tag_manual_apply',            // user hand-applied a tag {target_kind,via}
  TAG_CONFIRM:             'tag_confirm',                 // confirmed a borderline/auto suggestion {tag_id,target_kind}
  TAG_MERGE:               'tag_merge',                   // merged one tag into another {from_tag_id,into_tag_id}
  TAG_CANDIDATE_PROMOTE:   'tag_candidate_promote',       // promoted a discovered prose name to a real tag {entity_type,count,anchored}
  TAG_CANDIDATE_DISMISS:   'tag_candidate_dismiss',       // dismissed a discovered prose name (workspace ignore) {count}
  TAG_SET_TYPE:            'tag_set_type',                // one-tap set/changed an entity's type {tag_id,entity_type}
});

// ── What counts as WORK, as opposed to presence ───────────────────────────
// user_active_day is the atom under every retention curve, cohort and D1/D7/D30
// tile, and it was written purely from the presence heartbeat: a day spent
// opening a tab and doing nothing counted exactly like a day of real work.
// Measured over 90 days, 54% of its rows contained no work at all.
//
// Migration 0248 adds did_work, written by two independent paths. A trigger on
// card_index is the server-truth half and covers anything that touches a card.
// This set is the client half, and its job is the work that never does:
// document edits, comments, tags, arrows.
//
// The bar is deliberately "the user changed the contents of a cluster". Opening
// a board, running a search, or sharing a link are all meaningful — but they
// are things you do to look at work, not to make it, and a definition that
// admits them drifts straight back into measuring presence.
export const WORK_EVENTS = Object.freeze(new Set([
  EV.CARD_PLACED,
  EV.CARD_EDIT,
  EV.DOC_EDIT,
  EV.ARROW_CREATED,
  EV.REMIX_CLONE,
  EV.TAG_MANUAL_APPLY,
  EV.TAG_CONFIRM,
  EV.TAG_MERGE,
  EV.TAG_CANDIDATE_PROMOTE,
  EV.TAG_SET_TYPE,
  // Writing a comment is contributing to the cluster, and on a shared board it
  // is often the ONLY thing a reviewer does — a day spent commenting is a day
  // of work, and counting it as presence would systematically under-report the
  // collaborators.
  EV.COMMENT_CREATE,
]));

// Canonical, ORDERED phases of the post-signup journey (lib/journey.js stamps the
// current one onto every ps_* event as props.phase). The order is the happy path;
// 'blocked'/'stuck' are off-path side-states (a user can be blocked then still
// reach first_card), so the drop-off RPC treats them as terminal-if-last, not as
// strict funnel steps. JOURNEY_PHASE_ORDER drives the admin drop-off ordinal.
export const JOURNEY_PHASE = Object.freeze({
  SIGNUP:       'signup',        // first authenticated entry (anchor)
  BOOT:         'boot',          // AppShell chunk + get_my_tier loading (the <Splash>)
  TIER_GATE:    'tier_gate',     // tier resolved, routing decision made
  WAITLIST:     'waitlist',      // routed to the waitlist /welcome branch
  AD_WELCOME:   'ad_welcome',    // the one-time AdWelcome price-first offer
  APP_ENTER:    'app_enter',     // the App workspace mounted
  SEED:         'seed',          // onboarding seed effect running
  COACHMARK:    'coachmark',     // first-card coachmark visible
  FIRST_INTENT: 'first_intent',  // first card-create gesture seen
  BLOCKED:      'blocked',       // a card-create attempt produced nothing
  STUCK:        'stuck',         // frictionSignal fired (rage/timeout)
  FIRST_CARD:   'first_card',    // first GENUINE card (activation north-star)
  NEST:         'nest',          // first nest-the-note AHA
  POPULATED:    'populated',     // a board crossed the 3-genuine-card bar
});

export const JOURNEY_PHASE_ORDER = Object.freeze([
  'signup', 'boot', 'tier_gate', 'waitlist', 'ad_welcome', 'app_enter',
  'seed', 'coachmark', 'first_intent', 'blocked', 'stuck',
  'first_card', 'nest', 'populated',
]);

// Map an auth/network error to a stable machine code for *_error events.
// Mirrors the substring logic of humanError() in AuthGate but returns a code,
// not user copy, so we can aggregate "why did email→OTP drop".
export function classifyAuthError(e) {
  const m = (e?.message || String(e || '')).toLowerCase();
  if (m.includes('rate') || m.includes('too many'))   return 'rate_limit';
  if (m.includes('expired'))                            return 'expired';
  if (m.includes('invalid') && m.includes('token'))    return 'invalid';
  if (m.includes('email') && m.includes('invalid'))    return 'invalid_email';
  if (m.includes('network') || m.includes('fetch') || m.includes('failed to fetch')) return 'network';
  return 'other';
}
