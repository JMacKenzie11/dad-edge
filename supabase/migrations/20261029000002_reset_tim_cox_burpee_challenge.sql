-- =============================================================================
-- One-off data fix (Jason, 2026-10-29): take Tim Cox back out of the
-- 60/60/60 Burpee Challenge so he can demo joining it to the team. His
-- screen should look as if he's been invited and hasn't answered yet,
-- which is what having no challenge_participants row means (the join card
-- on Today and Missions shows it again). His challenge missions for it go
-- too.
--
-- Production ids, checked read-only before writing this: he was "in",
-- with 10 challenge missions, all planned with no days ticked. On any
-- other database (dev) the ids don't exist and this does nothing. It
-- refuses to touch a mission with days ticked or one already closed.
-- =============================================================================

do $$
declare
  tim constant uuid := 'fe23eec6-76ef-4408-b338-af91c00ca501';
  burpees constant uuid := '1ff3d4c2-e35c-4d11-954e-465b0195ad01';
begin
  if exists (
    select 1 from public.missions
    where user_id = tim and challenge_id = burpees
      and (cardinality(done_dates) > 0 or status <> 'planned')
  ) then
    raise exception 'Tim Cox has burpee challenge days ticked or closed; not resetting.';
  end if;

  delete from public.missions where user_id = tim and challenge_id = burpees;
  delete from public.challenge_participants where user_id = tim and challenge_id = burpees;
end;
$$;
