-- Coach text on behaviors, same pair the three honed columns carry
-- (20260901000001): the rendered "what's off" lines and a verified
-- rewrite. Brings Column 2 onto the same surface as worries,
-- commitments and assumptions: one box, one "Use this" button, one
-- judge (scoreBehaviorDepth) on the way in and on the way back out.
--
-- rubric_reason keeps its meaning (raw depth-rubric reason, null when
-- depth passed). Backfill sharpen_text from it so existing red boxes
-- don't go blank until the next save.

alter table itc_behaviors
  add column if not exists sharpen_text text,
  add column if not exists suggested_fix text;

update itc_behaviors
  set sharpen_text = rubric_reason
  where rubric_reason is not null
    and sharpen_text is null
    and (depth_score is null or depth_score < 3);
