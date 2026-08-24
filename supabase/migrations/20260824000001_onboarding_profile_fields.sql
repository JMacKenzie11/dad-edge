-- =============================================================================
-- Onboarding profile step: avatar + city.
--
-- Adds the two columns needed for the new /onboarding/profile step
-- (avatar_url, city). users.phone already exists. Also provisions the
-- avatars storage bucket + RLS policies so authenticated users can
-- upload their own picture and everyone can read it.
--
-- Wizard renumber (7 → 8 steps) is handled in application code
-- (src/lib/session.ts), not in a schema migration — no data change is
-- required; users.onboarding_step continues to advance monotonically
-- and users mid-flow are re-routed by the app to the new next step.
-- =============================================================================

alter table public.users
  add column if not exists avatar_url text,
  add column if not exists city text;

-- ----------------------------------------------------------------------------
-- Storage: avatars bucket (public read, authenticated write to own folder).
-- ----------------------------------------------------------------------------

-- Idempotent: create bucket if not present.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Anyone can READ any avatar (public bucket).
drop policy if exists "Public read on avatars" on storage.objects;
create policy "Public read on avatars"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- Authenticated users can INSERT into a folder named after their user id.
drop policy if exists "User can upload own avatar" on storage.objects;
create policy "User can upload own avatar"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Authenticated users can UPDATE their own avatar (for re-uploads).
drop policy if exists "User can update own avatar" on storage.objects;
create policy "User can update own avatar"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Authenticated users can DELETE their own avatar.
drop policy if exists "User can delete own avatar" on storage.objects;
create policy "User can delete own avatar"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
