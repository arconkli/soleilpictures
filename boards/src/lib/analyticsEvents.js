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

  // ── Onboarding (first-run) ──
  ONBOARDING_VIEW:         'onboarding_view',             // first-card coachmark shown {board_id}
  ONBOARDING_SEED:         'onboarding_seed',             // starter cards seeded into the root board {n,board_id}
  ONBOARDING_FIRST_CARD:   'onboarding_first_card',       // user placed their OWN first card during onboarding (activation north-star)
  ONBOARDING_DISMISS:      'onboarding_dismiss',          // onboarding ended {reason:'placed'|'dismissed'}

  // ── First-value upgrade nudge (demo, once per account) ──
  FIRST_VALUE_UPGRADE_VIEW:   'first_value_upgrade_view',   // soft banner shown at first genuine card {board_id}
  FIRST_VALUE_UPGRADE_CTA:    'first_value_upgrade_cta',    // "See Creator" clicked → opens first-value modal (must-land) {board_id}
  FIRST_VALUE_UPGRADE_DISMISS:'first_value_upgrade_dismiss',// "Not now" clicked {board_id}

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
});

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
