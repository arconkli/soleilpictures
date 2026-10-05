// offerEvents — the moment someone closes an offer, announced on window.
//
// PricingModal and the over-cap import dialog dispatch it; UpgradeReasonAsk
// listens. A window event rather than a callback because the two ends live in
// different chunks and different parts of the tree, and neither should import
// the other. detail: { offer, surface, method, via, trial, dwell_ms, cards,
// server_cards, cap, tier }.
export const OFFER_DISMISSED = 'soleil:offer-dismissed';
