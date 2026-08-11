--
-- Fix: infinite recursion in memberships RLS.
--
-- The "memberships: leader manage own community" policy referenced memberships
-- from within its own USING clause, which Postgres rejects with error 42P17.
-- The self-read policy that should have satisfied the query never got a chance
-- to be evaluated because the offending policy errored the whole SELECT.
--
-- Fix: introduce a SECURITY DEFINER helper that bypasses RLS for the internal
-- lookup, then rewrite the policy to call it.
--

create or replace function public.is_leader_of_community(target_community uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from memberships lm
    where lm.user_id = auth.uid()
      and lm.community_id = target_community
      and lm.role = 'leader'
      and lm.status = 'active'
  );
$$;

drop policy if exists "memberships: leader manage own community" on memberships;
create policy "memberships: leader manage own community"
  on memberships for all
  using (public.is_leader_of_community(community_id))
  with check (public.is_leader_of_community(community_id));
