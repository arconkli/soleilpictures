// editorLimit.js — the 10-editor limit on Free and Creator (0520/0521), as the
// app reads it. A personal account can have at most EDITOR_LIMIT people who
// can edit, counted across every workspace it owns. A door that would add one
// more refuses with one of the hints below; an edit link lets the person in as
// a viewer instead. Pure, so it runs in node.

// public._editor_limit() in 0520 says the same number;
// editorLimitMigration.test.mjs reads the SQL and holds them together.
export const EDITOR_LIMIT = 10;

// _editor_refuse (0520) raises with one of these hints. The account's owner
// can make room; anyone else can ask the owner to.
export const EDITOR_LIMIT_HINT = 'editor_limit';
export const EDITOR_LIMIT_ASK_HINT = 'editor_limit_ask_owner';
