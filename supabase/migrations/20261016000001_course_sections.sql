-- =============================================================================
-- Course sections: optional titled groups of lessons inside a course.
--
--   * courses.uses_sections turns them on per course. Off (the default, and
--     every existing course) keeps the flat lesson list exactly as it was.
--   * In a sectioned course, lessons.sort_order is the order inside its
--     section; members see sections in course_sections.sort_order.
--   * A lesson's section must belong to the same course (composite foreign
--     key). NO ACTION, so a section with lessons can't be deleted on its
--     own, while deleting the whole course still cascades both away in one
--     statement.
--   * Members read sections of courses they can view (can_view_course, the
--     same rule as lessons); only platform admins write them.
--   * set_course_sections() switches a course on or off in one transaction:
--     on puts any existing lessons into one first section, off flattens the
--     lessons back into one list in the order members saw and drops the
--     sections. Service role only.
-- =============================================================================

alter table public.courses
  add column if not exists uses_sections boolean not null default false;

create table if not exists public.course_sections (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  sort_order int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint course_sections_title_length check (char_length(btrim(title)) between 1 and 120),
  constraint course_sections_id_course unique (id, course_id)
);
create index if not exists course_sections_course_order_idx
  on public.course_sections (course_id, sort_order);

drop trigger if exists course_sections_touch_updated_at on public.course_sections;
create trigger course_sections_touch_updated_at
  before update on public.course_sections
  for each row execute function public.resource_touch_updated_at();

alter table public.lessons
  add column if not exists section_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'lessons_section_same_course'
  ) then
    alter table public.lessons
      add constraint lessons_section_same_course
      foreign key (section_id, course_id)
      references public.course_sections (id, course_id);
  end if;
end $$;

create index if not exists lessons_section_order_idx
  on public.lessons (section_id, sort_order);

-- RLS ------------------------------------------------------------------------

alter table public.course_sections enable row level security;

drop policy if exists "course_sections: viewer read" on public.course_sections;
create policy "course_sections: viewer read"
  on public.course_sections for select
  using (public.can_view_course(course_id));

drop policy if exists "course_sections: admin write" on public.course_sections;
create policy "course_sections: admin write"
  on public.course_sections for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- Switching sections on or off -------------------------------------------------

create or replace function public.set_course_sections(
  target_course uuid,
  enabled boolean,
  first_section_title text default 'Lessons'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  first_section uuid;
begin
  if enabled then
    if exists (select 1 from public.courses where id = target_course and uses_sections) then
      return;
    end if;
    update public.courses set uses_sections = true where id = target_course;
    if exists (select 1 from public.lessons where course_id = target_course and section_id is null) then
      insert into public.course_sections (course_id, title, sort_order)
      values (
        target_course,
        coalesce(nullif(btrim(first_section_title), ''), 'Lessons'),
        coalesce((select max(sort_order) + 1 from public.course_sections where course_id = target_course), 0)
      )
      returning id into first_section;
      update public.lessons set section_id = first_section
      where course_id = target_course and section_id is null;
    end if;
  else
    with ordered as (
      select l.id,
             row_number() over (
               order by s.sort_order nulls last, l.sort_order, l.created_at
             ) - 1 as rn
      from public.lessons l
      left join public.course_sections s on s.id = l.section_id
      where l.course_id = target_course
    )
    update public.lessons l
    set sort_order = o.rn, section_id = null
    from ordered o
    where l.id = o.id;
    delete from public.course_sections where course_id = target_course;
    update public.courses set uses_sections = false where id = target_course;
  end if;
end;
$$;

revoke execute on function public.set_course_sections(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.set_course_sections(uuid, boolean, text) to service_role;
