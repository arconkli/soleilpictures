// The most a page drawn from a file reads (FamilyFace on a card,
// FileStages in Quick look). The public docs quote these through
// scripts/gen-docs.mjs FACTS, so a number changes here or nowhere.
export const CARD_HEAD_BYTES = 64 * 1024;
export const TEXT_STAGE_MAX_BYTES = 2 * 1024 * 1024;
export const TABLE_STAGE_MAX_ROWS = 5000;
