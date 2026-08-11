--
-- Work identity — what he does for a living and how he's classified.
-- Captured at onboarding, editable from /me, injected into the coach context
-- so the coach can adapt its framing (a W2 sales rep and a business owner with
-- 25 employees need different coaching, even on the same "team dynamics" issue).
--
do $$ begin
  create type employment_type as enum (
    'w2',
    'contract',
    'self_employed',
    'business_owner',
    'other'
  );
exception when duplicate_object then null; end $$;

alter table users
  add column if not exists occupation text,
  add column if not exists employment_type employment_type;
