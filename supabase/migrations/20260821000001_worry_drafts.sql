-- Coach-drafted worry text per selected behavior, shown as a
-- suggestion in the Column 3 UI when the user hasn't written a worry
-- yet. Mirror of coach_commitment_draft on itc_worries.
--
-- Why the coach drafts worries too: excavating to the identity-level
-- "yuck" is the depth gate that decides whether the rest of the map
-- lands. Many men stall at Column 3 either because they don't know
-- what shape a "real" ITC worry looks like, or because they short-
-- circuit into practical concerns ("she'd get upset") and never reach
-- the felt fear about who they are. A well-drafted starting worry
-- (grounded in his pillar + goal + specific behavior) shows the shape
-- AND primes the yuck response, which he can then accept, edit, or
-- replace with his own.
--
-- Form-First-pure: this is METADATA (the coach's suggestion). The
-- authoritative worry.text is still user-written — the draft only
-- converts to real map state when the user explicitly acts on it
-- (Use this draft → server writes worry row with attempts=1, runs
-- rubric, fires reaction — same pipeline as a hand-typed save).

alter table itc_behaviors
  add column if not exists coach_worry_draft text;
