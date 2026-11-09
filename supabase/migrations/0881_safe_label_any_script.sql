-- 0881 -- _safe_label keeps the joiners and dots a name in any script needs
-- (2026-11-09).
--
-- APPLIED IN PARTS. The release applies this file with the Supabase MCP
-- apply_migration tool, which refuses a call over about 5,000 characters, and
-- one statement cannot be split across calls. So: one apply_migration call per
-- statement group, in file order, full-line "--" comments left out. Each group
-- below starts with a "-- part N" line; a group is one function with its
-- revoke, or one proof block, every one under 4,500 characters
-- (safeLabelSql.test.mjs checks). The proofs come last, after everything they
-- check.
--
-- public._safe_label (0450) is safeLabel.mjs in SQL: it cleans a workspace or
-- team name a signed-out call returns (peek_workspace_invite_link, the team
-- join preview and the team notifications). Like the old safeLabel.mjs it
--   * dropped every zero-width and joiner character, so Persian "project-s"
--     (a ZWNJ between the stem and the plural), Hindi and Bengali conjuncts
--     and emoji sequences (a family, a flag) came out broken, and
--   * folded the ideographic full stop and its look-alikes to "." everywhere,
--     so Japanese or Chinese text lost everything after U+3002, the rest being
--     taken for a web address and removed.
--
-- Now, as in safeLabel.mjs (supabase/functions/_shared/email/safeLabel.mjs):
--   * Only the first 1000 characters (after NFKC) are looked at. The result is
--     at most p_max long anyway and a cut can only shorten a domain, so no
--     result changes; it bounds the work.
--   * ZWNJ, ZWJ and VS16 survive only in place: between two letters of a
--     joining script (J), after a virama (V), or inside an emoji sequence
--     (PC, PM). Anywhere else they are still dropped, so a joiner can never
--     split a domain from the matcher (public._safe_label_scrub). All three
--     are decided in one regexp_replace, so each is judged by its neighbours
--     in the text before any of them is dropped, as keepInvisible in
--     safeLabel.mjs judges them: Devanagari "bha", ZWJ, ZWNJ, "bha" loses
--     both (separate passes kept the ZWJ, its neighbour gone).
--   * A look-alike full stop is U+3002 (the ideographic full stop, which NFKC
--     also makes of the halfwidth one) or U+2027 (the hyphenation point). Not
--     U+00B7 (Catalan "l.l"), U+30FB (the katakana separator), nor the raised
--     dot, dot operator or bullet operator, which no browser takes for a dot
--     ("Paris", dot operator, "London" stays as written).
--   * A look-alike full stop becomes "." only when the character before it is
--     a letter, a number of any kind (NM: "two U+3007 then U+3002 com" folds),
--     a mark, "_", "-", or a kept ZWNJ or ZWJ (a joiner after a virama:
--     "paypal" in Devanagari ending in a virama, ZWNJ, U+3002, "com" folds),
--     and after it come optional marks and then a word that ends there (the
--     end of the text, or a character that is no letter, mark or number), the
--     word being
--       - two or more ASCII letters, any case ("com", "COM"), a sharp s
--         (U+00DF, U+1E9E) counting as two: UTS46 maps U+1E9E to "ss", and
--         transitional processing U+00DF too, so "ab", U+3002, "gla" and
--         U+1E9E is the host ab.glass (ASCII_TLD_EXTRA in safeLabel.mjs;
--         gen-idn-tlds.mjs --ascii-letters checks no other code point NFKC
--         leaves unchanged maps to ASCII letters), or
--       - one of IANA's internationalized TLDs (TX, TC), as a browser
--         reads it (see TX below): Cyrillic "rf", Greek "el", Devanagari
--         "bharat", Chinese "zhongguo", Japanese "komu" all fold after "x",
--         "paypal" or "abc".
--     So prose keeps its full stop: "Tokyo", U+3002, "zhongguo" then more Han
--     ("Tokyo. China branch office") stays, and so does "paypal", U+3002,
--     "com" then Japanese ("paypal. com de login"), while the same with a
--     real "." goes (below).
--     A TLD written in Han, Hiragana, Katakana or Hangul (TC) does not count
--     after a CJK character (CJ): there U+3002 ends a sentence, so Chinese
--     "advert-film. company" (the second word is the TLD "gongsi") and
--     "Google. China" written in Han keep their full stop, as do Japanese and
--     Chinese sentences with no TLD after the stop.
--   * The domain matcher takes one or more labels (letters, numbers, marks,
--     "_", "-", kept joiners), a dot, optional marks, then a real top-level
--     domain and an optional path. Two patterns, applied in this order:
--       - an ASCII top-level label (a sharp s counting as two letters), then
--         any letters, as before ("paypal.com" then Japanese is removed
--         whole; "ab." then U+1E9E goes);
--       - an IDN one (TX or TC), which must end the word, whatever its
--         script: "x.rf" then "abc" in Cyrillic stays, and so do numbered
--         and company names in Chinese, Japanese, Korean, Thai and Lao whose
--         word after the dot starts with a TLD ("1.gongsi jianjie" in Han,
--         "1.hanguk yeohaeng" in Hangul, Thai "M.Thai-khom", Japanese
--         "Ver.kuraudo-ban").
--     So "example.com/login", "evil.co.uk", "x.rf/path" in Cyrillic and
--     "paypal.zhongguo" in Han are removed, and Tamil, Hindi, Thai and Russian
--     initials ("A.S.Pushkin" in Cyrillic) are kept: their last label is no
--     TLD. ASCII behaves as before ("J.R.R.Tolkien" is still removed). With
--     two patterns, "a.com.rf" (rf in Cyrillic) leaves ".rf".
--   * A scheme is ASCII: [A-Za-z][A-Za-z0-9+.-]*:// and what follows.
--   * Each step runs only when the text holds what it needs: the look-alike
--     dot rule a U+3002 or U+2027, the scheme "://", www "www." in either
--     case, the ASCII domain pattern a ".", the IDN one a "." followed by a
--     character that is not ASCII (a mark after the dot is never ASCII
--     either). Each test is necessary for its pattern to match, so no result
--     changes; safeLabel.mjs runs the same tests. It keeps a name from
--     compiling patterns it cannot use: the first call on a connection (and
--     again whenever Postgres's 32-pattern cache evicts them) used to cost
--     about 100 ms compiling the TLD patterns for any name.
-- Known and accepted (inviteAbuse.test.mjs pins each in safeLabel.mjs):
--   * "Prize paypal.zhongguo" then "denglu" (login) in Han, "Prize ab.hanguk"
--     then the Korean particle "eseo", and "Prize ab.thai" then Thai "khao su
--     rabop" (log in) stay whole: a linkifier that reads hosts outside ASCII
--     takes the whole run of letters after the dot for the last label, which
--     is no real TLD. With a space after the TLD the domain goes ("Prize
--     paypal.zhongguo denglu" gives "Prize denglu"). An invisible character
--     between the TLD and the next word is dropped before the word-end check,
--     so "ab.zhongguo", U+200B, "denglu" is this same case and stays whole
--     (the email shows it without the invisible).
--   * An ASCII word after U+3002 may be a real TLD, so it folds: "Tokyo" in
--     Han, U+3002, "Tokyo"; "... U+3002 OK!"; Chinese "meeting", U+3002, "OK".
--   * "paypal", U+3002, "com" then Japanese stays while "paypal.com" then
--     Japanese goes: the U+3002 rule keeps its word-end check so a sentence
--     like "filming ended", U+3002, "Netflix" then Japanese survives.
--   * After a real dot, a word that is a whole real TLD goes even in a name:
--     Cyrillic "g.Moskva", Devanagari "Dr.Bharat Kumar" (gives "Kumar"), Thai
--     "M.Thai", Korean "2.Samsung gwanggo" (gives "gwanggo"). A space after
--     the dot keeps each.
--   * As before 0881, a label made only of symbols or emoji is not caught:
--     a snowman, ".net", and "i", a heart, ".ws" stay.
-- Everything else (NFKC, controls to spaces, www removal, the lead-in trim,
-- the cut to p_max with an ellipsis) is as in 0450. SQL cuts by code point,
-- not by grapheme; the email path cuts by grapheme.
--
-- Collation: [[:alpha:]] and the other classes follow the collation of the
-- text they run on, and a C-collated value (convert_from(), a column declared
-- collate "C") makes them ASCII-only, which would silently switch the scrub
-- off for every other script. The working value s and the generated classes
-- are declared collate "und-x-icu" (a plpgsql variable would otherwise take
-- the caller's collation), so the result never depends on it.
--
-- Classes:
--   J  Arabic, Syriac, NKo, Indic, Myanmar, Khmer, Mongolian and extensions
--      (JOINING_SCRIPTS; workspaceInviteLink.test.mjs checks this text)
--   V  the viramas (VIRAMAS)
--   MK, NM, CJ, TC, TX, PC and PM are generated, never typed, each returned
--   by its own helper (TX by two) so no statement grows past the apply limit,
--   and written as \u and \U escapes (fixed width).
--   Unicode 17.0 (node's process.versions.unicode), IANA list version
--   2026110900, cd boards first:
--     MK  every combining mark (Mn, Mc, Me), in two halves:
--           node scripts/gen-idn-tlds.mjs --marks
--     NM  every number that is not a decimal digit (Nl, No); [[:digit:]]
--         covers Nd:  node scripts/gen-idn-tlds.mjs --numbers
--     CJ  every character whose Script is Han, Hiragana, Katakana or Hangul,
--         plus U+30FC and U+3005:  node scripts/gen-idn-tlds.mjs --cjk
--     TC  the IDN TLDs in Han, Hiragana, Katakana or Hangul, TX the others
--         (in two pieces, _a and _b, one per output line), longest first. Each character is a class of every code point
--         a browser reads as it: its other case and every NFKC-stable code
--         point the IDNA (UTS46) mapping turns into it (node's
--         url.domainToUnicode), so U+1C80-U+1C85, Cyrillic rounded ve, long-
--         legged de, narrow o, wide es, tall te and three-legged te, stand in
--         for the letters they look like (no case-insensitive matching). In a
--         TLD with a letter of a joining script (J), an optional ZWNJ or ZWJ
--         sits between each two characters: the scrub keeps a joiner between
--         two such letters, and IDNA processing that deletes it still reaches
--         "x.bharat".
--           node scripts/gen-idn-tlds.mjs --tlds-cjk tlds-alpha-by-domain.txt
--           node scripts/gen-idn-tlds.mjs --tlds-other tlds-alpha-by-domain.txt
--     PC  every Extended_Pictographic code point (keepInvisible's PICTO):
--           node scripts/gen-idn-tlds.mjs --picto
--     PM  every Emoji_Modifier, the five skin tones (keepInvisible's
--         MODIFIER):  node scripts/gen-idn-tlds.mjs --emoji-modifiers
--   boards/src/lib/safeLabelSql.test.mjs checks them against node and
--   idnTlds.mjs; boards/scripts/safe-label-parity.mjs runs both copies on the
--   same rows against a local Postgres.
-- The hand-written special characters are \x escapes. In a regex \x takes
-- every hex digit after it, so each one is followed by a backslash, a dash, a
-- bracket or a quote, never a hex-looking letter. This file stays ASCII.
--
-- Replaces _safe_label in place: same signature, language, security and
-- grants. Callers (0450 peek_workspace_invite_link, 0532-0534 team RPCs, all
-- security definer) are untouched. Every helper is server-only (the 0311
-- habit) and proved so at the end.

-- part 1
-- MK, first half.
create or replace function public._safe_label_marks_a()
returns text
language sql immutable parallel safe
set search_path = ''
as $$ select '\u0300-\u036f\u0483-\u0489\u0591-\u05bd\u05bf\u05c1-\u05c2\u05c4-\u05c5\u05c7\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06dc\u06df-\u06e4\u06e7-\u06e8\u06ea-\u06ed\u0711\u0730-\u074a\u07a6-\u07b0\u07eb-\u07f3\u07fd\u0816-\u0819\u081b-\u0823\u0825-\u0827\u0829-\u082d\u0859-\u085b\u0897-\u089f\u08ca-\u08e1\u08e3-\u0903\u093a-\u093c\u093e-\u094f\u0951-\u0957\u0962-\u0963\u0981-\u0983\u09bc\u09be-\u09c4\u09c7-\u09c8\u09cb-\u09cd\u09d7\u09e2-\u09e3\u09fe\u0a01-\u0a03\u0a3c\u0a3e-\u0a42\u0a47-\u0a48\u0a4b-\u0a4d\u0a51\u0a70-\u0a71\u0a75\u0a81-\u0a83\u0abc\u0abe-\u0ac5\u0ac7-\u0ac9\u0acb-\u0acd\u0ae2-\u0ae3\u0afa-\u0aff\u0b01-\u0b03\u0b3c\u0b3e-\u0b44\u0b47-\u0b48\u0b4b-\u0b4d\u0b55-\u0b57\u0b62-\u0b63\u0b82\u0bbe-\u0bc2\u0bc6-\u0bc8\u0bca-\u0bcd\u0bd7\u0c00-\u0c04\u0c3c\u0c3e-\u0c44\u0c46-\u0c48\u0c4a-\u0c4d\u0c55-\u0c56\u0c62-\u0c63\u0c81-\u0c83\u0cbc\u0cbe-\u0cc4\u0cc6-\u0cc8\u0cca-\u0ccd\u0cd5-\u0cd6\u0ce2-\u0ce3\u0cf3\u0d00-\u0d03\u0d3b-\u0d3c\u0d3e-\u0d44\u0d46-\u0d48\u0d4a-\u0d4d\u0d57\u0d62-\u0d63\u0d81-\u0d83\u0dca\u0dcf-\u0dd4\u0dd6\u0dd8-\u0ddf\u0df2-\u0df3\u0e31\u0e34-\u0e3a\u0e47-\u0e4e\u0eb1\u0eb4-\u0ebc\u0ec8-\u0ece\u0f18-\u0f19\u0f35\u0f37\u0f39\u0f3e-\u0f3f\u0f71-\u0f84\u0f86-\u0f87\u0f8d-\u0f97\u0f99-\u0fbc\u0fc6\u102b-\u103e\u1056-\u1059\u105e-\u1060\u1062-\u1064\u1067-\u106d\u1071-\u1074\u1082-\u108d\u108f\u109a-\u109d\u135d-\u135f\u1712-\u1715\u1732-\u1734\u1752-\u1753\u1772-\u1773\u17b4-\u17d3\u17dd\u180b-\u180d\u180f\u1885-\u1886\u18a9\u1920-\u192b\u1930-\u193b\u1a17-\u1a1b\u1a55-\u1a5e\u1a60-\u1a7c\u1a7f\u1ab0-\u1add\u1ae0-\u1aeb\u1b00-\u1b04\u1b34-\u1b44\u1b6b-\u1b73\u1b80-\u1b82\u1ba1-\u1bad\u1be6-\u1bf3\u1c24-\u1c37\u1cd0-\u1cd2\u1cd4-\u1ce8\u1ced\u1cf4\u1cf7-\u1cf9\u1dc0-\u1dff\u20d0-\u20f0\u2cef-\u2cf1\u2d7f\u2de0-\u2dff\u302a-\u302f\u3099-\u309a\ua66f-\ua672\ua674-\ua67d\ua69e-\ua69f\ua6f0-\ua6f1\ua802\ua806\ua80b\ua823-\ua827\ua82c\ua880-\ua881\ua8b4-\ua8c5\ua8e0-\ua8f1\ua8ff\ua926-\ua92d\ua947-\ua953\ua980-\ua983\ua9b3-\ua9c0\ua9e5\uaa29-\uaa36\uaa43\uaa4c-\uaa4d\uaa7b-\uaa7d\uaab0\uaab2-\uaab4\uaab7-\uaab8\uaabe-\uaabf\uaac1\uaaeb-\uaaef\uaaf5-\uaaf6\uabe3-\uabea\uabec-\uabed\ufb1e\ufe00-\ufe0f\ufe20-\ufe2f\U000101fd\U000102e0\U00010376-\U0001037a\U00010a01-\U00010a03\U00010a05-\U00010a06\U00010a0c-\U00010a0f\U00010a38-\U00010a3a\U00010a3f\U00010ae5-\U00010ae6\U00010d24-\U00010d27\U00010d69-\U00010d6d'::text $$;

revoke execute on function public._safe_label_marks_a() from public, anon, authenticated;

-- part 2
-- MK, second half.
create or replace function public._safe_label_marks_b()
returns text
language sql immutable parallel safe
set search_path = ''
as $$ select '\U00010eab-\U00010eac\U00010efa-\U00010eff\U00010f46-\U00010f50\U00010f82-\U00010f85\U00011000-\U00011002\U00011038-\U00011046\U00011070\U00011073-\U00011074\U0001107f-\U00011082\U000110b0-\U000110ba\U000110c2\U00011100-\U00011102\U00011127-\U00011134\U00011145-\U00011146\U00011173\U00011180-\U00011182\U000111b3-\U000111c0\U000111c9-\U000111cc\U000111ce-\U000111cf\U0001122c-\U00011237\U0001123e\U00011241\U000112df-\U000112ea\U00011300-\U00011303\U0001133b-\U0001133c\U0001133e-\U00011344\U00011347-\U00011348\U0001134b-\U0001134d\U00011357\U00011362-\U00011363\U00011366-\U0001136c\U00011370-\U00011374\U000113b8-\U000113c0\U000113c2\U000113c5\U000113c7-\U000113ca\U000113cc-\U000113d0\U000113d2\U000113e1-\U000113e2\U00011435-\U00011446\U0001145e\U000114b0-\U000114c3\U000115af-\U000115b5\U000115b8-\U000115c0\U000115dc-\U000115dd\U00011630-\U00011640\U000116ab-\U000116b7\U0001171d-\U0001172b\U0001182c-\U0001183a\U00011930-\U00011935\U00011937-\U00011938\U0001193b-\U0001193e\U00011940\U00011942-\U00011943\U000119d1-\U000119d7\U000119da-\U000119e0\U000119e4\U00011a01-\U00011a0a\U00011a33-\U00011a39\U00011a3b-\U00011a3e\U00011a47\U00011a51-\U00011a5b\U00011a8a-\U00011a99\U00011b60-\U00011b67\U00011c2f-\U00011c36\U00011c38-\U00011c3f\U00011c92-\U00011ca7\U00011ca9-\U00011cb6\U00011d31-\U00011d36\U00011d3a\U00011d3c-\U00011d3d\U00011d3f-\U00011d45\U00011d47\U00011d8a-\U00011d8e\U00011d90-\U00011d91\U00011d93-\U00011d97\U00011ef3-\U00011ef6\U00011f00-\U00011f01\U00011f03\U00011f34-\U00011f3a\U00011f3e-\U00011f42\U00011f5a\U00013440\U00013447-\U00013455\U0001611e-\U0001612f\U00016af0-\U00016af4\U00016b30-\U00016b36\U00016f4f\U00016f51-\U00016f87\U00016f8f-\U00016f92\U00016fe4\U00016ff0-\U00016ff1\U0001bc9d-\U0001bc9e\U0001cf00-\U0001cf2d\U0001cf30-\U0001cf46\U0001d165-\U0001d169\U0001d16d-\U0001d172\U0001d17b-\U0001d182\U0001d185-\U0001d18b\U0001d1aa-\U0001d1ad\U0001d242-\U0001d244\U0001da00-\U0001da36\U0001da3b-\U0001da6c\U0001da75\U0001da84\U0001da9b-\U0001da9f\U0001daa1-\U0001daaf\U0001e000-\U0001e006\U0001e008-\U0001e018\U0001e01b-\U0001e021\U0001e023-\U0001e024\U0001e026-\U0001e02a\U0001e08f\U0001e130-\U0001e136\U0001e2ae\U0001e2ec-\U0001e2ef\U0001e4ec-\U0001e4ef\U0001e5ee-\U0001e5ef\U0001e6e3\U0001e6e6\U0001e6ee-\U0001e6ef\U0001e6f5\U0001e8d0-\U0001e8d6\U0001e944-\U0001e94a\U000e0100-\U000e01ef'::text $$;

revoke execute on function public._safe_label_marks_b() from public, anon, authenticated;

-- part 3
-- NM.
create or replace function public._safe_label_numbers()
returns text
language sql immutable parallel safe
set search_path = ''
as $$ select '\u00b2-\u00b3\u00b9\u00bc-\u00be\u09f4-\u09f9\u0b72-\u0b77\u0bf0-\u0bf2\u0c78-\u0c7e\u0d58-\u0d5e\u0d70-\u0d78\u0f2a-\u0f33\u1369-\u137c\u16ee-\u16f0\u17f0-\u17f9\u19da\u2070\u2074-\u2079\u2080-\u2089\u2150-\u2182\u2185-\u2189\u2460-\u249b\u24ea-\u24ff\u2776-\u2793\u2cfd\u3007\u3021-\u3029\u3038-\u303a\u3192-\u3195\u3220-\u3229\u3248-\u324f\u3251-\u325f\u3280-\u3289\u32b1-\u32bf\ua6e6-\ua6ef\ua830-\ua835\U00010107-\U00010133\U00010140-\U00010178\U0001018a-\U0001018b\U000102e1-\U000102fb\U00010320-\U00010323\U00010341\U0001034a\U000103d1-\U000103d5\U00010858-\U0001085f\U00010879-\U0001087f\U000108a7-\U000108af\U000108fb-\U000108ff\U00010916-\U0001091b\U000109bc-\U000109bd\U000109c0-\U000109cf\U000109d2-\U000109ff\U00010a40-\U00010a48\U00010a7d-\U00010a7e\U00010a9d-\U00010a9f\U00010aeb-\U00010aef\U00010b58-\U00010b5f\U00010b78-\U00010b7f\U00010ba9-\U00010baf\U00010cfa-\U00010cff\U00010e60-\U00010e7e\U00010f1d-\U00010f26\U00010f51-\U00010f54\U00010fc5-\U00010fcb\U00011052-\U00011065\U000111e1-\U000111f4\U0001173a-\U0001173b\U000118ea-\U000118f2\U00011c5a-\U00011c6c\U00011fc0-\U00011fd4\U00012400-\U0001246e\U00016b5b-\U00016b61\U00016e80-\U00016e96\U00016ff4-\U00016ff6\U0001d2c0-\U0001d2d3\U0001d2e0-\U0001d2f3\U0001d360-\U0001d378\U0001e8c7-\U0001e8cf\U0001ec71-\U0001ecab\U0001ecad-\U0001ecaf\U0001ecb1-\U0001ecb4\U0001ed01-\U0001ed2d\U0001ed2f-\U0001ed3d\U0001f100-\U0001f10c'::text $$;

revoke execute on function public._safe_label_numbers() from public, anon, authenticated;

-- part 4
-- CJ.
create or replace function public._safe_label_cjk()
returns text
language sql immutable parallel safe
set search_path = ''
as $$ select '\u1100-\u11ff\u2e80-\u2e99\u2e9b-\u2ef3\u2f00-\u2fd5\u3005\u3007\u3021-\u3029\u302e-\u302f\u3038-\u303b\u3041-\u3096\u309d-\u309f\u30a1-\u30fa\u30fc-\u30ff\u3131-\u318e\u31f0-\u321e\u3260-\u327e\u32d0-\u32fe\u3300-\u3357\u3400-\u4dbf\u4e00-\u9fff\ua960-\ua97c\uac00-\ud7a3\ud7b0-\ud7c6\ud7cb-\ud7fb\uf900-\ufa6d\ufa70-\ufad9\uff66-\uff6f\uff71-\uff9d\uffa0-\uffbe\uffc2-\uffc7\uffca-\uffcf\uffd2-\uffd7\uffda-\uffdc\U00016fe2-\U00016fe3\U00016ff0-\U00016ff6\U0001aff0-\U0001aff3\U0001aff5-\U0001affb\U0001affd-\U0001affe\U0001b000-\U0001b122\U0001b132\U0001b150-\U0001b152\U0001b155\U0001b164-\U0001b167\U0001f200\U00020000-\U0002a6df\U0002a700-\U0002b81d\U0002b820-\U0002cead\U0002ceb0-\U0002ebe0\U0002ebf0-\U0002ee5d\U0002f800-\U0002fa1d\U00030000-\U0003134a\U00031350-\U00033479'::text $$;

revoke execute on function public._safe_label_cjk() from public, anon, authenticated;

-- part 5
-- TC.
create or replace function public._safe_label_tlds_cjk()
returns text
language sql immutable parallel safe
set search_path = ''
as $$ select '\u30d5\u30a1\u30c3\u30b7\u30e7\u30f3|\u5609\u91cc\u5927\u9152\u5e97|\u30a2\u30de\u30be\u30f3|\u30af\u30e9\u30a6\u30c9|\u30b0\u30fc\u30b0\u30eb|\u30dd\u30a4\u30f3\u30c8|\u7ec4\u7ec7\u673a\u6784|\u96fb\u8a0a\u76c8\u79d1|\u9999\u683c\u91cc\u62c9|\u307f\u3093\u306a|\u30b9\u30c8\u30a2|\u30bb\u30fc\u30eb|\u4e2d\u6587\u7f51|\u4e9a\u9a6c\u900a|\u5929\u4e3b\u6559|\u6211\u7231\u4f60|\u65b0\u52a0\u5761|\u6de1\u9a6c\u9521|\u98de\u5229\u6d66|\u30b3\u30e0|\u4e16\u754c|\u4e2d\u4fe1|\u4e2d\u56fd|\u4e2d\u570b|\u4f01\u4e1a|\u4f5b\u5c71|\u4fe1\u606f|\u5065\u5eb7|\u516b\u5366|\u516c\u53f8|\u516c\u76ca|\u53f0\u6e7e|\u53f0\u7063|\u5546\u57ce|\u5546\u5e97|\u5546\u6807|\u5609\u91cc|\u5728\u7ebf|\u5927\u62ff|\u5a31\u4e50|\u5bb6\u96fb|\u5e7f\u4e1c|\u5fae\u535a|\u6148\u5584|\u624b\u673a|\u62db\u8058|\u653f\u52a1|\u653f\u5e9c|\u65b0\u95fb|\u65f6\u5c1a|\u66f8\u7c4d|\u673a\u6784|\u6e38\u620f|\u6fb3\u9580|\u70b9\u770b|\u79fb\u52a8|\u7f51\u5740|\u7f51\u5e97|\u7f51\u7ad9|\u7f51\u7edc|\u8054\u901a|\u8c37\u6b4c|\u8d2d\u7269|\u901a\u8ca9|\u96c6\u56e2|\u98df\u54c1|\u9910\u5385|\u9999\u6e2f|\ub2f7\ub137|\ub2f7\ucef4|\uc0bc\uc131|\ud55c\uad6d'::text $$;

revoke execute on function public._safe_label_tlds_cjk() from public, anon, authenticated;

-- part 6
-- TX, first piece.
create or replace function public._safe_label_tlds_other_a()
returns text
language sql immutable parallel safe
set search_path = ''
as $$ select '[vV][eE][rR][mM][\u00f6\u00d6][gG][eE][nN][sS][bB][eE][rR][aA][tT][uU][nN][gG]|[vV][eE][rR][mM][\u00f6\u00d6][gG][eE][nN][sS][bB][eE][rR][aA][tT][eE][rR]|\u0b9a[\u200c\u200d]?\u0bbf[\u200c\u200d]?\u0b99[\u200c\u200d]?\u0bcd[\u200c\u200d]?\u0b95[\u200c\u200d]?\u0baa[\u200c\u200d]?\u0bcd[\u200c\u200d]?\u0baa[\u200c\u200d]?\u0bc2[\u200c\u200d]?\u0bb0[\u200c\u200d]?\u0bcd|\u0645[\u200c\u200d]?\u0648[\u200c\u200d]?\u0631[\u200c\u200d]?\u064a[\u200c\u200d]?\u062a[\u200c\u200d]?\u0627[\u200c\u200d]?\u0646[\u200c\u200d]?\u064a[\u200c\u200d]?\u0627|\u0627[\u200c\u200d]?\u0644[\u200c\u200d]?\u0633[\u200c\u200d]?\u0639[\u200c\u200d]?\u0648[\u200c\u200d]?\u062f[\u200c\u200d]?\u064a[\u200c\u200d]?\u0629|[\u043a\u041a][\u0430\u0410][\u0442\u0422\u1c84\u1c85][\u043e\u041e\u1c82][\u043b\u041b][\u0438\u0418][\u043a\u041a]|\u0627[\u200c\u200d]?\u0644[\u200c\u200d]?\u0628[\u200c\u200d]?\u062d[\u200c\u200d]?\u0631[\u200c\u200d]?\u064a[\u200c\u200d]?\u0646|\u0627[\u200c\u200d]?\u0644[\u200c\u200d]?\u062c[\u200c\u200d]?\u0632[\u200c\u200d]?\u0627[\u200c\u200d]?\u0626[\u200c\u200d]?\u0631|\u0627[\u200c\u200d]?\u0644[\u200c\u200d]?\u0639[\u200c\u200d]?\u0644[\u200c\u200d]?\u064a[\u200c\u200d]?\u0627[\u200c\u200d]?\u0646|\u0643[\u200c\u200d]?\u0627[\u200c\u200d]?\u062b[\u200c\u200d]?\u0648[\u200c\u200d]?\u0644[\u200c\u200d]?\u064a[\u200c\u200d]?\u0643|\u067e[\u200c\u200d]?\u0627[\u200c\u200d]?\u06a9[\u200c\u200d]?\u0633[\u200c\u200d]?\u062a[\u200c\u200d]?\u0627[\u200c\u200d]?\u0646|\u0b87[\u200c\u200d]?\u0ba8[\u200c\u200d]?\u0bcd[\u200c\u200d]?\u0ba4[\u200c\u200d]?\u0bbf[\u200c\u200d]?\u0baf[\u200c\u200d]?\u0bbe|[\u043c\u041c][\u043e\u041e\u1c82][\u0441\u0421\u1c83][\u043a\u041a][\u0432\u0412\u1c80][\u0430\u0410]|[\u043e\u041e\u1c82][\u043d\u041d][\u043b\u041b][\u0430\u0410][\u0439\u0419][\u043d\u041d]|\u0627[\u200c\u200d]?\u0628[\u200c\u200d]?\u0648[\u200c\u200d]?\u0638[\u200c\u200d]?\u0628[\u200c\u200d]?\u064a|\u0627[\u200c\u200d]?\u0631[\u200c\u200d]?\u0627[\u200c\u200d]?\u0645[\u200c\u200d]?\u0643[\u200c\u200d]?\u0648|\u0627[\u200c\u200d]?\u0644[\u200c\u200d]?\u0627[\u200c\u200d]?\u0631[\u200c\u200d]?\u062f[\u200c\u200d]?\u0646|\u0627[\u200c\u200d]?\u0644[\u200c\u200d]?\u0645[\u200c\u200d]?\u063a[\u200c\u200d]?\u0631[\u200c\u200d]?\u0628|\u0627[\u200c\u200d]?\u0645[\u200c\u200d]?\u0627[\u200c\u200d]?\u0631[\u200c\u200d]?\u0627[\u200c\u200d]?\u062a|\u0641[\u200c\u200d]?\u0644[\u200c\u200d]?\u0633[\u200c\u200d]?\u0637[\u200c\u200d]?\u064a[\u200c\u200d]?\u0646|\u0645[\u200c\u200d]?\u0644[\u200c\u200d]?\u064a[\u200c\u200d]?\u0633[\u200c\u200d]?\u064a[\u200c\u200d]?\u0627|\u092d[\u200c\u200d]?\u093e[\u200c\u200d]?\u0930[\u200c\u200d]?\u0924[\u200c\u200d]?\u092e[\u200c\u200d]?\u094d|\u0b87[\u200c\u200d]?\u0bb2[\u200c\u200d]?\u0b99[\u200c\u200d]?\u0bcd[\u200c\u200d]?\u0b95[\u200c\u200d]?\u0bc8|\u05d9\u05e9\u05e8\u05d0\u05dc|\u0627[\u200c\u200d]?\u06cc[\u200c\u200d]?\u0631[\u200c\u200d]?\u0627[\u200c\u200d]?\u0646|\u0628[\u200c\u200d]?\u0627[\u200c\u200d]?\u0632[\u200c\u200d]?\u0627[\u200c\u200d]?\u0631|\u0628[\u200c\u200d]?\u06be[\u200c\u200d]?\u0627[\u200c\u200d]?\u0631[\u200c\u200d]?\u062a|\u0633[\u200c\u200d]?\u0648[\u200c\u200d]?\u062f[\u200c\u200d]?\u0627[\u200c\u200d]?\u0646|\u0633[\u200c\u200d]?\u0648[\u200c\u200d]?\u0631[\u200c\u200d]?\u064a[\u200c\u200d]?\u0629|\u0647[\u200c\u200d]?\u0645[\u200c\u200d]?\u0631[\u200c\u200d]?\u0627[\u200c\u200d]?\u0647|\u092d[\u200c\u200d]?\u093e[\u200c\u200d]?\u0930[\u200c\u200d]?\u094b[\u200c\u200d]?\u0924|\u0938[\u200c\u200d]?\u0902[\u200c\u200d]?\u0917[\u200c\u200d]?\u0920[\u200c\u200d]?\u0928'::text $$;

revoke execute on function public._safe_label_tlds_other_a() from public, anon, authenticated;

-- part 7
-- TX, second piece.
create or replace function public._safe_label_tlds_other_b()
returns text
language sql immutable parallel safe
set search_path = ''
as $$ select '\u09ac[\u200c\u200d]?\u09be[\u200c\u200d]?\u0982[\u200c\u200d]?\u09b2[\u200c\u200d]?\u09be|\u0c2d[\u200c\u200d]?\u0c3e[\u200c\u200d]?\u0c30[\u200c\u200d]?\u0c24[\u200c\u200d]?\u0c4d|\u0d2d[\u200c\u200d]?\u0d3e[\u200c\u200d]?\u0d30[\u200c\u200d]?\u0d24[\u200c\u200d]?\u0d02|[\u0434\u0414\u1c81][\u0435\u0415][\u0442\u0422\u1c84\u1c85][\u0438\u0418]|[\u0441\u0421\u1c83][\u0430\u0410][\u0439\u0419][\u0442\u0422\u1c84\u1c85]|\u0628[\u200c\u200d]?\u0627[\u200c\u200d]?\u0631[\u200c\u200d]?\u062a|\u0628[\u200c\u200d]?\u064a[\u200c\u200d]?\u062a[\u200c\u200d]?\u0643|\u062a[\u200c\u200d]?\u0648[\u200c\u200d]?\u0646[\u200c\u200d]?\u0633|\u0634[\u200c\u200d]?\u0628[\u200c\u200d]?\u0643[\u200c\u200d]?\u0629|\u0639[\u200c\u200d]?\u0631[\u200c\u200d]?\u0627[\u200c\u200d]?\u0642|\u0639[\u200c\u200d]?\u0645[\u200c\u200d]?\u0627[\u200c\u200d]?\u0646|\u0645[\u200c\u200d]?\u0648[\u200c\u200d]?\u0642[\u200c\u200d]?\u0639|\u0680[\u200c\u200d]?\u0627[\u200c\u200d]?\u0631[\u200c\u200d]?\u062a|\u092d[\u200c\u200d]?\u093e[\u200c\u200d]?\u0930[\u200c\u200d]?\u0924|\u09ad[\u200c\u200d]?\u09be[\u200c\u200d]?\u09b0[\u200c\u200d]?\u09a4|\u09ad[\u200c\u200d]?\u09be[\u200c\u200d]?\u09f0[\u200c\u200d]?\u09a4|\u0a2d[\u200c\u200d]?\u0a3e[\u200c\u200d]?\u0a30[\u200c\u200d]?\u0a24|\u0aad[\u200c\u200d]?\u0abe[\u200c\u200d]?\u0ab0[\u200c\u200d]?\u0aa4|\u0b2d[\u200c\u200d]?\u0b3e[\u200c\u200d]?\u0b30[\u200c\u200d]?\u0b24|\u0cad[\u200c\u200d]?\u0cbe[\u200c\u200d]?\u0cb0[\u200c\u200d]?\u0ca4|\u0dbd[\u200c\u200d]?\u0d82[\u200c\u200d]?\u0d9a[\u200c\u200d]?\u0dcf|[\u0431\u0411][\u0435\u0415][\u043b\u041b]|[\u043a\u041a][\u043e\u041e\u1c82][\u043c\u041c]|[\u043c\u041c][\u043a\u041a][\u0434\u0414\u1c81]|[\u043c\u041c][\u043e\u041e\u1c82][\u043d\u041d]|[\u043e\u041e\u1c82][\u0440\u0420][\u0433\u0413]|[\u0440\u0420][\u0443\u0423][\u0441\u0421\u1c83]|[\u0441\u0421\u1c83][\u0440\u0420][\u0431\u0411]|[\u0443\u0423][\u043a\u041a][\u0440\u0420]|[\u049b\u049a][\u0430\u0410][\u0437\u0417]|[\u0570\u0540][\u0561\u0531][\u0575\u0545]|\u05e7\u05d5\u05dd|\u0639[\u200c\u200d]?\u0631[\u200c\u200d]?\u0628|\u0642[\u200c\u200d]?\u0637[\u200c\u200d]?\u0631|\u0643[\u200c\u200d]?\u0648[\u200c\u200d]?\u0645|\u0645[\u200c\u200d]?\u0635[\u200c\u200d]?\u0631|\u0915[\u200c\u200d]?\u0949[\u200c\u200d]?\u092e|\u0928[\u200c\u200d]?\u0947[\u200c\u200d]?\u091f|\u0e04\u0e2d\u0e21|\u0e44\u0e17\u0e22|\u0ea5\u0eb2\u0ea7|[\u03b5\u0395][\u03bb\u039b]|[\u03b5\u0395][\u03c5\u03a5]|[\u0431\u0411][\u0433\u0413]|[\u0435\u0415][\u044e\u042e]|[\u0440\u0420][\u0444\u0424]|[\u10d2\u1c92][\u10d4\u1c94]'::text $$;

revoke execute on function public._safe_label_tlds_other_b() from public, anon, authenticated;

-- part 8
-- PC.
create or replace function public._safe_label_picto()
returns text
language sql immutable parallel safe
set search_path = ''
as $$ select '\u00a9\u00ae\u203c\u2049\u2122\u2139\u2194-\u2199\u21a9-\u21aa\u231a-\u231b\u2328\u23cf\u23e9-\u23f3\u23f8-\u23fa\u24c2\u25aa-\u25ab\u25b6\u25c0\u25fb-\u25fe\u2600-\u2604\u260e\u2611\u2614-\u2615\u2618\u261d\u2620\u2622-\u2623\u2626\u262a\u262e-\u262f\u2638-\u263a\u2640\u2642\u2648-\u2653\u265f-\u2660\u2663\u2665-\u2666\u2668\u267b\u267e-\u267f\u2692-\u2697\u2699\u269b-\u269c\u26a0-\u26a1\u26a7\u26aa-\u26ab\u26b0-\u26b1\u26bd-\u26be\u26c4-\u26c5\u26c8\u26ce-\u26cf\u26d1\u26d3-\u26d4\u26e9-\u26ea\u26f0-\u26f5\u26f7-\u26fa\u26fd\u2702\u2705\u2708-\u270d\u270f\u2712\u2714\u2716\u271d\u2721\u2728\u2733-\u2734\u2744\u2747\u274c\u274e\u2753-\u2755\u2757\u2763-\u2764\u2795-\u2797\u27a1\u27b0\u27bf\u2934-\u2935\u2b05-\u2b07\u2b1b-\u2b1c\u2b50\u2b55\u3030\u303d\u3297\u3299\U0001f004\U0001f02c-\U0001f02f\U0001f094-\U0001f09f\U0001f0af-\U0001f0b0\U0001f0c0\U0001f0cf-\U0001f0d0\U0001f0f6-\U0001f0ff\U0001f170-\U0001f171\U0001f17e-\U0001f17f\U0001f18e\U0001f191-\U0001f19a\U0001f1ae-\U0001f1e5\U0001f201-\U0001f20f\U0001f21a\U0001f22f\U0001f232-\U0001f23a\U0001f23c-\U0001f23f\U0001f249-\U0001f25f\U0001f266-\U0001f321\U0001f324-\U0001f393\U0001f396-\U0001f397\U0001f399-\U0001f39b\U0001f39e-\U0001f3f0\U0001f3f3-\U0001f3f5\U0001f3f7-\U0001f3fa\U0001f400-\U0001f4fd\U0001f4ff-\U0001f53d\U0001f549-\U0001f54e\U0001f550-\U0001f567\U0001f56f-\U0001f570\U0001f573-\U0001f57a\U0001f587\U0001f58a-\U0001f58d\U0001f590\U0001f595-\U0001f596\U0001f5a4-\U0001f5a5\U0001f5a8\U0001f5b1-\U0001f5b2\U0001f5bc\U0001f5c2-\U0001f5c4\U0001f5d1-\U0001f5d3\U0001f5dc-\U0001f5de\U0001f5e1\U0001f5e3\U0001f5e8\U0001f5ef\U0001f5f3\U0001f5fa-\U0001f64f\U0001f680-\U0001f6c5\U0001f6cb-\U0001f6d2\U0001f6d5-\U0001f6e5\U0001f6e9\U0001f6eb-\U0001f6f0\U0001f6f3-\U0001f6ff\U0001f7da-\U0001f7ff\U0001f80c-\U0001f80f\U0001f848-\U0001f84f\U0001f85a-\U0001f85f\U0001f888-\U0001f88f\U0001f8ae-\U0001f8af\U0001f8bc-\U0001f8bf\U0001f8c2-\U0001f8cf\U0001f8d9-\U0001f8ff\U0001f90c-\U0001f93a\U0001f93c-\U0001f945\U0001f947-\U0001f9ff\U0001fa58-\U0001fa5f\U0001fa6e-\U0001faff\U0001fc00-\U0001fffd'::text $$;

revoke execute on function public._safe_label_picto() from public, anon, authenticated;

-- part 9
-- PM.
create or replace function public._safe_label_modifiers()
returns text
language sql immutable parallel safe
set search_path = ''
as $$ select '\U0001f3fb-\U0001f3ff'::text $$;

revoke execute on function public._safe_label_modifiers() from public, anon, authenticated;

-- part 10
-- Drops invisible characters, keeps ZWNJ, ZWJ and VS16 only in place, and
-- turns controls into spaces.
create or replace function public._safe_label_scrub(p_value text)
returns text
language plpgsql immutable parallel safe
set search_path = public as $$
declare
  s text collate "und-x-icu" := p_value;
  -- J and V (see the header), each a bracket expression.
  j constant text collate "und-x-icu" := '[\x0600-\x06ff\x0700-\x074f\x0750-\x077f\x07c0-\x07ff\x0870-\x08ff\x0900-\x0dff\x1000-\x109f\x1780-\x17ff\x1800-\x18af\x1cd0-\x1cff\xa8e0-\xa8ff\xa9e0-\xa9ff\xaa60-\xaa7f\xfb50-\xfdff\xfe70-\xfefc]';
  v constant text collate "und-x-icu" := '[\x094d\x09cd\x0a4d\x0acd\x0b4d\x0bcd\x0c4d\x0ccd\x0d4d\x0dca\x1039\x103a\x17d2]';
  -- PICTO and PICTO or MODIFIER (keepInvisible's two sets), from PC and PM.
  pc text collate "und-x-icu";
  pm text collate "und-x-icu";
begin
  -- Invisible characters, except ZWNJ (200c), ZWJ (200d) and VS16 (fe0f).
  s := regexp_replace(s, '[\xad\x34f\x61c\x115f\x1160\x17b4\x17b5\x180b-\x180f\x200b\x200e\x200f\x202a-\x202e\x2060-\x206f\x3164\xfe00-\xfe0e\xfeff\xffa0\xfff0-\xfff8\x1bca0-\x1bca3\x1d173-\x1d17a\xe0000-\xe0fff]', '', 'g');
  -- ZWNJ, ZWJ and VS16 that are not in place, in ONE pass: the lookarounds
  -- see this text before any of them is dropped, so each is judged by its
  -- own neighbours (keepInvisible in safeLabel.mjs). A ZWNJ stays between two
  -- J letters or after a V. A ZWJ stays there too, or after a PICTO or a
  -- MODIFIER (pm), or a PICTO and VS16, when a PICTO (pc) follows. A VS16
  -- stays after a PICTO, or between a keycap base and U+20E3. Only when the
  -- text holds one of the three, so an ordinary name never compiles PC.
  if strpos(s, chr(8204)) > 0 or strpos(s, chr(8205)) > 0 or strpos(s, chr(65039)) > 0 then
    pc := '[' || public._safe_label_picto() || ']';
    pm := '[' || public._safe_label_picto() || public._safe_label_modifiers() || ']';
    s := regexp_replace(s,
      '(?<!' || j || ')\x200c|(?<!' || v || ')\x200c(?!' || j || ')'
      || '|(?<!' || j || ')(?<!' || pm || ')(?<!' || pc || '\xfe0f)\x200d'
      || '|(?<!' || j || ')\x200d(?!' || pc || ')'
      || '|(?<!' || v || ')(?<!' || pm || ')(?<!' || pc || '\xfe0f)\x200d(?!' || j || ')'
      || '|(?<!' || v || ')\x200d(?!' || j || ')(?!' || pc || ')'
      || '|(?<!' || pc || ')(?<![0-9#*])\xfe0f|(?<!' || pc || ')\xfe0f(?!\x20e3)', '', 'g');
  end if;
  s := regexp_replace(s, '[\x01-\x1f\x7f-\x9f\x2028\x2029]', ' ', 'g');
  return s;
end;
$$;

revoke execute on function public._safe_label_scrub(text) from public, anon, authenticated;

-- part 11
create or replace function public._safe_label(p_value text, p_max integer default 60, p_fallback text default '')
returns text
language plpgsql immutable
set search_path = public as $$
declare
  -- Generated (see the header).
  mk constant text collate "und-x-icu" := public._safe_label_marks_a() || public._safe_label_marks_b();
  nm constant text collate "und-x-icu" := public._safe_label_numbers();
  cj constant text collate "und-x-icu" := public._safe_label_cjk();
  tc constant text collate "und-x-icu" := public._safe_label_tlds_cjk();
  tx constant text collate "und-x-icu" := public._safe_label_tlds_other_a() || '|' || public._safe_label_tlds_other_b();
  -- The first 1000 characters after NFKC.
  s text collate "und-x-icu" := left(normalize(coalesce(p_value, ''), NFKC), 1000);
  n integer := greatest(coalesce(p_max, 60), 1);
  -- The start of an ASCII top-level label: two ASCII letters, or a sharp s
  -- (U+00DF, U+1E9E), "ss" in a host.
  a constant text collate "und-x-icu" := '(?:[A-Za-z][A-Za-z\xdf\x1e9e]|[\xdf\x1e9e])';
  -- A word ends here: no letter, number or mark follows.
  e text collate "und-x-icu" := '(?![[:alpha:][:digit:]' || nm || mk || '])';
  -- A label character.
  l text collate "und-x-icu" := '[[:alnum:]' || nm || '_\x200c\x200d' || mk || '-]';
  -- Labels, a dot and marks: what comes before a top-level domain.
  h text collate "und-x-icu";
begin
  s := public._safe_label_scrub(s);
  -- Each step runs only when the text holds what it needs (no result changes;
  -- safeLabel.mjs does the same), so a name compiles only the patterns it
  -- can use. A look-alike full stop is a dot before ASCII letters or a TX
  -- entry, or a TC entry when no CJ character sits before it.
  if strpos(s, chr(12290)) > 0 or strpos(s, chr(8231)) > 0 then
    s := regexp_replace(s, '(?<=[[:alpha:][:digit:]' || nm || mk || '_\x200c\x200d-])[\x3002\x2027](?:(?=[' || mk || ']*(?:' || a || '[A-Za-z\xdf\x1e9e]*|' || tx || ')' || e || ')|(?<![' || cj || '][\x3002\x2027])(?=[' || mk || ']*(?:' || tc || ')' || e || '))', '.', 'g');
  end if;
  if strpos(s, '://') > 0 then
    s := regexp_replace(s, '[A-Za-z][A-Za-z0-9+.-]*://\S*', ' ', 'g');
  end if;
  if strpos(translate(s, 'W', 'w'), 'www.') > 0 then
    s := regexp_replace(s, 'www\.\S*', ' ', 'gi');
  end if;
  h := '[[:alnum:]' || nm || ']' || l || '*(?:\.' || l || '+)*\.[' || mk || ']*';
  -- An ASCII top-level label, then any letters, and a path.
  if strpos(s, '.') > 0 then
    s := regexp_replace(s, h || a || '[[:alpha:]' || mk || ']*(?:[/?#]\S*)?', ' ', 'g');
  end if;
  -- An IDN one, which must end the word.
  if s ~ '\.[^\x01-\x7f]' then
    s := regexp_replace(s, h || '(?:' || tx || '|' || tc || ')' || e || '(?:[/?#]\S*)?', ' ', 'g');
  end if;
  s := btrim(regexp_replace(s, '\s+', ' ', 'g'));
  s := btrim(regexp_replace(s, '[\s:;,\x2013\x2014-]+$', ''));
  if s = '' then
    return p_fallback;
  end if;
  if char_length(s) > n then
    s := rtrim(left(s, greatest(1, n - 1))) || chr(8230);
  end if;
  return s;
end;
$$;

revoke execute on function public._safe_label(text, integer, text) from public, anon, authenticated;

-- part 12
-- Proofs (the 0311 habit: a REVOKE reporting success proves nothing).
do $$
declare
  f text;
begin
  foreach f in array array['public._safe_label(text,integer,text)', 'public._safe_label_scrub(text)',
      'public._safe_label_marks_a()', 'public._safe_label_marks_b()', 'public._safe_label_numbers()',
      'public._safe_label_cjk()', 'public._safe_label_tlds_cjk()', 'public._safe_label_tlds_other_a()', 'public._safe_label_tlds_other_b()',
      'public._safe_label_picto()', 'public._safe_label_modifiers()'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception '0881: % is client-executable', f;
    end if;
  end loop;
end;
$$;

-- part 13
do $$
begin
  -- What 0450 proved still holds.
  if public._safe_label('Verify now at https://secure-login.example/x or www.evil.example', 60, '')
     ~* '(https?:|www\.|\.example)' then
    raise exception '0881: _safe_label kept a link';
  end if;
  if public._safe_label('evil' || chr(8203) || '.example login', 60, '') <> 'login' then
    raise exception '0881: _safe_label let an invisible character split a domain';
  end if;
  if public._safe_label('Lost Time', 60, '') <> 'Lost Time'
     or char_length(public._safe_label(repeat('x', 100), 60, '')) <> 60 then
    raise exception '0881: _safe_label changed a plain name or missed the length';
  end if;

  -- A Persian word with its ZWNJ is kept.
  if public._safe_label(chr(1605) || chr(1740) || chr(8204) || chr(1582) || chr(1608) || chr(1575) || chr(1607) || chr(1605), 60, '')
     <> chr(1605) || chr(1740) || chr(8204) || chr(1582) || chr(1608) || chr(1575) || chr(1607) || chr(1605) then
    raise exception '0881: _safe_label dropped a Persian ZWNJ';
  end if;
  -- A Hindi conjunct with its ZWJ is kept.
  if public._safe_label(chr(2325) || chr(2381) || chr(8205) || chr(2359), 60, '')
     <> chr(2325) || chr(2381) || chr(8205) || chr(2359) then
    raise exception '0881: _safe_label dropped a Hindi ZWJ';
  end if;
  -- A family emoji is kept whole.
  if public._safe_label(chr(128104) || chr(8205) || chr(128105) || chr(8205) || chr(128103) || ' Family', 60, '')
     <> chr(128104) || chr(8205) || chr(128105) || chr(8205) || chr(128103) || ' Family' then
    raise exception '0881: _safe_label broke a family emoji';
  end if;
  -- A lure through an ideographic full stop, or a joiner, is still removed.
  if public._safe_label('Prize paypal' || chr(12290) || 'com', 60, '') <> 'Prize' then
    raise exception '0881: _safe_label kept a domain written with an ideographic full stop';
  end if;
  if public._safe_label('pay' || chr(8205) || 'pal.com login', 60, '') <> 'login' then
    raise exception '0881: _safe_label let a ZWJ split a domain';
  end if;
  -- A joiner between Latin letters is dropped.
  if public._safe_label('Lost' || chr(8205) || 'Time', 60, '') <> 'LostTime' then
    raise exception '0881: _safe_label kept a stray ZWJ';
  end if;
  -- A long run is cut to 1000 characters before any matching.
  if public._safe_label(repeat(chr(20013), 100000), 60, '') <> repeat(chr(20013), 59) || chr(8230) then
    raise exception '0881: _safe_label mangled a long run';
  end if;
end;
$$;

-- part 14
-- The look-alike dot rule and the top-level domain.
do $$
declare
  d text := chr(12290);  -- the ideographic full stop
  r record;
begin
  -- Removed: both look-alike dots, upper case, a mark hiding the TLD, a
  -- number before the dot, IDN TLDs in Latin, CJK, Cyrillic (any case),
  -- Greek, Arabic, Thai and Devanagari, after a look-alike or an ASCII dot.
  for r in select * from (values
      ('paypal' || d || 'com', 'ideographic full stop'),
      ('paypal' || chr(8231) || 'com', 'hyphenation point'),
      ('paypal' || chr(65377) || 'com/x', 'halfwidth full stop'),
      ('PAYPAL' || d || 'COM', 'upper case'),
      ('paypal.' || chr(1611) || 'com', 'a mark after an ASCII dot'),
      ('paypal' || d || chr(1611) || 'com', 'a mark after a look-alike dot'),
      (chr(12295) || chr(12295) || d || 'com', 'a number before the dot'),
      ('paypal' || d || chr(20013) || chr(22269), 'a Chinese IDN TLD'),
      ('paypal.' || chr(20013) || chr(22269), 'a Chinese IDN TLD after a dot'),
      (chr(35895) || chr(27468) || d || 'COM', 'a CJK label before COM'),
      ('example' || d || 'verm' || chr(246) || 'gensberater', 'a Latin IDN TLD'),
      ('abc' || d || chr(12467) || chr(12512), 'a Japanese IDN TLD'),
      ('x' || d || chr(45815) || chr(52980), 'a Korean IDN TLD'),
      ('x' || d || chr(1088) || chr(1092), 'a Cyrillic TLD'),
      ('x' || d || chr(1056) || chr(1060), 'a Cyrillic TLD in upper case'),
      ('x.' || chr(1088) || chr(1092) || '/x', 'a Cyrillic TLD and a path'),
      ('ok' || d || chr(949) || chr(955), 'a Greek TLD'),
      ('x' || d || chr(1605) || chr(1589) || chr(1585), 'an Arabic TLD'),
      ('x' || d || chr(3652) || chr(3607) || chr(3618), 'a Thai TLD'),
      ('x.' || chr(2349) || chr(2366) || chr(2352) || chr(2340), 'a Devanagari TLD')
    ) as t(lure, why)
  loop
    if public._safe_label('Prize ' || r.lure, 60, '') <> 'Prize' then
      raise exception '0881: _safe_label kept a domain (%): %', r.why, public._safe_label('Prize ' || r.lure, 60, '');
    end if;
  end loop;

  -- Kept: prose with full stops, a CJK TLD after a CJK word, other dots,
  -- initials whose last label is no TLD.
  for r in select * from (values
      (chr(25774) || chr(24433) || chr(12399) || chr(32066) || chr(20102) || d || chr(27425) || chr(12399) || chr(22823) || chr(38442)),
      (chr(31532) || chr(19968) || chr(22330) || d || chr(31532) || chr(20108) || chr(22330)),
      (chr(25774) || chr(24433) || chr(32066) || chr(20102) || d || 'Netflix' || chr(12391) || chr(37197) || chr(20449)),
      ('Tokyo' || d || chr(26481) || chr(20140) || chr(25903) || chr(31038)),
      (chr(24191) || chr(21578) || chr(29255) || d || chr(20844) || chr(21496)),
      (chr(35895) || chr(27468) || d || chr(20013) || chr(22269)),
      ('Paris' || chr(8901) || 'London'),
      ('Ana' || chr(8729) || 'Luz'),
      ('Col' || chr(183) || 'legi'),
      (chr(1040) || '.' || chr(1057) || '.' || chr(1055) || chr(1091) || chr(1096) || chr(1082) || chr(1080) || chr(1085)),
      ('Mr. Smith v2.0')
    ) as t(name)
  loop
    if public._safe_label(r.name, 60, '') <> r.name then
      raise exception '0881: _safe_label changed a name: % -> %', r.name, public._safe_label(r.name, 60, '');
    end if;
  end loop;
end;
$$;

-- part 15
-- Accepted false positives, and the caller's collation.
do $$
declare
  d text := chr(12290);
begin
  if public._safe_label(chr(26481) || chr(20140) || d || 'Tokyo', 60, 'fb') <> 'fb'
     or public._safe_label(chr(20170) || chr(26085) || chr(12399) || chr(26228) || chr(12428) || d || 'OK!', 60, 'fb') <> '!' then
    raise exception '0881: _safe_label no longer matches safeLabel.mjs on the documented false positives';
  end if;

  -- A C-collated value is scrubbed exactly like the default one.
  if public._safe_label(('Prize paypal' || d || 'com') collate "C", 60, '') <> 'Prize'
     or public._safe_label(('Prize ' || chr(1103) || chr(1085) || chr(1076) || chr(1077) || chr(1082) || chr(1089) || '.' || chr(1088) || chr(1092)) collate "C", 60, '') <> 'Prize'
     or public._safe_label(convert_from(convert_to('Prize paypal' || d || chr(20013) || chr(22269), 'UTF8'), 'UTF8'), 60, '') <> 'Prize'
     or public._safe_label(('Tokyo' || d || chr(26481) || chr(20140) || chr(25903) || chr(31038)) collate "C", 60, '')
        <> 'Tokyo' || d || chr(26481) || chr(20140) || chr(25903) || chr(31038) then
    raise exception '0881: _safe_label depends on the caller''s collation';
  end if;
end;
$$;

-- part 16
-- A TLD as a browser reads it, and a TLD with more letters after it.
do $$
declare
  d text := chr(12290);
  tld text := chr(2349) || chr(2366) || chr(2352) || chr(2340);  -- Devanagari "bharat"
begin
  -- U+1C83 (Cyrillic wide es) is "s" to a browser: "sait" is a TLD.
  if public._safe_label('Prize ab.' || chr(7299) || chr(1072) || chr(1081) || chr(1090), 60, '') <> 'Prize'
     or public._safe_label('Prize ab' || d || chr(7299) || chr(1072) || chr(1081) || chr(1090), 60, '') <> 'Prize' then
    raise exception '0881: _safe_label missed a TLD written with an IDNA look-alike letter';
  end if;
  -- A joiner inside "bharat", and a ZWNJ after a virama before U+3002.
  if public._safe_label('Prize ab.' || left(tld, 2) || chr(8205) || right(tld, 2), 60, '') <> 'Prize'
     or public._safe_label('Prize ab.' || left(tld, 2) || chr(8204) || right(tld, 2), 60, '') <> 'Prize'
     or public._safe_label('Prize ' || chr(2346) || chr(2375) || chr(2346) || chr(2366) || chr(2354) || chr(2381) || chr(8204) || d || 'com', 60, '') <> 'Prize' then
    raise exception '0881: _safe_label let a joiner hide a TLD';
  end if;
  -- Every IDN TLD must end the word, after a real dot or U+3002: "Prize
  -- paypal.zhongguo" then "denglu" stays whole (accepted), with a space
  -- between them the domain goes.
  if public._safe_label('Prize paypal.' || chr(20013) || chr(22269) || chr(30331) || chr(24405), 60, '')
        <> 'Prize paypal.' || chr(20013) || chr(22269) || chr(30331) || chr(24405)
     or public._safe_label('Prize paypal.' || chr(20013) || chr(22269) || ' ' || chr(30331) || chr(24405), 60, '') <> 'Prize ' || chr(30331) || chr(24405)
     or public._safe_label('Tokyo' || d || chr(20013) || chr(22269) || chr(25903) || chr(31038), 60, '')
        <> 'Tokyo' || d || chr(20013) || chr(22269) || chr(25903) || chr(31038)
     or public._safe_label('paypal' || d || 'com' || chr(12391), 60, '') <> 'paypal' || d || 'com' || chr(12391) then
    raise exception '0881: _safe_label no longer matches safeLabel.mjs on a TLD with more letters after it';
  end if;
end;
$$;

-- part 17
-- Names whose word after the dot starts with a TLD, the sharp s, and runs of
-- joiners judged by their neighbours.
do $$
declare
  d text := chr(12290);
  r record;
begin
  -- Kept: "1.gongsi jianjie" (Han), "1.hanguk yeohaeng" (Hangul), Thai
  -- "M.Thai-khom", Lao "B.Lao-tholakhom", "Ver.kuraudo-ban", German words
  -- with a sharp s, and real joiner sequences: a heart on fire (VS16, ZWJ),
  -- an eye in a speech bubble (VS16, ZWJ, VS16), a keycap, Sinhala "Sri"
  -- (virama, ZWJ).
  for r in select * from (values
      ('1.' || chr(20844) || chr(21496) || chr(31616) || chr(20171)),
      ('1.' || chr(54620) || chr(44397) || chr(50668) || chr(54665)),
      (chr(3617) || '.' || chr(3652) || chr(3607) || chr(3618) || chr(3588) || chr(3617)),
      (chr(3738) || '.' || chr(3749) || chr(3762) || chr(3751) || chr(3778) || chr(3735) || chr(3749) || chr(3760) || chr(3716) || chr(3771) || chr(3745)),
      ('Ver.' || chr(12463) || chr(12521) || chr(12454) || chr(12489) || chr(29256)),
      ('Stra' || chr(223) || 'e 5'),
      (chr(10084) || chr(65039) || chr(8205) || chr(128293)),
      (chr(128065) || chr(65039) || chr(8205) || chr(128488) || chr(65039)),
      ('1' || chr(65039) || chr(8419)),
      (chr(3521) || chr(3530) || chr(8205) || chr(3515) || chr(3539))
    ) as t(name)
  loop
    if public._safe_label(r.name, 60, '') <> r.name then
      raise exception '0881: _safe_label changed a name: % -> %', r.name, public._safe_label(r.name, 60, '');
    end if;
  end loop;
  -- Removed: a sharp s is "ss" in a host, so these are ab.ss and ab.glass.
  if public._safe_label('Prize ab.' || chr(7838), 60, '') <> 'Prize'
     or public._safe_label('Prize ab' || d || chr(7838), 60, '') <> 'Prize'
     or public._safe_label('Prize ab' || d || 'gla' || chr(7838), 60, '') <> 'Prize' then
    raise exception '0881: _safe_label missed a TLD written with a sharp s';
  end if;
  -- Two joiners in a row between Devanagari letters: neither is in place
  -- (each has a joiner beside it), so both go, as in safeLabel.mjs.
  if public._safe_label('n ' || chr(2349) || chr(2366) || chr(8205) || chr(8204) || chr(2349) || chr(2366) || ' n', 60, '')
     <> 'n ' || chr(2349) || chr(2366) || chr(2349) || chr(2366) || ' n' then
    raise exception '0881: _safe_label judged a joiner by a neighbour already dropped';
  end if;
end;
$$;
