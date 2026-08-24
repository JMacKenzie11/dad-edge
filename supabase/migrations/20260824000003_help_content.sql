-- =============================================================================
-- Context-Aware Help System — Checkpoint A
--
-- Static, pre-approved help content served by a global Help widget.
-- Content is generated offline from extracted route manifests, run
-- through a voice-compliance lint, and reviewed once by a human
-- before it can be served to a real user. No live LLM at runtime.
--
-- Design intent (from the spec): a wrong how-to instruction actively
-- misleads a man using the app — worse than no help. Nothing ships
-- without a review gate.
-- =============================================================================

create table if not exists help_content (
  id uuid primary key default gen_random_uuid(),
  -- Route the content is for. Matches the Next.js route pattern
  -- (`/goals`, `/goals/[id]`, `/itc`, `/itc/[mapId]`). Extraction
  -- normalizes dynamic segments to `[name]`.
  route_pattern text not null,
  -- Null for single-view pages. Non-null for pages that surface
  -- different capabilities based on client-side context — the ITC
  -- canvas is the canonical case: `view_key` = the current stage
  -- (`goal` / `behaviors` / `worries` / etc.) even though the URL
  -- doesn't change between stages.
  view_key text,
  -- 'member' | 'leader' | 'admin' | 'all'.
  -- 'all' means the same content is served to anyone who can reach
  -- the route. Role-precise tagging is used for admin-only routes,
  -- leader-only routes, and pages that render role-conditional
  -- capabilities.
  role text not null default 'all',
  title text not null,
  -- Ordered array of capabilities. Each capability is
  --   { what_its_for: string, steps: string[] }
  -- Steps use exact visible label text bolded (e.g. "tap **Add**"),
  -- never a paraphrase. Steps are numbered by index at render time.
  sections jsonb not null,
  -- Hash of the extracted UI elements this content was generated
  -- from. Staleness detection compares this against a fresh extract
  -- on each CI run to flag rows whose underlying UI has changed.
  source_hash text not null,
  generated_at timestamptz not null default now(),
  reviewed boolean not null default false,
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  -- Result of running the voice-compliance lint against the
  -- generated `sections` content. Rows with false are flagged in
  -- the review queue and can't be approved as-is; they need an
  -- edit-then-approve or a regenerate.
  voice_lint_passed boolean not null default false,
  unique (route_pattern, view_key, role)
);

create index if not exists help_content_reviewed_idx
  on help_content (reviewed);

-- Only reviewed content is servable. Runtime widget query filters
-- reviewed=true; the review queue at /admin/help-content queries
-- reviewed=false.
comment on column help_content.reviewed is
  'Only reviewed=true rows are served to real users. reviewed=false rows sit in /admin/help-content.';

-- ----------------------------------------------------------------------------
-- Coverage gaps: when the widget resolves no matching row, log a
-- miss so the missing coverage is visible without a user having to
-- report it. Purely observational — no user data, no PII. Deduped
-- via (route_pattern, view_key, role) with a hit-count.
-- ----------------------------------------------------------------------------

create table if not exists help_content_gaps (
  id uuid primary key default gen_random_uuid(),
  route_pattern text not null,
  view_key text,
  role text not null,
  hit_count integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (route_pattern, view_key, role)
);

create index if not exists help_content_gaps_last_seen_idx
  on help_content_gaps (last_seen_at desc);

-- ----------------------------------------------------------------------------
-- RLS: help_content is world-readable to authenticated users (the
-- widget queries it); writes are admin-only via service role.
-- Gaps table is service-role only (the widget logs via server
-- action, admins read via the review queue).
-- ----------------------------------------------------------------------------

alter table help_content enable row level security;
alter table help_content_gaps enable row level security;

drop policy if exists "authenticated read approved help content" on help_content;
create policy "authenticated read approved help content"
  on help_content for select
  to authenticated
  using (reviewed = true);

-- No public policies on help_content_gaps; writes + reads go through
-- the service role (server action / admin page).
