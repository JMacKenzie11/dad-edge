-- Coach-drafted commitment text per worry, shown as a suggestion in
-- the Column 4 UI when the user hasn't written a commitment yet.
--
-- ITC methodology explicitly assigns the draft-and-review step to
-- the coach at Column 4: the coachee has already done the deep
-- excavation at Column 3, and the derivation from worry → non-noble
-- commitment is coach work. The draft here is a starting point the
-- user reviews, accepts (with one click), edits, or ignores.
--
-- Form-First-pure: this is METADATA (the coach's suggestion). The
-- authoritative commitment.text is still user-written — the draft
-- only converts to real map state when the user explicitly acts on
-- it (Use this draft → server writes commitment row with attempts=1,
-- runs rubric, fires reaction — same pipeline as a hand-typed save).

alter table itc_worries
  add column if not exists coach_commitment_draft text;
