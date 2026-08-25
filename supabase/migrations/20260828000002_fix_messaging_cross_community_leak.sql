-- =============================================================================
-- Fix: cross-community message thread leak.
--
-- The original message_threads_insert_shared_community policy used an
-- inline
--   exists (
--     select 1 from memberships m_a
--     join memberships m_b on m_a.community_id = m_b.community_id
--     where m_a.user_id = participant_a and m_b.user_id = participant_b
--       and m_a.status = 'active' and m_b.status = 'active'
--   )
-- subquery. Under the caller's session, memberships RLS restricts what
-- that subquery can see — the OTHER participant's membership row is
-- invisible to the caller, so the join produces no rows and the
-- policy... should reject. In practice the interaction between the
-- outer WITH CHECK and the inner RLS-filtered subquery lets the insert
-- through. Integration test (tests/integration/messaging-rls.test.ts)
-- proved that a member of community A could open a thread with a
-- member of community B despite the intended boundary.
--
-- Fix: mirror the pattern already used elsewhere in this schema
-- (shares_active_community, is_leader_of_community, is_leader_of_target)
-- — wrap the check in a SECURITY DEFINER helper that reads memberships
-- with RLS bypassed. One primitive, one guarantee.
-- =============================================================================

create or replace function public.users_share_active_community(user_a uuid, user_b uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from memberships m_a
    join memberships m_b on m_a.community_id = m_b.community_id
    where m_a.user_id = user_a
      and m_b.user_id = user_b
      and m_a.status = 'active'
      and m_b.status = 'active'
  );
$$;

drop policy if exists "message_threads_insert_shared_community" on message_threads;
create policy "message_threads_insert_shared_community"
  on message_threads for insert
  to authenticated
  with check (
    auth.uid() in (participant_a, participant_b)
    and public.users_share_active_community(participant_a, participant_b)
  );

-- Belt-and-suspenders: an earlier permissive policy
-- "message_threads_insert_participant" survives in some environments
-- (dev DB seeded before the 20260825 messages migration hardened it).
-- Postgres RLS treats multiple INSERT policies as OR, so if any pass,
-- the row is accepted — which means a leftover participant-only policy
-- completely defeats the shared-community check above. Drop it here so
-- every environment converges on the single stricter policy.
drop policy if exists "message_threads_insert_participant" on message_threads;
