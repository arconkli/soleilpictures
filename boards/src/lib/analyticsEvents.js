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
  EMAIL_TYPO_SUGGESTED:    'email_typo_suggested',        // the sign-in form offered a corrected address {from_domain,to_domain,at:'blur'|'submit'} — logged once the person stopped typing, never per keystroke (rows before 2026-10-01 counted mid-word prefixes like 'gmail' and '.co') — typo and bare-TLD domains are a large share of accounts that never enter their code: submitting the address creates the account (autoconfirm), and the code goes nowhere
  EMAIL_TYPO_ACCEPTED:     'email_typo_accepted',         // the offer was taken {to_domain,stage:'email'|'code'}
  EMAIL_SUBMIT_ERROR:      'email_submit_error',          // OTP send failed {reason,resend} — reason 'no_tld' (from 2026-10-20) = refused before sending, the address has no real ending (lib/emailTypo emailProblem); every other reason is classifyAuthError's
  OTP_VERIFY:              'otp_verify',                  // code verified ok {is_webview,webview_app}
  // ── Did a callback actually reach the product? ──
  // Added to find signups that "verified and were never seen": last_sign_in_at
  // set server-side, but no workspace, board, event or error. That reading was
  // wrong (2026-10-20): under email autoconfirm, submitting an address creates
  // the account confirmed and signed in, so those accounts never typed their
  // code; the gap is the code step, not boot. The sign-in email carries no link
  // now, so these two only see the rare ?code= / #access_token landing.
  //
  // AUTH_LANDED is the first line of JS to run on a callback URL; it may be
  // anonymous, because the code hasn't been exchanged yet. AUTH_SESSION_READY
  // fires once a session exists and therefore carries user_id, which is what
  // makes it joinable to auth.users. An auth_landed with no auth_session_ready
  // after it never completed the landing — that subtraction is the whole
  // measurement. (last_sign_in_at alone proves nothing: autoconfirm sets it at
  // submit.)
  AUTH_LANDED:             'auth_landed',                 // browser executed our JS on a callback URL {method:'code'|'hash',is_webview,webview_app,standalone} — beaconed immediately, so it survives a tab closed one second later
  AUTH_SESSION_READY:      'auth_session_ready',          // a session actually exists on this device {method,is_webview,webview_app,ms_since_landed}
  OTP_VERIFY_ERROR:        'otp_verify_error',            // code verify failed {reason:'code_rejected'|'expired'|'invalid'|'invalid_email'|'rate_limit'|'network'|'other', sends} — sends (from 2026-10-20) = codes sent to the address in this step; only the newest works, so code_rejected with sends>1 is often the old code — GoTrue answers a wrong digit and a dead token with ONE message ("expired or is invalid"), which is code_rejected; the bursts of 3-4 in a minute after a single send are typos, not expiry
  LANDING_EDIT_EMAIL:      'landing_edit_email',          // "edit" clicked on the code step
  AUTH_CODE_RESTORED:      'auth_code_restored',          // the code step came back after a reload or reopen {age_s} — before 2026-10-05 a reload landed on an empty email field (lib/pendingCode.js)
  AUTH_MAILBOX_OPEN:       'auth_mailbox_open',           // the code step's "Open Gmail"-style shortcut was used {provider:'gmail'|'outlook'|'yahoo'|'yahoo_jp'|'icloud'|'proton'}
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
  STARTER_DOC_WRITTEN:     'starter_doc_written',         // {kind,board_id} — the first real change to a starter document (it stops being our seed: indexed, counted, activation stamped). STARTER_DOC_ADDED → this is the template's real use
  STARTER_DOC_ADDED:       'starter_doc_added',           // {kind,from,placed,board_id,age_s} — a page's promised starting document (e.g. the director's treatment) written after sign-in (useStarterIntentResume). placed:false = the board refused it (the cap)
  PRICING_INTENT_RESUMED:  'pricing_intent_resumed',      // {plan,from,age_s} — a signed-out "Get Creator" reopened the offer after sign-in (useCreatorIntentResume)
  PRICING_CREATOR_INTENT:  'pricing_creator_intent',      // {plan,surface,already_paid,trial} (must-land) — trial:true = the button read "Try Creator free for N days" (in-product offer to a real body of work; 0325)
  PRICING_SIGNOUT:         'pricing_signout',
  PRICING_ABANDON:         'pricing_abandon',             // modal closed w/o checkout {header,plan,surface}
  PRICING_DWELL:           'pricing_dwell',               // {ms,surface}
  PRICING_TEAM_START:      'pricing_team_start',          // {surface,plan,seats} (must-land) — the Team card's "Start a Team trial"; signed out, the seats and billing are kept through sign-in (lib/teamStart.js)
  PRICING_TEAM_TALK:       'pricing_team_talk',           // {surface} — the Team card's "Talk to us"
  CHECKOUT_OPEN:           'checkout_open',               // {plan,surface,header,via,trial} (must-land) — header/via added so the four surfaces the conversion deck keys on them (cap wall, file/size gate, upgrade pill, Settings) stop falling through to 'Other in-app'
  CHECKOUT_ERROR:          'checkout_error',              // {plan,surface,header,via,trial,kind:'auth'|'already'|'no_subscription'|'trial'|'preview'|'config'|'network'|'generic',reason,message} — `reason` is the SERVER's trial refusal (already_trialed|too_early|cards_unknown|not_demo|tier_unreadable): already_trialed is the anti-abuse sweep working, too_early means our cached count was stale and we offered something we shouldn't have. Opposite problems, previously identical rows — kind separates a misconfigured price/URL (ours, permanent) from an outage or a dead session; before it every unmapped failure read as "try again"
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
  UP_EXPOSURE_SUMMARY:     'up_exposure_summary',         // + {trial,trial_reason,server_cards,trial_flipped} — whether the CREATOR TRIAL was on the button when this exposure began. Without it a dismiss is byte-identical whether the CTA read 'Try Creator free' or 'Get Creator', and the trial has no exposure denominator. NOT reconstructible from demo_cards: the offer is decided on the SERVER count and demo_cards is the optimistic one (diverges for the whole span between fetches, runs backwards on delete) — hence server_cards. Latched at first resolved observation, because the envelope is refreshed every render and a focus refetch can flip the CTA mid-exposure; trial_flipped records that rather than overwriting the answer. ONE dense terminal row per exposure — the analyzable unit; 0197 counts THESE as exposures, not pricing_view {outcome:'cta'|'invite_alt'|'demo_cta'|'dismiss'|'hidden',dismiss_method:'x'|'backdrop'|'maybe_later'|'esc'|'nav'|null,plan_final,toggles_n,toggle_seq,dwell_ms,ttfi_ms,feat_rows,feat_ms,price_hes_ms,cta_hes_ms,rage_n,dead_n,error_seen} (beacon; once — first of hide/unmount/pagehide)
  UP_FEATURE_HOVER:        'up_feature_hover',            // pointer lingered ≥300ms on a Creator feature row — "they read this pitch line" {row,key,ms} (once per row per exposure; keys = billingCopy.CREATOR_FEATURE_KEYS)
  UP_CHIP_VIEW:            'up_chip_view',                // demo topbar pill RENDERED {near,count,limit,pressure,elig_reason,cap_pct,price_shown,trial_shown,trial_reason,server_cards} (logEventOnce per pageload, keyed on WHICH offer was shown). The chip had no impression row: "eligible and visible" could only be inferred from the ABSENCE of an up_suppressed row on that pageload, which is how a user parked at 92% of cap for eight days was misread as never having been asked
  UP_CHIP_CLICK:           'up_chip_click',               // demo topbar "Get Creator" pill clicked {near,count,limit,trial_shown,price_shown} (was DARK — only the downstream modal pricing_view fired)
  PRICE_SEEN:              'price_seen',                  // the FIRST time this account is shown a price on this device {surface:'chip'|'first_value'|'cap_toast'|'modal'|'page'} (once per account per device via lib/upsellLatches). Before this the only price impression was the modal's pricing_view, and more than half of the accounts that reached thirteen cards never reached the modal — "saw the price" and "saw an upgrade surface" were the same query  // NOTE since studio_v4: on a trial-eligible viewer the ambient surfaces show the TRIAL instead of a price, and deliberately do NOT stamp this. Offer reach is up_chip_view (price_shown|trial_shown); this row means a NUMBER was shown
  UP_SETTINGS_CLICK:       'up_settings_upgrade_click',   // Settings→Billing "Upgrade to Creator →" clicked (was DARK)
  UP_INVITE_ALT_CLICK:     'up_invite_alt_click',         // modal's "Invite friends for more free cards →" alternative clicked {header,plan,dwell_ms} (was DARK; referral_open{surface:'cap_modal'} still fires downstream)
  UP_CAP_TOAST_VIEW:       'up_cap_toast_view',           // approaching-limit demo-cap warning toast shown {count,limit,at:'near'|'arrival',trial_shown} (logEventOnce per pageload; was DARK). At the actual limit owners get the cap-hit modal instead (pricing_view header:'cap-hit'); the collaborator at-owner's-limit toast is deliberately untracked (upgrading THEIR account wouldn't lift it)
  UP_SUPPRESSED:           'up_suppressed',               // an upgrade surface was DELIBERATELY not shown to a demo user {surface:'chip'|'first_value'|'list_toolbar',reason,cap_pct,demo_cards,limit,acct_days,elig_rev} — reason:'no_cards'|'same_day'|'below_floor'|'low_intensity'|'cap_unknown'|'not_demo'|'cap_reached'|'slot_busy'. Without this row, "nobody converted" and "nobody was ever asked" are indistinguishable, and the pitch-targeting change is unmeasurable. logEventOnce per surface per pageload (first_value keys per REASON, so its three stand-downs are each legible once) — NEVER per render. 'cap_reached'/'slot_busy' are first_value-only and come from the surface, not evaluateUpsell: at the cap a user is maximally ELIGIBLE (the chip must stay loud), but the warm banner is the wrong sentence and the cap-hit modal owns that moment — see upsellSlot.js
  UP_CAP_TOAST_CTA:        'up_cap_toast_cta',          // the approaching-limit toast's action was clicked {count,limit,at:'near'|'arrival'|'new_project',trial_shown} (must-land). at:'new_project' = the once-per-account trial invitation shown when a project is started at or past 60% of the cap. The toast's only button used to be "Invite friends" — the free path — so its action rate was structurally dark; this is the paired click for UP_CAP_TOAST_VIEW
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
  ONBOARDING_DISMISS:      'onboarding_dismiss',          // onboarding ended {reason:'placed'|'dismissed'|'nested'|'returned_with_cards'} — the last is a later-day visit by someone who already has cards; the tour is not re-armed for them
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
  EMPTY_BOARD_SHOWN:       'empty_board_shown',             // the empty-board tile panel (.cnv-empty-tiles) became visible {board_id,tiles_n,variant:'first'|'full',kind,is_prompt,escalated,join} (join: someone else's workspace with nothing in it yet, whose panel names it and its owner — the setup's joiner landing) — logEventOnce per board per page-load. variant 'first' is the panel a person with no cards anywhere meets (hero + writing tiles, headline from their picked intent or landing page); tiles_n counts what was rendered. NOT logged while a tour variant hides the panel by CSS — until this gate existed the row fired for panels nobody could see. THE denominator for card_create_intent: of the users who entered the app and never placed a card, all but a handful never fired a single intent, and without this row "never saw the panel" and "saw it and it didn't read as clickable" are the same measurement. It is the most-shown surface a new user meets and it was the only one emitting nothing.
  CARD_CREATE_INTENT:      'card_create_intent',            // user did something that signals "make a card" {method,board_id} — method:'dblclick'|'dblclick_menu'|'add_menu'|'context_menu'|'tool_place'|'drag_in'|'paste'|'empty_cta'|'mobile_nav'. (tile ids: image|note|file|doc|script|board) Fired BEFORE the mutator so a blocked create still has a preceding intent.
  CARD_CREATE_BLOCKED:     'card_create_blocked',           // an intent that produced no card {reason,method?,board_id} — reason:'demo_cap'|'demo_cap_cell'|'server_cap'|'demo_blocked'|'read_only'|'place_miss'|'stale_paste'|'noop_svg'|'mutator_null' ('server_cap' = the card_index trigger refused a write the client gate had allowed — a stale cached count; it was previously swallowed silently)
  CARD_INDEX_HELD:         'card_index_held',               // the card_index cap trigger refused cards this tab did NOT just place, and they were KEPT on the canvas, uncounted, for the next sync to retry {board_id,n,kinds,own} — existing work: placed while paid and never synced before the tab closed, restored by undo or version history, moved in from another cluster, a collaborator's. Never a blocked create and never pitched. Until 2026-10-01 these were deleted with no undo (the withdraw now takes back only this tab's own gated placements — capRefusal.js), so a paid period ending could destroy work
  CARD_CREATE_STUCK:       'card_create_stuck',            // new user appears stuck placing a first card {reason,intents,seconds,method_last} — reason:'timeout'|'rage' (logEventOnce per page-load)
  WHEEL_HINT_SHOWN:        'wheel_hint_shown',              // one-time "scrolling pans" nudge, fired when a plain wheel reverses direction 3× inside 1.5s — the signature of someone expecting zoom {board_id}. The scroll-wheel preference is only worth having if people find it, so this and wheel_mode_set together answer whether it did: a hint that fires often and a setting nobody then changes means the nudge is wrong, not the feature
  WHEEL_MODE_SET:          'wheel_mode_set',                // someone changed Settings → Display → Scroll wheel {mode:'pan'|'zoom', source:'settings'|'palette'}
  WASD_PAN_SET:            'wasd_pan_set',                  // someone turned Settings → Appearance → Move with W A S D on or off {on}. Off by default; with it on, A and D stop picking the Arrow and Free-draw tools
  MOBILE_LIFT_HINT_SHOWN:  'mobile_lift_hint_shown',        // first time a touch user's drag-from-a-card panned instead of moving — one-time press-and-hold hint shown {board_id}
  TOUCH_SELECT:            'touch_select',                // a finger started picking several things {where:'canvas'|'files'|'sidebar', via:'hold' (canvas: hold, then drag a box)|'menu' (Select… in a hold's menu), n (picked at that moment; the canvas box's own catch, the menus' selection on entry, often 0 on the canvas)} — touchPassAllowed(), on everywhere since the sidebar release
  MOBILE_LIFT_CANCELLED:   'mobile_lift_cancelled',         // a touch drag that STARTED on a card resolved to a pan, so the card didn't move {board_id,held_ms,travel_px,hint_seen}. Fires EVERY time, unlike the once-per-device hint above, because the question it answers is a distribution: held_ms and travel_px separate someone deliberately panning from someone trying to hold and losing it to finger drift. Those two look identical in the hint event, and which one dominates decides whether TOUCH_LIFT_TOLERANCE is set right

  // ── Camera-roll photo picker (the mobile activation path — measures adoption
  //    AND multi-select depth, the thing that turns one photo into a populated
  //    board in a single gesture) ──
  PHOTO_PICK_OPEN:         'photo_pick_open',               // the image/* multi-select chooser was opened {source:'plus_empty'|'add_sheet'|'tour'|'momentum',board_id}
  PHOTO_PICK_COMMIT:       'photo_pick_commit',             // files chosen from the chooser {n_selected,source,board_id} — n_selected is the multi-select depth
  PHOTO_PICK_CANCEL:       'photo_pick_cancel',             // the chooser was dismissed with nothing chosen {source,board_id} — the file input's own cancel event. Until this existed, "opened the picker and no image landed" could not be split into a cancelled dialog and a failed ingest, and the two call for opposite fixes
  MOMENTUM_NUDGE_SHOWN:    'momentum_nudge_shown',          // one-time "add a few more" beat after the first phone photo batch, short of a populated board {board_id,after} (also the desktop project_first completion port)
  DEPTH_DOCK_SHOWN:        'depth_dock_shown',              // the compact "add images" dock became visible on a board holding at least one card but fewer than the return threshold {board_id,cards} — logEventOnce per board per page-load. The empty-board panel is the ONLY surface carrying "pick several at once", and it unmounts the moment any card exists, so the message lands once and never again; this measures the surface that carries it the rest of the way
  DEPTH_DOCK_DISMISSED:    'depth_dock_dismissed',          // hand-dismissed via its X {board_id,cards} — a dock that is dismissed early and often is in the way, which is the signal to pull it rather than tune it
  MIX_PROMPT_SHOWN:        'mix_prompt_shown',              // the dock asked an all-pictures board for words {board_id,images,text} — logEventOnce per board per page-load. THE denominator for the one behaviour that predicts return: a day-one board of images only comes back at the same rate as an account that placed NOTHING (25%), while images plus any writing comes back at 55%. Every other activation surface counts cards, and card count has been climbing for a month without return moving; this measures the surface aimed at the variable that actually separates them
  RESUME_GREET_SHOWN:      'resume_greet_shown',          // day one, back after a real break: the quiet "your board is where you left it" toast {via:'tab'|'reopen'|'idle',gap_min,cards (their own),at_cap} (lib/resumeSitting.js) — passive in _admin_visits and the sittings read (0363): it is shown, not done
  RESUME_GREET_ACTION:     'resume_greet_action',         // its "Show my last card" was used {action:'jump'}
  MIX_PROMPT_ENGAGED:      'mix_prompt_engaged',            // they took the ask and a note was opened {board_id,images} — the ask working, NOT the outcome. Return is the outcome, and it is 6-8 weeks behind this row at current signup volume; do not read a healthy engagement rate as the change having landed
  MIX_PROMPT_DISMISSED:    'mix_prompt_dismissed',          // hand-dismissed via its X {board_id,images} — same contract as depth_dock_dismissed: dismissed early and often means it is in the way and should come out rather than be tuned
  HOME_VIEW:               'home_view',                     // Home opened {exploring,projects_n,home:'clusters'|'projects',graph} — Home is the projects panel over the universe graph (2026-10-01). Once per open, not per render. home (2026-10-20) says which Home rendered: 'clusters' is the files sidebar's (ClustersHome, held to sidebarFilesAllowed), 'projects' the projects panel; rows before it are 'projects' on production. graph is false on the mobile shell (phones, and touch tablets in portrait), where neither Home draws one
  HOME_CLUSTER_ACTION:     'home_cluster_action',           // a picked cluster's card on the files sidebar's Home was used for something other than opening {action:'rename'|'cover'|'move'|'move_cancelled'|'star'|'unstar'|'delete'} — opening is HOME_OPEN_BOARD
  HOME_OPEN_BOARD:         'home_open_board',               // a board opened FROM Home {via:'jump'|'tile'|'studio' — the old Home; 'star'|'card'|'row' — the files sidebar's Home, preview only, board_id} — the leading indicator that Home is where people go to get back to work or start the next project
  HOME_WORKSPACE_SWITCH:   'home_workspace_switch',         // another workspace picked from the switcher at the top of Home {n_workspaces} — it opens on Home, showing that workspace's projects (lib/homeAfterSwitch)
  HOME_WORKSPACE_NEW:      'home_workspace_new',            // New workspace pressed at the top of Home {n_workspaces} — the name prompt opened; a created one opens on Home
  HOME_EXPLORE:            'home_explore',                  // the panel was put away to explore the universe, or brought back {open:true|false}
  CLUSTER_CREATE:          'cluster_create',                // a cluster was created {via,parent_depth,opened,board_id} — WHICH door. card_placed{kind:'board'} already says that one was made, but the sidebar +, cmd-K, the canvas tool, the add menu and 'New cluster inside' all looked identical, so nobody could say how people start their next project. via: sidebar | palette | home | tool_place | context_menu | dblclick | empty_cta | power_reveal (the retired group reveal, until 2026-10-21) | sidebar_inside | paste_copy | copy_to_personal | folder_import | files_empty | from_selection | from_list_selection | move_to_new | from_group | studio_sweep | second_idea | topbar | add_sheet (the phone + sheet's New cluster row) | empty_studio. parent_depth: 0 = created on the root
  CLUSTER_RENAME:          'cluster_rename',                // a cluster's name actually changed {board_id,via,from_default,len} — never the name itself. via: sidebar | card | project_field | list | unknown. from_default: the old name was the default ('Untitled cluster'), which is how a cluster that was MADE becomes one that is USED — a third of new ones never get here. Before this, a rename left no row at all (renameBoardById logged nothing)
  CLUSTER_CREATE_FAIL:     'cluster_create_fail',           // a cluster couldn't be made {via (CLUSTER_CREATE's doors, plus 'seed'), stage:'create' (the insert failed) | 'after_create' (it exists, but what follows threw: unannounced, no card yet), code (the error's SQLSTATE / PostgREST code / status — 23503 is a parent that was deleted, 0396's trigger; never the message)}. Only the sidebar's +, ⌘K, Home, the canvas's own doors and 'New cluster inside'; a cap refusal is CARD_CREATE_BLOCKED, and a move into a cluster made for it fails as CARDS_MOVE_FAIL
  CARDS_MOVE_FAIL:         'cards_move_fail',               // a move of cards into another cluster failed, and the source kept them {via (CARDS_MOVE's), n, stage:'load' (the destination's state didn't load)|'verify' (it looked unsafe to overwrite)|'save'|'room_reset' (saved, but its live room couldn't be reset)|'after_ack' (failed after the source was told it could let go)|'other', made (the destination was made for these cards), trashed (and went to the trash for it, lib/moveFailure.js), code, board_id, target_board_id}
  CLUSTER_NUDGE:           'cluster_nudge',                 // an offer to make a cluster was opened, taken or turned down {surface,action,picked}. surface: topbar (the '+ New cluster' popover after the breadcrumb) | empty_studio | studio_bar | second_idea. action: view (the offer was shown; for topbar, whose button is always there, its popover opened) | accept (a cluster was asked for; cluster_create{via} says it was made) | dismiss. second_idea is a toast whose button opens the popover: one that times out logs nothing after its view, so ignored = view − accept − dismiss. picked: the cards that were to move into it, 0 = an empty cluster. Clusters are how a workspace stays organised and most people never make a second one, so each door is graded on its own
  CLUSTER_TOOL_HINT:       'cluster_tool_hint',             // the Cluster tool's hover card, which says what a cluster IS {action:'seen'|'picked', after_card}. seen: a hover (or keyboard focus) lasted long enough for the card to show — once per page load, enough to join a sighting to the cluster_create{via:'tool_place'} that follows it. picked: the rail's Cluster tool was pressed while not already on; after_card says the card was showing at that moment. Only where the card teaches (cluster nudges on, a pointer that hovers), so seen without picked is a card read and passed over
  CARDS_MOVE:              'cards_move',                    // cards were moved into another cluster and the destination saved {via,n,board_id,target_board_id}. via: drag (dropped on a cluster card) | menu ('Move to cluster…', for a cluster not on this canvas). Logged when the destination has saved the cards; the source deletes after. Filing a first project's references into their own cluster is how a second project gets its material; without this, a project that filled up by move looked like one nobody worked in
  CLUSTER_AUTO_OPEN:       'cluster_auto_open',             // a cluster placed as the board's FIRST genuine card auto-opened into its own empty canvas {board_id,new_board_id}. Placing an empty container is the single most common opening move and the one that most often ends two cards later; opening it lands the user on the image-first panel instead of a canvas holding one closed box
  CLUSTER_AUTO_OPEN_BACK:  'cluster_auto_open_back',        // the user took the toast's way out and returned to the parent {board_id} — auto-navigation is a liberty, so the escape hatch is measured. If this runs high the behaviour is wrong and should come out, not be tuned
  POWER_REVEAL_SHOWN:      'power_reveal_shown',            // JIT power hint surfaced when the user's content made a feature relevant {reveal,board_id,n_cards}
  POWER_REVEAL_ENGAGED:    'power_reveal_engaged',          // its action button was clicked {reveal}
  POWER_REVEAL_DISMISSED:  'power_reveal_dismissed',        // hand-dismissed via the toast X {reveal}; TTL expiry logs nothing, so expired = shown − engaged − dismissed
  // Product education, pull side (2026-10-06, components/HelpHub.jsx). The pass
  // that added these found every surface that TELLS people about power to be
  // null for return — tour completion, the intent pick, the reveals above, the
  // docs site hardly anyone reached from inside the app — so the hub opens only
  // when asked, sits outside the ambient ask budget, and is graded on its own
  // reach (admin_feature_reach, 0365), never on return.
  HELP_OPEN:               'help_open',                     // the Help hub opened {via:'topbar'|'sidebar'|'palette'|'palette_add'|'other'}
  HELP_ITEM:               'help_item',                     // a door in it was taken {item:'learn'|'shortcuts'|'guides'|'guide'|'changelog'|'feedback'|'docs',kind?,section?}
  DOCS_OPEN:               'docs_open',                     // a signed-in person opened a docs page from inside the app {from:'help'|'settings'|'palette'|'shortcuts',path} — the first count of docs demand that is not a crawler
  // Product education, failure side (lib/hints.js). A hint fires only when a
  // specific how-to failure just happened, once per kind per device, never
  // during the tour, never two at once, and is graded on its own conversion.
  HINT_SHOWN:              'hint_shown',                    // {kind:'paste'|'name_cluster',trigger:'picker_cancel'|'timer',board_id,source?} — paste: the picker was cancelled on an empty board and the hero now names the other ways in; name_cluster: a cluster placed here still carried its default name a minute later
  HINT_ACTED:              'hint_acted',                    // the thing the hint asked for happened while it was up {kind,ms,board_id} — a card landed (paste) or the cluster got a real name (name_cluster). A kind shown often and never acted on is in the way
  SEARCH_EMPTY_HELP:       'search_empty_help',             // the palette explained what search can see because a query found nothing {q_len,has_images,has_text,action?} — one row when it shows, another with action:'list' if Browse in List view was taken

  // ── Onboarding failure paths (previously SILENT — a broken seed/persist left no signal) ──
  ONBOARDING_SEED_FAILED:            'onboarding_seed_failed',             // a seed step threw {stage,reason} — stage:'create_board'|'add_cards'|'persist'
  ONBOARDING_SETTINGS_PERSIST_FAILED:'onboarding_settings_persist_failed', // merge_profile_settings rejected {op,reason} — op:'seed'|'dismiss'
  ONBOARDING_FIRST_SOURCE_FAILED:    'onboarding_first_source_failed',     // set_first_source rejected {reason} (fired inside analytics.js where the RPC lives)

  // ── Experiments (A/B harness, see experiments.js + profiles.settings.experiments) ──
  EXPERIMENT_ENROLLED:     'experiment_enrolled',           // a genuinely-new user was assigned an arm at first seed {key,arm} (arms also ride every event as exp_<key>)

  // ── Product activity ──
  APP_OPEN:                'app_open',                    // app mounted with tier loaded {tier,board_id,restored,source:'session'|'root',visibility,focused,nav_type,display_mode,landed_cards,boot_ms} — boot_ms (2026-10-20): ms from the navigation to this mount, on a page load's first mount only (null on a workspace switch, and from 2026-10-21 when the app opened in place after a checkout, where the t_* fields are absent too); read it with visibility and nav_type, since a hidden or restored tab is slow because nobody was looking. visibility/focused/nav_type (2026-10-01) say whether anybody was there: a browser-restored or background tab loads the app with nobody looking, and those loads are most late visits. landed_cards is null until the board list has loaded — board_id is the board the person LANDED on; restored=true when the persisted stack put them back on a sub-cluster rather than the root. The only row that says whether a returning person arrived where they left off. t_session/t_shell/t_tier/t_ws (2026-10-20, with boot_ms): ms from the navigation to each boot step (lib/bootMarks.js): a session in hand, the AppShell chunk run (from 2026-10-22 a sign-in's code step runs it, so on a load that signed in t_shell comes before t_session), get_my_tier answered, the workspace and its root known; shell_cached = the AppShell chunk came from the HTTP cache (false on the first open after a deploy); refreshed = the restore had to refresh an expired token first, which every first open of a day does
  BOARD_READY:             'board_ready',                 // once per page load: the board the load landed on painted (not sent when the app opened in place after a checkout, 2026-10-21) {ms,source,cards,first_image_ms,image_tier,image_meta,refreshed,shell_cached} (2026-10-20). ms = from the navigation to that paint; source = what painted it: 'draft' (this device's unsaved edits), 'cache' (the last snapshot this device saw, instant) or 'server' (waited on board_state); first_image_ms = the first picture on the canvas loaded, null when the board has none or none arrived within 15 s of the paint; image_tier 'sm'|'lg'|'original' with image_meta = whether its preview was known (an original with image_meta false is the multi-MB download a known preview would have spared). Read with app_open's t_* fields for where the time before the paint went
  CARD_PLACED:             'card_placed',                 // GENUINE card(s) placed on a board {n,kind,cards_after,board_id,workspace_id,actor} — seeds excluded (see firstValueTrigger.areSeedCards); powers the admin Command Center live ticker. A placement beacon, NOT a depth metric: read depth as sum(n), and note the remix clone batch logs remix_clone instead of this (addCards suppressPlaced). `cards_after` is the board's genuine count AFTER the add, so "how many boards crossed the return threshold" is a query on this row instead of a workspace join
  IMPORT_BATCH:            'import_batch',                // ONE row per file-ingest invocation {n_files,n_accepted,n_over,n_blocked,source,kinds,board_id} — source:'drop'|'picker'|'photo_picker'|'list_drop'|'email' (an email's attachments put on the board from Quick look, 2026-10-27). The batch size is otherwise UNRECOVERABLE: the image path calls addCard once per file, so selecting ten photos logs ten card_placed{n:1} and is indistinguishable from ten separate placements except by clustering timestamps. Multi-select depth is the sharpest thing separating users who fill a board from users who place one card and stop, and photo_pick_commit only ever saw the camera-roll picker — never drag-drop, the any-file picker, or the list view. `n_accepted` counts what passed CLASSIFICATION, not what survived — it reported a full folder for a user who ended up holding a fraction of it, which is exactly why the cap was eating whole folders unnoticed. `n_over` is the cap's share of that gap; the rest is upload failure
  IMPORT_PREFLIGHT:        'import_preflight',            // an over-cap folder drop was caught BEFORE it uploaded {action:'view'|'partial'|'upgrade'|'add_storage'|'cancel'|'blocked',n_files,take,over,count,limit,source,board_id}. add_storage is a paying owner's Add 1TB from the dialog (0415); source 'held' is a drop kept for room and released (lib/heldUploads). The canvas drop path had no cap check at all (the list path always sliced), so a folder bigger than the remaining room rendered, uploaded, and was then withdrawn by the server trigger, leaving its user holding a fraction of the drop — a count BELOW their own cap, because the batch had not merely overflowed, it had failed whole. 'view' is the ask; 'partial'/'upgrade'/'cancel' are what they chose. Without the 'view' row a dialog nobody accepts and a dialog nobody sees are the same empty query
  FOLDER_IMPORT:           'folder_import',               // a dropped/picked FOLDER became clusters {source,board_id,n_files,n_clusters,depth,placed,failed,write_failed,cancelled,stopped,truncated,flattened,skipped_packages,skipped_icloud,ms} — IMPORT_BATCH source:'folder' is the gesture; this is the outcome. A bulk import's (bulk:true) also carries run and job_id (as IMPORT_JOB) and, when any file failed, fail_codes:{code:n} (2026-10-20, lib/importJob.js importFailCode: 'retry_exhausted'|'cap'|'http_<status>'|'file_gone'|'unreadable'|'not_allowed'|'browser_quota'|a server code|'other' — never a file's name)
  FOLDER_IMPORT_UNDO:      'folder_import_undo',          // the import's Undo was pressed {board_id,n_clusters}
  IMPORT_JOB:              'import_job',                  // a bulk import's life (lib/importStart.js) {phase:'zip_question'|'start'|'restart'|'waiting'|'resume'|'tray'|'stopped'|'removed'|'landing'|'guide_open'|'guide_app'|'guide_link', run (2026-10-20: the import's tray key, on every row of one import and its IMPORT_PREFLIGHT and FOLDER_IMPORT rows, so one import's life reads as one; none on zip_question, which comes before it, or on stopped imports a reload offers, which carry job_id instead), job_id (the server job, import_jobs.id, once it has one: null on start, which is logged just before the server makes it; a restart's is the job it goes on with), tray: a press in the tray {action:'pause'|'resume'|'cancel'|'retry'|'upgrade'|'addon'|'open'|'close'|'remove', status: where the import stood},source:'bulk_drop'|'bulk_list'|'bulk_picker'|'bulk_zip'|'bulk_guide'|'bulk_resume'|'bulk_quicklook',board_id,n_files,n_clusters,choice?,n_zips?,fit?,waiting?,reason?,landed?,how?,status?,can_resume?,stopped?,n?,app?} — bulk_drop is the board, bulk_list the List view (Files), bulk_quicklook a zip's Unpack into clusters in Quick look (components/clusterBrowser/ZipStage.jsx, 2026-10-27: picked to unpack, so no zip_question), bulk_guide the tray's guide to bringing files from another app (components/ImportTray.jsx: guide_open is it opening, on the app last chosen; guide_app an app chosen; guide_link its "Open Google Takeout"-style link followed — each with app 'drive'|'photos'|'dropbox'|'onedrive'|'icloud'|'other'; a drop or pick there starts an import with this source, and a zip dropped anywhere while it is open unpacks without a zip_question); zip_question's choice is 'unpack'|'keep'|'cancel'; resume is a waiting import going on once there is room (reason); restart is one a reload stopped, going on: how 'handles' (the tray's Resume) | 'drop' (the same folders dropped on the same cluster again), landed = files already in and skipped; stopped is that import offered in the tray on the next load (status = where the server left it, can_resume = this browser kept its folder) — it, and removed with stopped:true, carry the job's own source, 'bulk_folder'|'bulk_zip'; landing is a cluster the import made, its empty canvas's offer (components/UnplacedOffer.jsx): choice 'put'|'choose', n = files put, no source — the outcome is FOLDER_IMPORT with bulk:true, and the question IMPORT_PREFLIGHT with the same source
  WEB_IMAGE_SAVE:          'web_image_save',              // a web image, and whether a copy was kept (worker-media.js) {board_id,source,ok,code,bytes} — source:'drop' (dragged in from another tab) | 'backfill' (a hotlink from before copies were kept, lib/hotlinkBackfill.js) — code: 'saved' on success, else the route's error ('not_an_image','source_unavailable','over_quota','too_large','unsafe_url','busy',…) or a client skip. A failure is never shown: the card stays the hotlink it was
  ACTIVATED:               'activated',                   // first POPULATED board — a board crossed the genuine-card threshold {board_id,n} (the activation bar)
  CARD_MOMENTUM:           'card_momentum',               // a board crossed MOMENTUM_THRESHOLD genuine cards {board_id,n,threshold,images,text,mix} — the SECOND, higher activation bar. `activated` deliberately keeps its old meaning (dormancy gates and 90 days of history read it); this marks a higher one. The open question here was which bar lifecycle email should key off, and the answer turned out to be NEITHER: day-one return splits on COMPOSITION, not count. A first day of images only returns at 25%, which is exactly what accounts that placed nothing return at; images plus any writing returns at 55%. That is what `mix` ('mixed'|'images_only'|'text_only') records, at the moment the count bar is crossed, so the two are separable in one row. See mixPrompt.js for the full table
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

  // ── Messages (components/MessageThread + MessagesPanel; App logs the opens) ──
  // Shape only, never words: a length is a bucket, a search is its length, and
  // no name, title or emoji is recorded (lib/messageEvents.js).
  MSG_PANEL:               'msg_panel',                   // the Messages panel {action:'open', unread, convs} | {action:'close', ms (open for)} — only an open someone made: a reload with it already open logs neither
  MSG_CONV_OPEN:           'msg_conv_open',               // a conversation opened {via:'list'|'toast'|'person' (a face's DM)|'new'|'link'|'other', kind:'dm'|'group'|'solo'|null (just made), people, unread}
  MSG_SEND:                'msg_send',                    // each send attempt's answer {ok, attempt (1 = first try, 2+ = Retry), ms (to the server's answer), code (failure), chars:'xs'|'s'|'m'|'l', attach_n, mention_n, reply}
  MSG_ACTION:              'msg_action',                  // {action:'delete'|'undo_delete'|'edit'|'react'|'unreact'|'pin'|'unpin'|'copy_link'|'copy_text' (each with ok, and code on a failed write)|'reply'|'discard' (a failed send dropped; attempts)|'sheet' (press and hold opened the action sheet)}
  MSG_SEARCH:              'msg_search',                  // a search within a conversation ended {q_len, results_n, failed, picked (a result was opened)} — the last settled query, once per search

  // ── The Files sidebar (components/sidebar/ClusterSidebar.jsx) ──
  // What opens, moves, goes and gets starred, and how a search ended. Never a
  // file's name or a search's words. Tab and cluster switches are too frequent
  // to be events: they are counters on session_summary (files.*). Downloads and
  // shares from here are FILE_DOWNLOAD / the share events with surface:'sidebar'.
  FILES_OPEN:              'files_open',                  // a file opened from the sidebar {kind, how:'quick' (Quick look)|'show' (went to it on the board or in Files), view:'cluster'|'recent'|'starred', searching}
  FILES_MOVE:              'files_move',                  // one move or copy between clusters, answered {via:'drag'|'menu' (a file's menu)|'bar' (the selection's bar)|'finish' (the partial toast's Finish)|'undo', copy, n (asked), done (moved or copied), late (still uploading, stayed), outcome:'ok'|'partial'|'nothing'|'failed'|'refused' (let go where the drop rules said no — reason:'same'|'view-only'|'workspace'|'uploading'|'nothing', at:'tree' (a cluster's row)|'files' (the files of the cluster shown); the browser fires no drop there, so it is read off the drag's end)|'cancelled' (the Move to… picker closed), error, to_open (into the cluster on the board)}. One row per source cluster, as each gets its own Undo
  FILES_DELETE:            'files_delete',                // files deleted from the sidebar {from:'menu'|'bar'|'key', n, done, outcome:'ok'|'gone' (already gone)|'failed', error (a failed route call's code), live (from the cluster on the board, through its undo stack)} | {undo:true, ok}
  FILES_PUT:               'files_put',                   // files waiting in Files put on their board {from:'menu'|'bar'|'toast' (after a move), n, ok}
  FILES_STAR:              'files_star',                  // {on, what:'file'|'cluster'}
  FILES_SEARCH:            'files_search',                // a search in the sidebar ended {q_len, results_n (last settled), view, ended:'cleared'|'opened' (a file opened from it)|'palette' (⌘↵ handed it to the palette)|'left'} — once per search

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
  SHARE_OPEN:              'share_open',                  // opened the share DIALOG (the access console) {board_id,surface}. NOTE: until 2026-08-28 the one-tap topbar copy also emitted this with {quick:true}, which made the two ends of the funnel indistinguishable — that path now emits SHARE_LINK_COPIED{surface:'topbar'}. Rows before that date are mixed; split on props->>'quick'
  // A link was actually put on the clipboard. Previously DARK for every copy
  // made from inside the ShareModal (only the one-tap toolbar path emitted
  // anything, as share_open{quick:true}), so "opened the dialog" was the last
  // observable step and the copy itself was invisible. {kind:'view'|'invite',surface,board_id}
  ACCESS_GRANTED:          'access_granted',              // somebody was given access to a board/workspace {how:'workspace'|'email'|'invite_link',role,board_id,surface}. Answers WHICH MECHANISM creates collaborators — the board-invite-link machinery or shared workspaces
  CO_CREATION_STARTED:     'co_creation_started',         // a guest placed a card in someone else's workspace {board_id,workspace_id,how} — logEventOnce per board per pageload. The OUTCOME metric for collaboration; pair with COLLAB_SESSION (live co-presence) and ACCESS_GRANTED (the mechanism)
  SHARE_ASK_SHOWN:         'share_ask_shown',             // offered to SHOW this cluster after a work burst {board_id,cards} — once per board (localStorage soleil.shareask.<id>) and, since 2026-10-27, at most once a week per account (soleil.shareask.last.<uid>), routed through upsellSlot so it can never stack on the cap wall. The FIRST creator-facing surface that asks to show work rather than to recruit a collaborator
  SHARE_ASK_TAKEN:         'share_ask_taken',             // that offer's action was clicked → link copied {board_id} (must-land). Pair with SHARE_ASK_SHOWN for the ask's conversion rate
  SHARE_ACCESS_CHANGED:    'share_access_changed',        // WHO CAN OPEN THIS was changed in the share panel {from,to:'view'|'edit'|'off',has_link,board_id,surface}. The panel used to present the two link kinds as two independent sections with two create flows; copying was instrumented but CHOOSING was not, so there was no way to tell whether anyone ever wanted anything but the default. to:'off' is a revoke-everything, so no separate revocation event. has_link:false means the pick took no effect yet — the mode has no link and picking one deliberately does NOT mint (side-effecting server state off a dropdown read would litter links behind anyone browsing the options), so it records INTENT; filter it out for "changed the setting", keep it for "wanted an edit link"
  SHARE_LINK_COPIED:       'share_link_copied',           // a link went onto the clipboard {kind:'view'|'invite',surface,board_id,position?}. position:'top' = the share panel's own button in the link block (the link-first layout, 2026-10-27); absent on the panel's other copies (a pick on the link row, a Copy under Link settings) and on every copy before it
  SHARE_LINK_CREATED:      'share_link_created',          // a PUBLIC VIEW link was minted (not reused) from the share panel {expiry,include_subboards,board_id,surface}. The symmetric half of INVITE_LINK_CREATED, which only ever covered the editor path: takeLink()'s view branch mints through ensurePublicLink and emitted nothing, so every "show someone this cluster" — the common case, and the one shareAsk drives — was invisible as a creation and showed up only as a copy. Reading share_open → invite_link_created as a funnel therefore UNDERCOUNTS: it measures the recruit-a-collaborator path against an audience that mostly wanted the view path. Fires on mint only; a reused link is a copy, not a creation
  APP_TRACE:               'app_trace',                   // COALESCED micro-interaction batch for ESTABLISHED users {from_t,to_t,n,ev:[{t,k,tgt,...}]} — k:'dead'|'rage'|'key'|'route'. The third and last trace: lp_trace covers anonymous visitors on public pages, ps_trace covers a new user's FIRST session and closes at activation, and until this existed the largest population — signed-in people using the product they came back for — emitted nothing, so every friction finding we had was about someone's first hour. Deliberately quieter than ps_trace (an established session runs for hours, not minutes): plain clicks are DROPPED and only the evidence we have no other source for is kept. Never captures input values or typed characters — modifier commands only
  RETURN_SESSION:          'return_session',              // app_open on a later calendar day than last-seen {days_since_last_seen,tier}
  LANDING_FALLBACK:        'landing_fallback',            // {board_id} — no persisted stack on this device (new browser, cleared storage), so boot opened the most recently updated populated cluster instead of the root. Read with app_open{restored}: a returner "landed on their board" when either fired
  SESSION_SUMMARY:         'session_summary',             // ONE terminal row describing a whole session {of_session,visit_n,ms_span,events_n,cards_placed,intents_n,boards_opened,surfaces_n,wrote,errors_n,visible_ms,focused_ms,ended:'rotate'|'hide'|'pagehide', counters?:{key:n}, perf?:{frames:{le20,le34,le50,le100,le350,gt350},frame_ms,lt_n,lt_ms}} — counters (2026-10-20, only when something was counted) sum what is too frequent to be an event: input.mouse|touch|pen (every press, by pointer type), files.* (sidebar tabs, cluster switches, upload and meter clicks), canvas.* (one per gesture, as it settles: wheel.zoom|pan.mouse|trackpad, pinch, two_finger_pan, drag_pan.mouse|touch|pen, wasd); grep noteSessionCounter for the rest. perf (2026-10-20, lib/frameStats.js, only when anything ran) is how smoothly the session ran while in use: the gaps between the frames perfReport's interaction-gated sampler timed, counted by bound in ms (le20 is full rate at 60Hz and up), their total ms, and long main-thread tasks with their total ms (lt_n is 0 on Safari, which reports none) — visible_ms/focused_ms (2026-10-01) run to the emit, not the last event: a reference wall someone looks at without touching is visible and unfocused, a forgotten tab is hidden — see lib/sessionSummary.js. The ps_* family covers a new user's FIRST session and closes at activation, and app_trace is deliberately sparse, so the session preceding visit two summarised to NOTHING — and that is the exact transition where nearly all the loss is. Read `of_session` from props, NOT the app_session_id column: at a rotation this row describes the session that just ended while the client has already advanced to the next. A session hidden and then resumed emits a later, more complete row for the same of_session — take the LAST per of_session. Deliberately not a duplicate of usage_session, which owns per-surface active seconds and knows nothing about the visit ordinal, what got made, or how it ended
  SESSION_CONTEXT:         'session_context',             // ONE row per app session describing the setup it ran on, sent alongside the session's first real row {tz,tz_offset_min,lang,langs,region,net_kind,edge_src,vw,vh,sw,sh,dpr,gamut,pointer,any_fine,any_coarse,hover,touch_points,scheme,theme,reduced_motion,contrast,forced_colors,mem_gb,cores,net_type,conn_type,save_data,browser_major,standalone,native,webview,webview_app,ff:{<hold>:bool}} — see lib/sessionContext.js. Join other rows to it on app_session_id: unlike session_summary, this row's column IS the session it describes. region is ISO 3166-2 ('US-CA') and net_kind 'relay'|'hosting'|'edu'|'isp', both from the Worker: edge_src 'meta' when the page carried the soleil-ctx tag (lib/edgeContext.js), 'api' when the session started on `/` — which the static assets answer before the Worker runs, so it has no tag — and the app asked /api/ctx instead. All three null on dev and in the native shells, and when that ask failed or the row left before it answered. hosting means a VPN, a cloud desktop OR a bot: filter on it, never divert. edu means an education NETWORK, never a student or an age. A signup's context is that account's first session_context row. Sizes are rounded to 10px; no OS version on purpose (frozen in every user agent). Sessions before this shipped have none
  LIFECYCLE_LAND:          'lifecycle_land',              // arrived from a lifecycle email CTA, read off ?lc=<email_type>.<version> {email_type,content_version,signed_in,via} — the FIRST-PARTY click signal. Resend proxies every click through its own host and reports userAgent "Amazon CloudFront" on all of them, so its click webhook can't separate bot prefetch from a human and can't show whether anyone actually landed. This can. Fires once per page-load REGARDLESS of session, so the abandonment population stays visible; gating it on a user id (as it was until 2026-08-14) hid that population entirely. The param is stripped only once signed in, so it survives the OTP roundtrip. **signed_in IS MEASURED — treat pre-2026-08-31 rows as having no signal**: every lifecycle CTA carries ?rt= and lands on /resume, and ResumePage passed a hardcoded `false`, so every row in that window reads false by construction whatever the reader's real session was
  LIFECYCLE_RESUME:        'lifecycle_resume',            // a lifecycle click that landed signed-OUT subsequently got a session {email_type,content_version} — i.e. they hit the sign-in wall and made it through anyway, and the metric the /resume signed link is meant to move. Pair with lifecycle_land{signed_in:false} for the wall's kill count, but ONLY on rows from 2026-08-31 on — before that the denominator is a constant, not a measurement. Bot-filter either side: inbox scanners land within ~90s of a top-of-hour cron send and never press the button

  // ── The one question (see components/ReturnReasonAsk.jsx) ──
  // Behaviour can say what someone did and never why they decided this was not
  // for them. Asked only of people who RETURNED — the ones who left cannot be
  // asked honestly — and answered once per account for good, enforced by a
  // partial unique index the RPC upserts against rather than by localStorage.
  //
  // READ THE DENOMINATOR CAREFULLY. From 0310 onward RETURN_REASON_SHOWN fires
  // when the banner has been on a LIVE screen for several seconds, not when it
  // renders. Before that it fired at render, and a large share of those renders
  // were the last event in their session — a banner painted into a tab already
  // closing. Rates across that boundary are not comparable.
  RETURN_REASON_SHOWN:     'return_reason_shown',         // delivered to a live screen {days_since_last_seen} — the denominator
  RETURN_REASON_ANSWERED:  'return_reason_answered',      // a choice was taken {choice,days_since_last_seen,role_asked,age_asked,boards_opened,cards_placed,wrote} (must-land). role_asked/age_asked: the next step offers that question, the denominators of role_answered and age_range_answered. The session shape rides along so the self-report can be checked against behaviour. The answer TEXT never rides here; it goes to public.feedback and nowhere else
  RETURN_REASON_NOTE:      'return_reason_note',          // the follow-up was written {choice,len} — LENGTH ONLY, same rule as search_run's q_len
  RETURN_REASON_WRITE_FAILED: 'return_reason_write_failed', // the answer did not reach the table {code,terminal,stage}. Its absence is why 0282's total loss of every answer looked exactly like success — do not remove it
  RETURN_REASON_DISMISSED: 'return_reason_dismissed',     // "Not now" {days_since_last_seen,via:'x'|'skip'} — remembered permanently, so a high rate here means the ask is wrong and should come out rather than be re-timed a third time
  // Its second step (2026-10-01): "What best describes you?" — one per account,
  // the read that tells the professional positioning from the audience acquired.
  ROLE_ANSWERED:           'role_answered',               // a role was tapped {role,surface:'return_banner'} (must-land). Stored by submit_role in public.feedback kind='role'
  ROLE_WRITE_FAILED:       'role_write_failed',           // the role did not reach the table {code,terminal}
  // And under it, optional (2026-10-20): "Your age", five bands, one per account.
  AGE_RANGE_ANSWERED:      'age_range_answered',          // an age range was tapped {surface:'return_banner',after_role} (must-land). NEVER the band: submit_age_range stores it in public.feedback kind='age_range' (0471), the one place it lives
  AGE_RANGE_WRITE_FAILED:  'age_range_write_failed',      // the age range did not reach the table {code,terminal}

  // ── "What's holding you back?" (see components/UpgradeReasonAsk.jsx) ──
  // Asked once per account as a demo owner CLOSES an offer (the pricing modal,
  // or the over-cap import dialog). Until 2026-10-01 nobody had ever been asked
  // why they did not buy, so zero sales could not be read at all. Same
  // denominator rule as the return question: SHOWN fires only once the ask has
  // been on a live screen for a few seconds.
  UPGRADE_REASON_SHOWN:    'upgrade_reason_shown',        // delivered to a live screen {offer,surface,method,trial} — the denominator. offer = the modal header ('cap-hit'|'near-cap'|'first-value'|'storage'|…) or 'import'
  UPGRADE_REASON_ANSWERED: 'upgrade_reason_answered',     // a choice was taken {choice,offer,surface,trial} (must-land). choice ∈ enough_room|price|no_card|unsure_value|just_trying|other — the pre-registered read (price ≥ 35% reopens price; enough_room+unsure_value ≥ 50% reopens what Creator sells; no_card ≥ 25% reopens the card requirement)
  UPGRADE_REASON_NOTE:     'upgrade_reason_note',         // the optional follow-up was written {choice,len} — LENGTH ONLY
  UPGRADE_REASON_WRITE_FAILED: 'upgrade_reason_write_failed', // the answer did not reach the table {code,terminal,stage}
  UPGRADE_REASON_DISMISSED: 'upgrade_reason_dismissed',   // "Not now" {via:'x'|'skip'|'esc'} — remembered for good, so the account is not asked again

  // ── Send feedback (see components/FeedbackButton.jsx) ──
  // Dark until 2026-10-01: a row in public.feedback was the only trace, so how
  // many people opened the modal and gave up was unknowable.
  FEEDBACK_OPENED:         'feedback_opened',             // the Send feedback modal opened {surface}
  FEEDBACK_SENT:           'feedback_sent',               // it was sent {topic,has_text,len,has_image,contact_ok} — LENGTH ONLY, never the words

  // ── The bell (previously COMPLETELY DARK) ──
  // public.notifications, the panel, the live bus and the browser-notification
  // path all shipped without a single event between them, so "does anyone act
  // on a notification" has never been answerable. It mattered less while the
  // schedule RPCs were the only producer and none of them ran in production;
  // it matters now that share activity feeds the same list. `kind` is what
  // separates the producers from each other in the funnel.
  NOTIF_OPEN:              'notif_open',                  // the bell was opened {unread} — the denominator for notif_click
  NOTIF_CLICK:             'notif_click',                 // a notification row was clicked {kind,was_unread,opened_board}

  // ── View modes + list-mode "drive" usage (previously DARK: the Cluster Browser
  //    shipped with zero instrumentation, and upload-gate rejections left no
  //    signal beyond an eventual pricing_view{header:'storage'}) ──
  VIEW_MODE_SWITCH:        'view_mode_switch',            // Board↔Files toggle (stored as canvas↔list) {view:'canvas'|'list',board_id,via:'topbar'|'toast'|'reveal'|'power_reveal'|'shortcut'|'palette'} — 'reveal' = the list-surface Reveal-on-canvas action; 'power_reveal' = the list_drive JIT hint; 'shortcut' = the F key; 'palette' = ⌘K Switch to Files/Board; the tour's terminal advance rides onboarding_step instead
  FILES_DOCK:              'files_dock',                  // Files beside the board changed size {from,to:'off'|'panel'|'full',via:'topbar'|'shortcut'|'palette'|'button'|'divider'|'reveal'|'power_reveal',board_id}
  LIST_BROWSER_VIEW:       'list_browser_view',           // ListSurface mounted (once per board per session) {board_id,files,subclusters}
  LIST_ADD_FILES:          'list_add_files',              // files handed to the list-mode ingest {board_id,n,via:'toolbar'|'drop'}
  LIST_UPSELL_CTA:         'list_upsell_cta',             // "Any file, any size — Creator" clicked in the list toolbar {board_id} (must-land)
  UPLOAD_BLOCKED:          'upload_blocked',              // an upload was refused {reason:'over_free_cap'|'owner_not_paid'|'server_403'|'server_quota'|'video_too_long',surface:'canvas'|'list',ext,size_bucket,n,duration_s?,max_s?} — over_free_cap = client hard-block since 0367 (free owner, file past the free size caps — the TYPE is no longer a reason); owner_not_paid = the same block before 0367 (free owner, non-standard file; historical rows only); server_* = party /mpu 403/402; video_too_long = the free-tier clip-length cap (uploads.js), the one paid limit that used to refuse silently
  UPLOAD_ABANDONED:        'upload_abandoned',            // photo cards saved without their file by a page that went away mid-upload, found on a later open {board_id,n,recovered,removed} — recovered = the original had landed and only the src patch was lost; removed = it never landed (lib/abandonedUploads.js). Before 2026-10-01 these spun 'Uploading…' for ever and were counted toward the cap
  FILE_SKIPPED:            'file_skipped',                // a dropped/pasted file was skipped ON PURPOSE, never pitched {reason:'partial_download'|'pureref',surface:'canvas'|'list',n,ext} — partial = an unfinished browser download (.crdownload/.part/…); pureref = a free owner's .pur scene, which no plan can open. Kept OUT of upload_blocked so readers counting paid refusals are not inflated by files nobody could have bought their way past
  SCRIPT_IMPORTED:         'script_imported',             // a dropped .fountain/.fdx became a script document {source:'drop'|'paste'|'list_drop',format:'fountain'|'fdx',blocks} — free on every tier; it used to fall through to the paid generic-file route
  STORAGE_WALL_VIEW:       'storage_wall_view',           // an upload was refused because the owner's drive is full (402 over_quota) {surface:'canvas'|'list'|'folder',own,paid,offered} — once per page per surface and kind of uploader. own = the uploader owns the workspace; paid = that owner is on Creator/admin (no offer, told how to make room); offered = the Creator offer modal opened rather than standing down. Since 0413 this is the only byte refusal on any plan
  STORAGE_ADDON_VIEW:      'storage_addon_view',          // the extra-storage sheet opened {surface:'settings'|'storage_wall', mode:'add'|'remove'} — held behind STORAGE_ADDON_HELD until Stripe is set up. A purchase is recorded SERVER-side (0415 trigger: storage_blocks_changed), never here
  STORAGE_ADDON_FAIL:      'storage_addon_fail',          // the sheet showed a refusal or failure {surface, mode, stage:'preview'|'apply', code} — code is the storage-addon function's own (storageAddonCore addonRefusal)
  STORAGE_ADDON_REMOVE:    'storage_addon_remove',        // a reader removed a block from the sheet {surface, blocks} (blocks = the total left); the change itself is storage_blocks_changed, server-side
  HELD_DROP_KEPT:          'held_drop_kept',              // files a drop could not place were kept in the tab, to upload when there is room (lib/heldUploads) {via:'canvas'|'list'|'folder', limit:'storage'|'cards', n, size_bucket}. Only on the person's own plan: nothing they can buy would make room in someone else's cluster
  HELD_DROP_RELEASED:      'held_drop_released',          // kept files went back through their drop {via, limit, n, size_bucket, held_ms} — the plan went paid, the drive grew, or "Upload now". Whether they then FIT is the drop's own import_preflight row
  HELD_DROP_DISCARDED:     'held_drop_discarded',         // kept files were let go without uploading {via, limit, n, size_bucket, reason:'discard'|'checkout_same_tab'} — discard is the bar's Discard; checkout_same_tab is a checkout that could not open a new tab, so the files could not survive it
  UP_STORAGE_TOAST_CTA:    'up_storage_toast_cta',        // "See Creator" on a refusal toast was clicked {surface:'canvas'|'list',reason} (must-land). Only reachable when the storage gate STOOD DOWN — the modal is latched once per session, so on the second and later refusals this toast is the ONLY route to the offer, and without this event that route is dark exactly where the pacing change is being judged

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
  SHARE_VIEW:              'share_view',                  // public viewer mounted {board_id,root_id,include_subboards,valid,link_kind:'public'|'view'|'invite',link_role} (never the link's token — linkTokens.js); link_kind/link_role from the sharing insight's capture fix on
  SHARE_SUBBOARD_OPEN:     'share_subboard_open',         // navigated into a sub-board {board_id,from_board_id,depth,cached}
  SHARE_CTA_CLICK:         'share_cta_click',             // signup CTA clicked {surface:'topbar'|'prompt'|'invalid_page'|'badge'|'signin'|'remix'} (must-land)
  FILE_SHARE_OPEN:         'file_share_open',             // the owner's Share file dialog opened {kind,surface:'canvas'|'list'|'player'|'quicklook'}
  FILE_SHARE_ACCESS_SET:   'file_share_access_set',       // a file share's general access or download switch changed {link_access:'none'|'view'|'comment'|'edit',allow_download,kind} — a file's link is view | comment, a doc's view | edit (anyone signed in can edit it); kind is FILE_SHARE_OPEN's, 'doc' for a doc
  FILE_SHARE_PEOPLE_ADD:   'file_share_people_add',       // people added to a file share by email {n,role:'view'|'comment'|'edit',skipped,kind} — role 'edit' is a doc's Can edit; kind as FILE_SHARE_ACCESS_SET
  FILE_SHARE_LINK_COPY:    'file_share_link_copy',        // a file share's /f/ link was put on the clipboard {link_access,kind}
  FILE_SHARE_PERSON_SET:   'file_share_person_set',       // one person's access on a file share changed {role:'view'|'comment'|'edit'|null,undo,kind} — null = removed; undo: Remove's Undo put them back. With the adds, every confirmed write the Share dialog makes has its row, so FILE_SHARE_FAIL has a denominator
  FILE_SHARE_FAIL:         'file_share_fail',             // the Share dialog's read or a write failed, and it showed the error {action:'load'|'access'|'add'|'role'|'remove'|'undo_remove'|'link'|'clipboard',code,kind} — code: the server's error code (42501 = not allowed), null when there was none (a network failure; the clipboard). Never the message, which can carry an address
  SHARE_RETURN_LANDED:     'share_return_landed',         // {} — a sign-up/sign-in that began on a /share page was sent back to that page once a session existed, instead of to the root of an empty workspace. Before this, no share-token signup ever first-opened the board they came for
  FILE_SHARE_VIEW:         'file_share_view',             // the /f/<token> page loaded a state {status:'ok'|'gone'|'sign_in'|'no_access'|'error',access,kind,signed_in,risky,share_id} — once per load; share_id (0742) names the share, in place of its token
  FILE_SHARE_DOWNLOAD:     'file_share_download',         // Download clicked on /f/<token> {kind,access}
  FILE_SHARE_SIGNIN_CLICK: 'file_share_signin_click',     // a sign-in link on /f/<token> {surface:'gate'|'comments'|'switch_account'} (must-land)
  FILE_SHARE_CTA_CLICK:    'file_share_cta_click',        // the signed-out "Try Clusters free" footer on /f/<token> {surface:'footer'} (must-land)
  FILE_SHARE_RETURN_LANDED: 'file_share_return_landed',   // {} — a sign-in that began on /f/<token> was sent back to that file once a session existed
  SHARED_PAGE_VIEW:        'shared_page_view',            // the Shared page opened {tab:'with_me'|'by_me',n,unread} — once per open
  SHARED_FILE_OPEN:        'shared_file_open',            // a file shared with you opened inside the app {via:'shared_page'|'bell'|'toast'|'shortcut'|'link'}
  SHARED_FILE_SAVE:        'shared_file_save',            // Save a copy of a file shared with you {kind,ok,reason}
  SHARED_FILE_SHORTCUT:    'shared_file_shortcut',        // a live shortcut to a file shared with you put on a cluster {kind,ok,reason}
  SHARED_FILE_HIDE:        'shared_file_hide',            // a file taken off (or put back on) "Shared with me" {hidden}
  FILE_SHARE_STOP:         'file_share_stop',             // Stop sharing from "Shared by me" {kind,undone}
  FILE_COMMENT_ADD:        'file_comment_add',            // a comment posted on a shared file {kind,pinned:'time'|'page'|null,reply}
  FILM_PLAY:               'film_play',                   // a clip started playing in the film player, once per viewing {surface:'card'|'quicklook'|'review'|'file_share'|'shared_file',auto,compare,muted} — file_share is the /f/ page, shared_file the same file opened inside the app — auto: it started as the player opened (a card's play button, Quick look, the review player) rather than from its own transport; compare: an A/B pair was loaded. lib/filmWatch.js
  FILM_WATCH:              'film_watch',                  // that viewing, summed up when the player let go of the clip or the page went away {surface,played_s,pct,dur_s} — played_s: seconds actually playing; pct: the furthest point reached while playing, in buckets 0|10|25|50|75|90|100 (within half a second of the end is 100), null when the length never became known
  FILM_FAIL:               'film_fail',                   // the film player showed it couldn't play a clip {surface,reason:'decode'|'no_picture'|'stalled'|'sign',codec} — decode: the browser can't decode it (ProRes off a Mac); no_picture: sound but no picture; stalled: no frame after 8s (15s on a card); sign: no link to the file could be made. codec: the clip's four-character code when known. Once per clip and reason a page load
  SHARE_DWELL:             'share_dwell',                 // time on the public viewer {ms,board_id,boards_opened}
  SHARE_PROMPT_VIEW:       'share_prompt_view',           // engagement prompt shown {trigger:'dwell'|'subboard'}
  SHARE_PROMPT_DISMISS:    'share_prompt_dismiss',        // prompt dismissed {trigger,visible_ms}

  // ── Referral / "Invite friends, earn free cards" (migration 0163) ──
  // Client-fired; the three conversion events (signup/activated/reward_granted)
  // are fired SERVER-side from the signup + first-card triggers into analytics_events.
  REFERRAL_OPEN:           'referral_open',               // opened the invite surface {surface:'cap_toast'|'nudge'|'cap_modal'|'menu'|'reward_toast'|'paid_nudge'|'share_modal'}
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
  REFERRAL_REWARD_GRANTED: 'referral_reward_granted',     // SERVER: referrer credited {referee,amount,storage_bytes}

  // ── Collaborator invites (the "build together" growth loop) ──
  // The banner fires at the activation beat (3 genuine cards) and routes into
  // the ShareModal's Invite People section. INVITE_SENT is the k-factor
  // numerator the referral ledger can't see — it only records signups.
  INVITE_NUDGE_VIEW:       'invite_nudge_view',           // "build this together" banner shown {surface}
  INVITE_NUDGE_CTA:        'invite_nudge_cta',            // banner CTA clicked → Share panel (must-land)
  INVITE_NUDGE_DISMISS:    'invite_nudge_dismiss',        // banner dismissed {surface}
  INVITE_SENT:             'invite_sent',                 // collaborator invite(s) submitted {role,result:'granted'|'pending',n,surface,reward_note:'free'|'paid'} (must-land). The setup's invite panel also sends method:'email' and surface 'setup'|'reask'
  INVITE_LIMIT_REACHED:    'invite_limit_reached',        // the server's invite budget (0358/0375) stopped a send {surface:'setup'|'reask', method:'email', kind:'first_day'|'daily'|'paused', unsent (addresses it never sent)} (must-land). Only the setup's invite panel sends it so far; the share panel doesn't

  // ── Invite links ("anyone with this link joins as editor/viewer", 0189) ──
  INVITE_LINK_CREATED:     'invite_link_created',         // link minted/reused in ShareModal {role,expiry,board_id,surface} (must-land)
  INVITE_LINK_VIEW:        'invite_link_view',            // join confirm card rendered on /share {role,root_id} (once per token/session); root_id: the cluster the link opens
  INVITE_LINK_JOIN_CLICK:  'invite_link_join_click',      // "Join as …" clicked {role,root_id} (must-land)
  INVITE_LINK_CLAIMED:     'invite_link_claimed',         // SERVER: claim_collab_link granted access {board_id,role,status}
  INVITE_LINK_CLAIM_FAILED:'invite_link_claim_failed',    // claim_collab_link raised after signup/click {reason}
  // Client-side outcome for EVERY claim, not just the granting one. The server
  // event above only fires on the fresh-join branch — 'upgraded' | 'already' |
  // 'noop' all return early and left the funnel dark (join clicks with neither
  // a success nor a failure recorded). {status} (must-land)
  INVITE_LINK_CLAIM_RESULT:'invite_link_claim_result',

  // ── First-run setup (workspace_setup arm B, components/setup) ──
  // Name the workspace, who and what it's for, invite — before the canvas.
  // setup_*, not welcome_*: welcome_* is the waitlist page's. Every step logs
  // its view and the move that left it, with the time spent on it.
  SETUP_STEP:              'setup_step',                  // {step:'name'|'who'|'invite'|'invitee', action:'view'|'done'|'skip'|'back', ms (on leaving), invitee, phone, chars (name), team, work}
  SETUP_DONE:              'setup_done',                  // the steps ended and the app opens {invitee, team, work, invite:'sent'|'skipped'|null, emails, links, ms_total, phone} (must-land)
  SETUP_ERROR:             'setup_error',                 // a step's write or read failed {op:'workspace'|'settings'|'link', surface, reason}
  // In the workspace afterwards (components/setup/SetupInWorkspace). The tips
  // go to every new account, both arms; the re-ask only to arm B skippers.
  SETUP_TIPS:              'setup_tips',                  // the sidebar/Files/import tips {tip:'clusters'|'files'|'import', action:'view'|'next'|'drawer' (a phone opened the drawer itself)|'skip'|'done'|'how'|'dismiss' (shut the drawer mid-tips), cards (own, at that moment), phone}
  INVITE_REASK:            'invite_reask',                // the one re-ask at REASK_MIN_CARDS {action:'view'|'not_now'|'done'|'close', cards, emails, links, phone} (closes must-land)
  WHATS_NEW_HINT:          'whats_new_hint',              // the one-time "New" hint on the Files card, for accounts made before the files sidebar (lib/whatsNew.js; newer ones get setup_tips instead) {hint:'files_card', action:'shown'|'dismissed'|'changelog'} — shown is logged once it is on screen; dismissed is Got it, Escape, or what it pointed at going away (the Files card folded, the drawer shut); changelog is What else is new. Nothing else rides it: no text, link or id
  BOARD_MORE_NUDGE:        'board_more_nudge',            // the first-board test (experiments.js first_board_more, lib/boardMore.js) {action:'eligible' (both arms, the moment B would see it)|'view' (B, on screen)|'folder'|'photos'|'note' (B pressed it)|'dismiss' (the ×)|'expire' (gone on its own), arm, cards (genuine, on that board), phone, folder (could pick a folder), pictures (the board had a picture)} — nothing else rides it: no board, text or file names
  JOINER_LANDED:           'joiner_landed',               // where someone who joined by a workspace link first landed {via, on_root, board_cards, ws_cards, empty (the workspace had no cards), phone}
  JOINED_TOAST:            'joined_toast',                // the "{name} joined" toast an inviter sees {action:'shown'|'open', scope:'workspace'|'board'}

  // ── Workspace invite links ("anyone with this link joins the workspace", 0450) ──
  // The whole-workspace sibling of invite_link_*: ?wsjoin=<token> on the app's
  // root. One funnel: created → shared → landed → claim result (server: claimed).
  WORKSPACE_LINK_CREATED:  'workspace_link_created',      // made or reused as an invite panel opened {surface:'setup'|'reask', role}
  WORKSPACE_LINK_SHARED:   'workspace_link_shared',       // {surface, method:'copy'|'share', ok (copy reached the clipboard), by:'hand' (the browser refused, and they copied the shown link themselves), completed (the share sheet finished; closing it still counts as out)} (must-land)
  WORKSPACE_LINK_LANDED:   'workspace_link_landed',       // someone opened a ?wsjoin link {status:'live'|'member'|'dead'|'error', signed_in}
  WORKSPACE_LINK_CLAIM_RESULT:'workspace_link_claim_result', // a claim's outcome, every branch {status:'joined'|'member'|'dead'|'error', at:'signup'|'card', reason} (must-land)
  WORKSPACE_LINK_CLAIMED:  'workspace_link_claimed',      // SERVER: claim_workspace_invite_link let someone in {workspace_id, role, status}
  EDITOR_LIMIT_VIEWER_FALLBACK: 'editor_limit_viewer_fallback', // SERVER: an edit link let someone in as a viewer because the account had 10 people who can edit {via:'collab_link'|'workspace_link', upgrade, workspace_id, board_id}
  // The Team plan. The setup and its return, from the app; then the server's
  // own, written by SQL (_team_event, 0532-0534). Ids and counts only, never a
  // token or an address.
  TEAM_SETUP_OPEN:         'team_setup_open',             // /team/new opened to make a real team {seats, billing} (as the link carried them; seats null when it carried none)
  TEAM_CHECKOUT_START:     'team_checkout_start',         // (must-land) "Continue to payment" got a Stripe checkout {seats, plan, workspaces}
  TEAM_CHECKOUT_FAILED:    'team_checkout_failed',        // start_team_checkout said no, or team-billing failed {error} (a failure by name, so the admin Issues view counts it)
  TEAM_READY:              'team_ready',                  // back from Stripe, the checkout verified {created, kind}
  TEAM_TALK_VIEW:          'team_talk_view',              // /pricing/talk-to-us opened (TalkToUsPage)
  TEAM_TALK_SENT:          'team_talk_sent',              // Talk to us kept a request {already, needs, editors, signed_in}; never the name, email or company
  TEAM_TALK_FAILED:        'team_talk_failed',            // Talk to us didn't send {error:'invalid'|'busy'|'network'} (a failure by name, so the admin Issues view counts it)
  TEAM_CREATED:            'team_created',                // SERVER: a paid or trialing checkout made a team {org_id, seats, plan, trial, workspaces, skipped}
  TEAM_RENEWED:            'team_renewed',                // SERVER: a lapsed team paid again {org_id, seats, plan}
  TEAM_JOINED:             'team_joined',                 // SERVER: someone became a team member (invite, link, domain offer) {org_id, ...}
  TEAM_SEAT_VIEWER_FALLBACK:'team_seat_viewer_fallback',  // SERVER: an edit door let someone in as a viewer because the team had no free seat {via, workspace_id, board_id}
  TEAM_CLOSED:             'team_closed',                 // SERVER: close_team gave a team's workspaces back as explicit shares {org_id, workspaces}
  // The 10-editor limit in the app (held: editorLimitAllowed). Counts and
  // stages only: no address, name or token rides these.
  EDITOR_LIMIT_SEEN:       'editor_limit_seen',           // the share panel's note or Members' "People who can edit" showed {surface:'share_modal'|'members', stage:'near'|'full'|'over'|'room', owner}
  EDITOR_LIMIT_REFUSED:    'editor_limit_refused',        // a door said no for want of room {door:'share'|'workspace_invite'|'member_role'|'share_role'|'restore'|'widen', ask (the caller isn't the owner), surface}
  EDITOR_LIMIT_ASK_SENT:   'editor_limit_ask_sent',       // "Ask Alex for room" {result:'sent'|'already_sent'|'not_full'|'owner'|'error', surface}
  EDITOR_LIMIT_SEE_WHO:    'editor_limit_see_who',        // the note's See who opened Members {surface, stage}
  EDITOR_LIMIT_MAKE_ROOM:  'editor_limit_make_room',      // the owner freed a place from "People who can edit" {action:'make_viewer'|'remove'|'revoke', ok, grants}
  EDITOR_LIMIT_NOTICE_OPEN:'editor_limit_notice_open',    // an editors.limit_reached notice opened Members {via:'toast'|'bell'}

  // ── Remix ("Make a copy" — clone a public board into your workspace, 0168) ──
  REMIX_CLONE:             'remix_clone',                 // a shared/public board was cloned into the user's workspace {kind:'token'|'slug',n,source_board_id}; the link behind it is in remix_sources (0743)
  REMIX_FAILED:            'remix_failed',                // remix consume failed {kind,stage,reason}

  // ── Public marketing boards (/c/<slug> + /explore, migration 0136) ──
  EXPLORE_VIEW:            'explore_view',                // /explore index mounted {count}
  EXPLORE_SEARCH:          'explore_search',              // /explore search used (once/session) {q}
  EXPLORE_CARD_CLICK:      'explore_card_click',          // /explore card → /c/<slug> {slug,pos,sort,topic,has_query}

  // ── Public pages (uniform lp_* engagement family — lib/landingMetrics.js +
  //    hooks/useLandingEngagement.js). EVERY public page fires the same schema so
  //    the admin_landing_scorecard RPC GROUP BYs one event set: every landing
  //    spec in SEO_LANDING_PATHS (/tools/*, /vs/*, /use-cases, /scout, and
  //    /templates where the template store ships), the /best/*
  //    listicles, /, /pricing, /explore, /c/<slug>, /share aggregate, every
  //    /docs/** page, /changelog, /legal/*, the template item pages, and the 404
  //    shell. Every lp_* row carries the base {page,page_kind} — page = canonical
  //    path ('/tools/…', '/', '/docs/api', '/changelog', '/c/<slug>', '/share' —
  //    NEVER a share token; the 404 shell reports the constant '/404' and leaves
  //    the real URL on the row's `path` column). page_kind = tool|compare|hub|
  //    listicle|home|pricing|explore|public_board|share|docs|changelog|legal|
  //    template|template_community|not_found. The docs/changelog/legal/template
  //    kinds arrived 2026-09-18 — before that those pages emitted nothing, so
  //    any series on them starts there.
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

  // ── Connecting an app or AI assistant by OAuth (/oauth/authorize, the
  //    consent page). The step before it, signing in, is landing_view with path
  //    '/oauth/authorize'; the grant itself is the server's oauth_consent_granted
  //    (0224); admin_mcp_funnel joins them per client. Props come from
  //    lib/oauthConnect.js connectEventProps {client_id,client_kind:'dcr'|'cimd',
  //    redirect_host,scopes,new_account}: the redirect HOST only ('loopback' for
  //    a callback on the person's computer, 'cursor:' for a private scheme),
  //    never the code, the state or the challenge. ──
  OAUTH_AUTHORIZE_VIEW:    'oauth_authorize_view',        // the consent screen shown for a valid request (once per client per page load)
  OAUTH_CONSENT_ALLOWED:   'oauth_consent_allowed',       // Connect pressed and the code issued, beaconed before the redirect
  OAUTH_CONSENT_DENIED:    'oauth_consent_denied',        // Cancel pressed, beaconed before the redirect
  OAUTH_AUTHORIZE_ERROR:   'oauth_authorize_error',       // the screen refused the request {stage:'request'|'client'|'consent',reason} — reason is consentRequestFault's code at 'request', else the server's OAuth error code, http_<status> or 'network'

  // ── A draft's keep page (/keep/<token>, pages/KeepPage.jsx): what ChatGPT or
  //    Claude made for someone without an account. Never the token, the email
  //    or anything in the draft: host is mcp_drafts.host ('chatgpt'|'claude'|
  //    'other'), cards a count. The draft's own steps are the server's rows
  //    (mcp_drafts, and mcp_draft_kept from keep_mcp_draft, 0706);
  //    admin_mcp_drafts joins them per host. ──
  KEEP_PAGE_VIEW:          'keep_page_view',              // the draft's first read answered, once per page load {state:'live'|'kept'|'expired'|'unknown',host,cards (live only)}
  KEEP_CODE_SENT:          'keep_code_sent',              // the island's sign-in code sent {resend}
  KEEP_KEPT:               'keep_kept',                   // keep_mcp_draft kept it {host,via:'code'|'signed_in',beside_own}
  KEEP_FAILED:             'keep_failed',                 // a step failed {step:'load'|'send'|'code'|'keep',reason} — reason is keepFailReason() (an auth code, http_<status>, 'network' or 'error'), or keepFailure()'s word at 'keep'

  // ── /make (pages/MakePage.jsx): a board an AI without the Clusters app wrote
  //    into a link, or as text to paste, shown before it is kept. Counts only:
  //    never the link, its text, a picture's address or the email. ──
  MAKE_PAGE_VIEW:          'make_page_view',              // a board shown, from a link or pasted text, or the paste box opened (from 'none') {from:'link'|'text'|'none',cards,pictures,left_out,cut} — left_out: pictures that didn't load or whose address we'd never fetch; cut: the chat cut the link short
  MAKE_CODE_SENT:          'make_code_sent',              // the island's sign-in code sent {resend}
  MAKE_KEPT:               'make_kept',                   // POST /api/make/keep made the board {via:'code'|'signed_in',cards,left_out,fit} — left_out: pictures that couldn't be copied in
  MAKE_FAILED:             'make_failed',                 // a step failed {step:'send'|'code'|'keep',reason} — keepFailReason() at send/code; the route's code, http_<status> or 'network' at keep

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
  TAG_SPOTLIGHT:           'tag_spotlight',               // lit a tag's cards up on the open cluster {tag_id,via:'card_chip'|'board_chip'|'group_chip'}
  TAG_SUGGESTION_DISMISS:  'tag_suggestion_dismiss',      // dismissed a suggested tag on a card {tag_id,via:'card'} (accepting one is a TAG_MANUAL_APPLY via 'suggested_chip')
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
// The bar is deliberately "the user changed the contents of a cluster, or wrote
// to the people they work with". Opening a board, running a search, or sharing
// a link are all meaningful — but they are things you do to look at work, not
// to make it, and a definition that admits them drifts straight back into
// measuring presence.
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
  // A day spent writing to the people you work with is a working day too (the
  // owner's call, 2026-10-20). The server stamps it from the messages table
  // (0473, messages_active_day); this keeps the session summary and the
  // engaged-visit read agreeing with it.
  EV.MSG_SEND,
]));

// A work event that reports it failed did not happen: a msg_send with ok:false
// is a message that never arrived. Every reader of WORK_EVENTS applies this one
// rule — logEvent here, sessionSummary.js, and _admin_engaged_visits in SQL.
export function isWorkEvent(name, props) {
  return WORK_EVENTS.has(name) && !(props && props.ok === false);
}

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
  SETUP:        'setup',         // the first-run setup steps (workspace_setup arm B), before App
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
  'signup', 'boot', 'tier_gate', 'waitlist', 'ad_welcome', 'setup', 'app_enter',
  'seed', 'coachmark', 'first_intent', 'blocked', 'stuck',
  'first_card', 'nest', 'populated',
]);

// Map an auth/network error to a stable machine code for *_error events.
// Mirrors the substring logic of humanError() in AuthGate but returns a code,
// not user copy, so we can aggregate "why did email→OTP drop".
export function classifyAuthError(e) {
  const m = (e?.message || String(e || '')).toLowerCase();
  if (m.includes('captcha'))                            return 'captcha';
  if (m.includes('rate') || m.includes('too many'))   return 'rate_limit';
  // GoTrue returns the single message "Token has expired or is invalid" for a
  // wrong code AND for an expired one. Reading it as 'expired' told every
  // mistyped digit to request a new code; it is one reason, not two.
  if (m.includes('expired') && m.includes('invalid'))   return 'code_rejected';
  if (m.includes('expired'))                            return 'expired';
  if (m.includes('invalid') && m.includes('token'))    return 'invalid';
  if (m.includes('email') && m.includes('invalid'))    return 'invalid_email';
  if (m.includes('network') || m.includes('fetch') || m.includes('failed to fetch')) return 'network';
  return 'other';
}
