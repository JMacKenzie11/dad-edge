--
-- Family layer — partner, children, Partner Connection Survey.
-- Privacy per §12.4: owning user only. Never leaders, never community. RLS enforces.
--
create table partner_profiles (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null unique references users(id) on delete cascade,
  partner_name          text,
  relationship_label    relationship_label,
  partner_birthdate     date,
  relationship_date     date,
  things_loved          text[] not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table children (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  name                  text not null,
  birthdate             date,
  things_loved          text[] not null default '{}',
  created_at            timestamptz not null default now()
);

create index children_user_idx on children (user_id);

create table survey_question_sets (
  id                    uuid primary key default gen_random_uuid(),
  version               text not null unique,
  effective_date        date not null,
  created_at            timestamptz not null default now()
);

create table survey_questions (
  id                    uuid primary key default gen_random_uuid(),
  question_set_id       uuid not null references survey_question_sets(id) on delete cascade,
  sort_order            int not null,
  text                  text not null,
  unique (question_set_id, sort_order)
);

create table partner_surveys (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  question_set_id       uuid not null references survey_question_sets(id),
  taken_at              timestamptz not null default now(),
  context_note          text
);

create index partner_surveys_user_idx on partner_surveys (user_id, taken_at desc);

create table partner_survey_responses (
  id                    uuid primary key default gen_random_uuid(),
  survey_id             uuid not null references partner_surveys(id) on delete cascade,
  question_id           uuid not null references survey_questions(id),
  score                 smallint not null check (score between 1 and 5),
  note                  text,
  unique (survey_id, question_id)
);
