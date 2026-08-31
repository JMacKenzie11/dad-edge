-- Backfill: null out rubric_reason on rows that PASSED depth.
--
-- Before composeXxxSharpen shipped, saveWorry/Commitment/Assumption/Behavior
-- persisted the depth rubric's reason string verbatim into rubric_reason —
-- including on passing rows, where the reason describes what makes the row
-- pass ("All three criteria met.") rather than what needs sharpening.
--
-- The row UI renders rubric_reason inside a red "One thing to sharpen" box.
-- Legacy praise text under that framing reads as coaching whiplash: the
-- rubric graded the row as done, but the UI still says "sharpen this".
--
-- The current save path (composeXxxSharpen) correctly returns null for
-- passing rows with no cross-cutting findings, so new saves will write
-- rubric_reason=null. This migration cleans the legacy state so the
-- contract "rubric_reason is populated ⇒ this row needs sharpening" holds
-- across the historical corpus.
--
-- Passing rows that have legit interior-witness / mirror-worry / vague-then
-- findings will lose them here, but they refire on the next save or via the
-- hone waterfall — an acceptable transient in exchange for the class of
-- contradictory-praise renders being gone.

update itc_worries
  set rubric_reason = null
  where depth_score >= 3 and rubric_reason is not null;

update itc_commitments
  set rubric_reason = null
  where depth_score >= 3 and rubric_reason is not null;

update itc_assumptions
  set rubric_reason = null
  where depth_score >= 3 and rubric_reason is not null;

update itc_behaviors
  set rubric_reason = null
  where depth_score >= 3 and rubric_reason is not null;
