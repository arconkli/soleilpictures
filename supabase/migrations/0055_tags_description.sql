-- Per-tag description: the AI tagger reads this when deciding whether
-- a tag applies to a card, so workspaces can tune what each tag means
-- without retraining or prompt edits. NULL means "no description set"
-- and the tagger falls back to using the name alone.
ALTER TABLE public.tags
  ADD COLUMN IF NOT EXISTS description text;

ALTER TABLE public.tags
  ADD CONSTRAINT tags_description_length CHECK (description IS NULL OR length(description) <= 500);
