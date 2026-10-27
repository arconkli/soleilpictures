// The most a page drawn from a file reads (FamilyFace on a card,
// FileStages in Quick look). The public docs quote these through
// scripts/gen-docs.mjs FACTS, so a number changes here or nowhere.
export const CARD_HEAD_BYTES = 64 * 1024;
export const TEXT_STAGE_MAX_BYTES = 2 * 1024 * 1024;
export const TABLE_STAGE_MAX_ROWS = 5000;
// A very wide table shows fewer rows, so its page never holds more cells
// than a tab draws at once (never fewer than 100 rows).
export const TABLE_STAGE_MAX_CELLS = 100_000;
// The largest font a card or Quick look loads (the whole file is read to
// draw it); over it the card keeps its icon.
export const FONT_FACE_MAX_BYTES = 16 * 1024 * 1024;
// An email card reads its first 256 KB for the letter; Quick look reads the
// whole message up to 50 MB, and a card over 4 MB keeps its icon.
export const MAIL_CARD_MAX_BYTES = 4 * 1024 * 1024;
export const MAIL_HEAD_BYTES = 256 * 1024;
export const MAIL_MAX_BYTES = 50 * 1024 * 1024;
// A zip in Quick look (ZipStage.jsx): Unpack into clusters downloads the
// whole zip first, so it's offered up to 1 GB; a picture inside it is drawn
// small only when it's at most 12 MB (it's read whole to be drawn).
export const UNPACK_MAX_BYTES = 1024 ** 3;
export const ZIP_THUMB_MAX_BYTES = 12 * 1024 * 1024;
