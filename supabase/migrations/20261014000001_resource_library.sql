-- =============================================================================
-- Resource Library (Part 1, Checkpoint A)
--
-- Courses hosted as Vimeo embeds, flat lesson lists, PDF attachments in a
-- private bucket, and per-man lesson completions.
--
-- Access model:
--   * Members read a course only when it is published AND visible to a
--     community they belong to (no course_communities rows = every
--     community) AND they pass the entitlement gate. All three checks live
--     in one SECURITY DEFINER helper, can_view_course(), so every policy
--     and the app share one definition.
--   * Members write only their own completions, and only on lessons they
--     can view.
--   * Only platform admins write courses, lessons, files and visibility
--     rows. The app's admin actions go through the service client after
--     requirePlatformAdmin(); the admin policies here are the backstop.
--   * lesson-files bucket is private with no storage.objects policies at
--     all, so only the service role can read an object. Members get a
--     short-lived signed URL from /api/resources/files/[fileId] after the
--     same checks pass. Admin uploads use signed upload URLs.
-- =============================================================================

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  overview_json jsonb,
  is_published boolean not null default false,
  is_pinned boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint courses_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

create table if not exists public.course_communities (
  course_id uuid references public.courses(id) on delete cascade,
  community_id uuid references public.communities(id) on delete cascade,
  primary key (course_id, community_id)
);
create index if not exists course_communities_community_idx
  on public.course_communities (community_id);

create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  sort_order int not null,
  vimeo_url text,
  vimeo_video_id text,
  vimeo_hash text,
  vimeo_thumbnail_url text,
  vimeo_duration_seconds int,
  description_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lessons_course_order_idx
  on public.lessons (course_id, sort_order);

create table if not exists public.lesson_files (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  size_bytes int not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists lesson_files_lesson_order_idx
  on public.lesson_files (lesson_id, sort_order);

create table if not exists public.lesson_completions (
  user_id uuid references public.users(id) on delete cascade,
  lesson_id uuid references public.lessons(id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);
create index if not exists lesson_completions_lesson_idx
  on public.lesson_completions (lesson_id);

-- updated_at upkeep ----------------------------------------------------------
create or replace function public.resource_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists courses_touch_updated_at on public.courses;
create trigger courses_touch_updated_at
  before update on public.courses
  for each row execute function public.resource_touch_updated_at();

drop trigger if exists lessons_touch_updated_at on public.lessons;
create trigger lessons_touch_updated_at
  before update on public.lessons
  for each row execute function public.resource_touch_updated_at();

-- Access helpers -------------------------------------------------------------

-- Mirrors canAccess() in src/lib/entitlement.ts for reads: full access or
-- the 30-day win-back window. Kept in SQL so RLS enforces the gate even if
-- a future code path forgets to call requireAccess().
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
        and u.canceled_at is not null
        and u.canceled_at > now() - interval '30 days'
      )
    from public.users u
    where u.id = auth.uid()
  ), false);
$$;

-- True when the caller may see this course as a member: published, visible
-- to one of his communities (active membership, or inactive but still inside
-- the win-back window), and entitled. Platform admins see everything so the
-- "Preview as member" view works on drafts; member-facing queries still
-- filter on is_published themselves outside preview.
create or replace function public.can_view_course(target_course uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select
    public.is_platform_admin()
    or (
      public.has_read_entitlement()
      and exists (
        select 1 from public.courses c
        where c.id = target_course and c.is_published
      )
      and (
        not exists (
          select 1 from public.course_communities cc
          where cc.course_id = target_course
        )
        or exists (
          select 1
          from public.course_communities cc
          join public.memberships m on m.community_id = cc.community_id
          where cc.course_id = target_course
            and m.user_id = auth.uid()
            and (
              m.status = 'active'
              or (m.canceled_visible_until is not null and m.canceled_visible_until > now())
            )
        )
      )
      and exists (
        -- A man with no community at all sees nothing, even unrestricted
        -- courses. Every member path in the app assumes a community.
        select 1 from public.memberships m
        where m.user_id = auth.uid()
          and (
            m.status = 'active'
            or (m.canceled_visible_until is not null and m.canceled_visible_until > now())
          )
      )
    );
$$;

create or replace function public.can_view_lesson(target_lesson uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.lessons l
    where l.id = target_lesson and public.can_view_course(l.course_id)
  );
$$;

-- RLS ------------------------------------------------------------------------
alter table public.courses enable row level security;
alter table public.course_communities enable row level security;
alter table public.lessons enable row level security;
alter table public.lesson_files enable row level security;
alter table public.lesson_completions enable row level security;

drop policy if exists "courses: viewer read" on public.courses;
create policy "courses: viewer read"
  on public.courses for select
  using (public.can_view_course(id));

drop policy if exists "courses: admin write" on public.courses;
create policy "courses: admin write"
  on public.courses for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- Visibility rows are admin-only. Members never need to read them: the
-- check runs inside can_view_course(), which is SECURITY DEFINER.
drop policy if exists "course_communities: admin all" on public.course_communities;
create policy "course_communities: admin all"
  on public.course_communities for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

drop policy if exists "lessons: viewer read" on public.lessons;
create policy "lessons: viewer read"
  on public.lessons for select
  using (public.can_view_course(course_id));

drop policy if exists "lessons: admin write" on public.lessons;
create policy "lessons: admin write"
  on public.lessons for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- Members can read file metadata (name, size) for lessons they can view.
-- The object itself stays unreachable without a server-issued signed URL.
drop policy if exists "lesson_files: viewer read" on public.lesson_files;
create policy "lesson_files: viewer read"
  on public.lesson_files for select
  using (public.can_view_lesson(lesson_id));

drop policy if exists "lesson_files: admin write" on public.lesson_files;
create policy "lesson_files: admin write"
  on public.lesson_files for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

drop policy if exists "lesson_completions: self read" on public.lesson_completions;
create policy "lesson_completions: self read"
  on public.lesson_completions for select
  using (user_id = auth.uid());

drop policy if exists "lesson_completions: self insert" on public.lesson_completions;
create policy "lesson_completions: self insert"
  on public.lesson_completions for insert
  with check (user_id = auth.uid() and public.can_view_lesson(lesson_id));

drop policy if exists "lesson_completions: self delete" on public.lesson_completions;
create policy "lesson_completions: self delete"
  on public.lesson_completions for delete
  using (user_id = auth.uid());

-- Storage: private PDF bucket --------------------------------------------------
-- 25 MB cap and PDF-only at the bucket level too, so a leaked upload token
-- can't land anything else. The app also checks the file's signature.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lesson-files', 'lesson-files', false, 26214400, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Deliberately no storage.objects policies for this bucket. Without one,
-- anon and authenticated roles can't select, insert, update or delete its
-- objects; only the service role (signed URLs, signed upload URLs) can.
