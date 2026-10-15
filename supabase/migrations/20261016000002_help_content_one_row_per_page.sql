-- =============================================================================
-- Help content: one row per page (docs/failure-modes.md FM-13).
--
-- The unique key (route_pattern, view_key, role) treated two NULL view_keys
-- as different, and almost every page has view_key NULL. So `help:generate`
-- never hit the conflict it was written for: each run inserted another copy
-- instead of replacing the row, and the help widget (reviewed = true,
-- limit 1, no order) could show any approved copy.
--
--   1. Keep the newest row of each (route_pattern, view_key, role) and
--      delete the older copies. That's the row the generator meant to
--      leave behind. In production on 2026-10-16 no page had an approved
--      copy next to a newer unapproved one, so no approved help is lost.
--   2. Replace the key with UNIQUE NULLS NOT DISTINCT, so a regeneration
--      replaces the row.
-- =============================================================================

delete from public.help_content h
using (
  select id,
         row_number() over (
           partition by route_pattern, view_key, role
           order by generated_at desc, id desc
         ) as rn
  from public.help_content
) ranked
where h.id = ranked.id and ranked.rn > 1;

alter table public.help_content
  drop constraint if exists help_content_route_pattern_view_key_role_key;

alter table public.help_content
  drop constraint if exists help_content_one_row_per_page;

alter table public.help_content
  add constraint help_content_one_row_per_page
  unique nulls not distinct (route_pattern, view_key, role);
