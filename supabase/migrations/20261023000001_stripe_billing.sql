-- =============================================================================
-- Stripe billing, per membership (DECISIONS.md "Stripe billing").
--
--   communities.stripe_product_id   the Stripe product that buys a seat here
--   membership_billing              one row per Stripe-billed membership
--   stripe_events                   every Stripe notification, recorded once
--
-- Billing lives in its own table, not on memberships, because community-
-- mates can read each other's membership rows ("memberships: community-mate
-- read"); a man's payment status is his and the admins' business only.
--
-- A membership with no membership_billing row is managed by hand and Stripe
-- never touches it.
-- =============================================================================

alter table public.communities
  add column if not exists stripe_product_id text;

alter table public.communities
  drop constraint if exists communities_stripe_product_id_key;
alter table public.communities
  add constraint communities_stripe_product_id_key unique (stripe_product_id);

-- One Stripe customer is one of our users.
create unique index if not exists users_stripe_customer_id_key
  on public.users (stripe_customer_id) where stripe_customer_id is not null;

create table if not exists public.membership_billing (
  membership_id          uuid primary key references public.memberships(id) on delete cascade,
  user_id                uuid not null references public.users(id) on delete cascade,
  community_id           uuid not null references public.communities(id) on delete cascade,
  stripe_customer_id     text not null,
  stripe_subscription_id text not null unique,
  -- Stripe's own subscription status, copied as is (active, trialing,
  -- past_due, canceled, unpaid, incomplete, incomplete_expired, paused).
  status                 text not null,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  -- Set by a failed invoice, cleared by a paid one.
  payment_failed_at      timestamptz,
  ended_at               timestamptz,
  updated_at             timestamptz not null default now()
);

create index if not exists membership_billing_user_idx on public.membership_billing (user_id);
create index if not exists membership_billing_past_due_idx
  on public.membership_billing (payment_failed_at) where payment_failed_at is not null;

alter table public.membership_billing enable row level security;

drop policy if exists "membership_billing: self read" on public.membership_billing;
create policy "membership_billing: self read"
  on public.membership_billing for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "membership_billing: admin read" on public.membership_billing;
create policy "membership_billing: admin read"
  on public.membership_billing for select to authenticated
  using (public.is_platform_admin());

-- No insert/update/delete policy: only the Stripe webhook writes here, with
-- the service role.
revoke insert, update, delete on public.membership_billing from authenticated, anon;
grant select on public.membership_billing to authenticated;

create table if not exists public.stripe_events (
  id            text primary key,
  type          text not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  error         text
);

alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from authenticated, anon;

-- The same rule as canAccess() in src/lib/entitlement.ts: a Stripe
-- cancellation ends access the day the paid period ends, with no 30-day
-- read-only window. Hand-managed cancellations keep the window.
create or replace function public.has_read_entitlement()
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select coalesce((
    select
      u.subscription_status in ('active', 'trialing', 'comped', 'past_due')
      or (
        u.subscription_status = 'canceled'
        and u.subscription_source = 'manual'
        and u.canceled_at is not null
        and u.canceled_at > now() - interval '30 days'
      )
    from public.users u
    where u.id = auth.uid()
  ), false);
$$;
