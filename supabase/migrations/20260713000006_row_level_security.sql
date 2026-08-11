--
-- Row Level Security posture (Section 3 + Section 12.4 privacy).
--
-- Rules:
--   users:              self + community-mates read; self writes
--   communities:        members read; leaders update own community
--   memberships:        own + community-mates read; leaders manage their community; admin all
--   daily_checkins:     self read/write; community-mates read (active window)
--   quarterly_goals:    self read/write; community-mates read
--   missions:           self read/write; community-mates read
--   partner_profiles:   self ONLY (no community, no leader)
--   children:           self ONLY
--   partner_surveys:    self ONLY
--   partner_survey_responses: self ONLY
--   coach_*:            self only; platform admin can read via service role
--   audit_log:          platform admin only
--
-- Platform admin uses the service role (bypasses RLS) — all such reads must be audit-logged.

alter table users enable row level security;
alter table communities enable row level security;
alter table memberships enable row level security;
alter table pillar_framework_versions enable row level security;
alter table weeks enable row level security;
alter table daily_checkins enable row level security;
alter table quarterly_goals enable row level security;
alter table missions enable row level security;
alter table partner_profiles enable row level security;
alter table children enable row level security;
alter table survey_question_sets enable row level security;
alter table survey_questions enable row level security;
alter table partner_surveys enable row level security;
alter table partner_survey_responses enable row level security;
alter table coach_conversations enable row level security;
alter table coach_messages enable row level security;
alter table coach_flags_queue enable row level security;
alter table score_corrections enable row level security;
alter table audit_log enable row level security;
alter table nudge_settings enable row level security;
alter table digests enable row level security;
alter table invites enable row level security;

--
-- USERS
--
create policy "users: self read"
  on users for select
  using (id = auth.uid());

create policy "users: community-mate read"
  on users for select
  using (public.shares_active_community(id));

create policy "users: platform admin read"
  on users for select
  using (public.is_platform_admin());

create policy "users: self update"
  on users for update
  using (id = auth.uid())
  with check (id = auth.uid());

--
-- COMMUNITIES
--
create policy "communities: member read"
  on communities for select
  using (
    exists (
      select 1 from memberships
      where user_id = auth.uid() and community_id = communities.id and status = 'active'
    )
  );

create policy "communities: admin manage"
  on communities for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

--
-- MEMBERSHIPS
--
create policy "memberships: self read"
  on memberships for select
  using (user_id = auth.uid());

create policy "memberships: community-mate read"
  on memberships for select
  using (public.shares_active_community(user_id));

create policy "memberships: leader manage own community"
  on memberships for all
  using (
    exists (
      select 1 from memberships lm
      where lm.user_id = auth.uid()
        and lm.community_id = memberships.community_id
        and lm.role = 'leader'
        and lm.status = 'active'
    )
  )
  with check (
    exists (
      select 1 from memberships lm
      where lm.user_id = auth.uid()
        and lm.community_id = memberships.community_id
        and lm.role = 'leader'
        and lm.status = 'active'
    )
  );

create policy "memberships: admin all"
  on memberships for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

--
-- PILLAR FRAMEWORK, WEEKS — readable by all authenticated
--
create policy "framework: authenticated read"
  on pillar_framework_versions for select
  using (auth.role() = 'authenticated');

create policy "framework: admin manage"
  on pillar_framework_versions for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "weeks: member read"
  on weeks for select
  using (
    exists (
      select 1 from memberships
      where user_id = auth.uid() and community_id = weeks.community_id
    )
  );

create policy "weeks: leader manage"
  on weeks for all
  using (
    exists (
      select 1 from memberships lm
      where lm.user_id = auth.uid()
        and lm.community_id = weeks.community_id
        and lm.role = 'leader'
        and lm.status = 'active'
    )
  )
  with check (true);

--
-- DAILY CHECKINS
--
create policy "checkins: self read"
  on daily_checkins for select
  using (user_id = auth.uid());

create policy "checkins: community-mate read"
  on daily_checkins for select
  using (public.shares_active_community(user_id));

create policy "checkins: self write"
  on daily_checkins for insert
  with check (user_id = auth.uid());

create policy "checkins: self update"
  on daily_checkins for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "checkins: self delete"
  on daily_checkins for delete
  using (user_id = auth.uid());

--
-- QUARTERLY GOALS
--
create policy "goals: self read"
  on quarterly_goals for select
  using (user_id = auth.uid());

create policy "goals: community-mate read"
  on quarterly_goals for select
  using (public.shares_active_community(user_id));

create policy "goals: self write"
  on quarterly_goals for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

--
-- MISSIONS
--
create policy "missions: self read"
  on missions for select
  using (user_id = auth.uid());

create policy "missions: community-mate read"
  on missions for select
  using (public.shares_active_community(user_id));

create policy "missions: self write"
  on missions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

--
-- PARTNER LAYER — owning user only. Never community, never leaders. §12.4.
--
create policy "partner_profiles: self only"
  on partner_profiles for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "children: self only"
  on children for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "surveys: self only"
  on partner_surveys for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "survey_responses: self only"
  on partner_survey_responses for all
  using (
    exists (
      select 1 from partner_surveys ps
      where ps.id = partner_survey_responses.survey_id and ps.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from partner_surveys ps
      where ps.id = partner_survey_responses.survey_id and ps.user_id = auth.uid()
    )
  );

create policy "survey_questions: authenticated read"
  on survey_questions for select
  using (auth.role() = 'authenticated');

create policy "survey_question_sets: authenticated read"
  on survey_question_sets for select
  using (auth.role() = 'authenticated');

--
-- COACH — self only. Flags visible to platform admin only (DECISION #6).
--
create policy "coach_conversations: self"
  on coach_conversations for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "coach_conversations: admin read"
  on coach_conversations for select
  using (public.is_platform_admin());

create policy "coach_messages: self"
  on coach_messages for all
  using (
    exists (
      select 1 from coach_conversations cc
      where cc.id = coach_messages.conversation_id and cc.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from coach_conversations cc
      where cc.id = coach_messages.conversation_id and cc.user_id = auth.uid()
    )
  );

create policy "coach_messages: admin read"
  on coach_messages for select
  using (public.is_platform_admin());

create policy "coach_flags: admin only"
  on coach_flags_queue for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

--
-- SCORE CORRECTIONS + AUDIT LOG — admin/leader write, admin read.
--
create policy "score_corrections: admin all"
  on score_corrections for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "score_corrections: target read"
  on score_corrections for select
  using (target_user_id = auth.uid());

create policy "audit_log: admin read"
  on audit_log for select
  using (public.is_platform_admin());

--
-- NUDGES + DIGESTS
--
create policy "nudge_settings: community-mate read"
  on nudge_settings for select
  using (
    exists (
      select 1 from memberships
      where user_id = auth.uid() and community_id = nudge_settings.community_id
    )
  );

create policy "nudge_settings: leader manage"
  on nudge_settings for all
  using (
    exists (
      select 1 from memberships lm
      where lm.user_id = auth.uid()
        and lm.community_id = nudge_settings.community_id
        and lm.role = 'leader'
    )
  )
  with check (true);

create policy "digests: community-mate read"
  on digests for select
  using (
    exists (
      select 1 from memberships
      where user_id = auth.uid() and community_id = digests.community_id
    )
  );

--
-- INVITES — leaders manage their community; admin all.
--
create policy "invites: leader manage"
  on invites for all
  using (
    exists (
      select 1 from memberships lm
      where lm.user_id = auth.uid()
        and lm.community_id = invites.community_id
        and lm.role = 'leader'
    )
  )
  with check (true);

create policy "invites: admin all"
  on invites for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());
