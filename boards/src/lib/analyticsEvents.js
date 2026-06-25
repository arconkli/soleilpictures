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
  EMAIL_SUBMIT:            'email_submit',                // OTP send ok {resend}
  EMAIL_SUBMIT_ERROR:      'email_submit_error',          // OTP send failed {reason,resend}
  OTP_VERIFY:              'otp_verify',                  // code verified ok
  OTP_VERIFY_ERROR:        'otp_verify_error',            // code verify failed {reason}
  LANDING_EDIT_EMAIL:      'landing_edit_email',          // "edit" clicked on the code step
  LANDING_CALLBACK_ERROR:  'landing_callback_error',      // magic-link ?code= exchange failed {reason}
  LANDING_SCROLL:          'landing_scroll',              // reveal scroll depth crossed {depth}
  LANDING_EXPLORE_CLICK:   'landing_explore_click',       // "Explore a live board" clicked
  LANDING_FOOTER_CLICK:    'landing_footer_click',        // footer legal/email link {target}
  LANDING_DWELL:           'landing_dwell',               // time on landing {ms,max_depth}

  // ── Welcome / Waitlist ──
  WELCOME_VIEW:            'welcome_view',                // welcome screen mounted
  WELCOME_CTA:             'welcome_cta',                 // {target:'waitlist'|'pricing'}
  WELCOME_SIGNOUT:         'welcome_signout',             // "use a different email"
  WELCOME_DWELL:           'welcome_dwell',               // {ms}
  SUBMIT_SOCIALS_OPEN:     'submit_socials_open',         // waitlist modal opened
  WAITLIST_FIELD_ENGAGE:   'waitlist_field_engage',       // first input into a link row
  WAITLIST_ROWS_CHANGED:   'waitlist_rows_changed',       // final link-row count {rows}
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

  // ── Ad offer (fbclid instant-demo) ──
  AD_OFFER_VIEW:           'ad_offer_view',               // price-first screen shown to ad-sourced demo user
  AD_OFFER_ENTER:          'ad_offer_enter',              // chose "continue into workspace" (skipped buying) {plan}
  AD_OFFER_DWELL:          'ad_offer_dwell',              // {ms}
  AD_OFFER_ABANDON:        'ad_offer_abandon',            // hid the AdWelcome offer without buying OR continuing {ms} (the silent bounce; beacon)
  INSTANT_ENTRY_SKIP:      'instant_entry_skip',          // instant_entry arm B: the pre-app offer gate was SKIPPED — user dropped straight into the seeded board {arm} (symmetric marker to ad_offer_view; offer deferred to first_value_upgrade_*)

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
  ONBOARDING_FIRST_CARD:   'onboarding_first_card',       // user placed their OWN first card during onboarding (activation north-star)
  ONBOARDING_NEST:         'onboarding_nest',             // first time the seed note is dragged into the tutorial board — the retention AHA {board_id,source_board_id,n}
  ONBOARDING_DISMISS:      'onboarding_dismiss',          // onboarding ended {reason:'placed'|'dismissed'|'nested'}
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
  CARD_CREATE_INTENT:      'card_create_intent',            // user did something that signals "make a card" {method,board_id} — method:'dblclick'|'add_menu'|'context_menu'|'tool_place'|'drag_in'|'paste'|'empty_cta'|'mobile_nav'. Fired BEFORE the mutator so a blocked create still has a preceding intent.
  CARD_CREATE_BLOCKED:     'card_create_blocked',           // an intent that produced no card {reason,method?,board_id} — reason:'demo_cap'|'demo_blocked'|'read_only'|'place_miss'|'stale_paste'|'noop_svg'|'mutator_null'
  CARD_CREATE_STUCK:       'card_create_stuck',             // new user appears stuck placing a first card {reason,intents,seconds,method_last} — reason:'timeout'|'rage' (logEventOnce per page-load)
  MOBILE_LIFT_HINT_SHOWN:  'mobile_lift_hint_shown',        // first time a touch user's drag-from-a-card panned instead of moving — one-time press-and-hold hint shown {board_id}

  // ── Onboarding failure paths (previously SILENT — a broken seed/persist left no signal) ──
  ONBOARDING_SEED_FAILED:            'onboarding_seed_failed',             // a seed step threw {stage,reason} — stage:'create_board'|'add_cards'|'persist'
  ONBOARDING_SETTINGS_PERSIST_FAILED:'onboarding_settings_persist_failed', // merge_profile_settings rejected {op,reason} — op:'seed'|'dismiss'
  ONBOARDING_FIRST_SOURCE_FAILED:    'onboarding_first_source_failed',     // set_first_source rejected {reason} (fired inside analytics.js where the RPC lives)

  // ── Experiments (A/B harness, see experiments.js + profiles.settings.experiments) ──
  EXPERIMENT_ENROLLED:     'experiment_enrolled',           // a genuinely-new user was assigned an arm at first seed {key,arm} (arms also ride every event as exp_<key>)

  // ── Product activity ──
  APP_OPEN:                'app_open',                    // app mounted with tier loaded {tier} — session/retention marker
  CARD_PLACED:             'card_placed',                 // GENUINE card(s) placed on a board {n,kind,board_id,workspace_id,actor} — seeds excluded (see firstValueTrigger.areSeedCards); powers the admin Command Center live ticker
  ACTIVATED:               'activated',                   // first POPULATED board — a board crossed the genuine-card threshold {board_id,n} (the activation bar)

  // ── In-product engagement (breadth / depth / intent / loop / return — batched, high-signal) ──
  BOARD_OPEN:              'board_open',                  // opened/navigated to a board {board_id,depth,is_subboard}
  CARD_EDIT:               'card_edit',                   // edited a card's content (once per card per session) {kind,board_id}
  DOC_EDIT:                'doc_edit',                    // edited a doc surface (once per doc per session) {board_id}
  SEARCH_RUN:              'search_run',                  // ran a search / command {has_results}
  SHARE_OPEN:              'share_open',                  // opened the share surface {board_id}
  RETURN_SESSION:          'return_session',              // app_open on a later calendar day than last-seen {days_since_last_seen,tier}

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
  REFERRAL_NUDGE_VIEW:     'referral_nudge_view',         // post-activation invite nudge shown
  REFERRAL_NUDGE_CTA:      'referral_nudge_cta',          // nudge "Invite friends" clicked → opens tab (must-land)
  REFERRAL_NUDGE_DISMISS:  'referral_nudge_dismiss',      // nudge dismissed
  REFERRAL_SIGNUP:         'referral_signup',             // SERVER: friend signed up via a referral {source,code}
  REFERRAL_ACTIVATED:      'referral_activated',          // SERVER: referee created first genuine card
  REFERRAL_REWARD_GRANTED: 'referral_reward_granted',     // SERVER: referrer credited {referee,amount}

  // ── Remix ("Make a copy" — clone a public board into your workspace, 0168) ──
  REMIX_CLONE:             'remix_clone',                 // a shared/public board was cloned into the user's workspace {kind:'token'|'slug',n}
  REMIX_FAILED:            'remix_failed',                // remix consume failed {kind,stage,reason}

  // ── Public marketing boards (/c/<slug> + /explore, migration 0136) ──
  EXPLORE_VIEW:            'explore_view',                // /explore index mounted {count}

  // ── Tags (the ambient hover-to-explore rework — see project_tags_rework).
  //    Zero tag events existed before; this is how we finally measure whether
  //    tagging pays off. ──
  TAG_COLLECTION_OPEN:     'tag_collection_open',         // opened a tag's cross-board collection {tag_id,via:'card_chip'|'board_chip'|'hover'|'sidebar'|'doc'}
  TAG_HOVER_OPEN:          'tag_hover_open',              // a rich tag hover popover opened {tag_id,surface:'doc'|'entity_popover'}
  TAG_SEARCH:              'tag_search',                  // searched/jumped by tag {tag_id?,has_results}
  TAG_MANUAL_APPLY:        'tag_manual_apply',            // user hand-applied a tag {target_kind,via}
  TAG_CONFIRM:             'tag_confirm',                 // confirmed a borderline/auto suggestion {tag_id,target_kind}
  TAG_DISMISS:             'tag_dismiss',                 // dismissed an auto/borderline suggestion {tag_id,target_kind}
  TAG_MERGE:               'tag_merge',                   // merged one tag into another {from_tag_id,into_tag_id}
  TAG_AUTO_PROMOTE:        'tag_auto_promote',            // a recurring term was auto-promoted to a real tag {tag_id,items,boards} (Phase 4)
  TAG_CANDIDATE_PROMOTE:   'tag_candidate_promote',       // promoted a discovered prose name to a real tag {entity_type,count,anchored}
  TAG_CANDIDATE_DISMISS:   'tag_candidate_dismiss',       // dismissed a discovered prose name (workspace ignore) {count}
  TAG_SET_TYPE:            'tag_set_type',                // one-tap set/changed an entity's type {tag_id,entity_type}
});

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
