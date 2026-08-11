--
-- Seed the initial pillar framework and the v1 Partner Connection Survey question set.
-- These are not application data; they are versioned reference data.
--
insert into pillar_framework_versions (version, effective_date, definition)
values (
  'v1',
  '2026-01-05',
  jsonb_build_object(
    'pillars', jsonb_build_array(
      jsonb_build_object('code', 'B',  'label', 'Bond',     'point_rule', 'daily_binary'),
      jsonb_build_object('code', 'R',  'label', 'Raise',    'point_rule', 'daily_binary'),
      jsonb_build_object('code', 'A',  'label', 'Amplify',  'point_rule', 'daily_binary'),
      jsonb_build_object('code', 'V',  'label', 'Vitality', 'point_rule', 'daily_binary'),
      jsonb_build_object('code', 'E',  'label', 'Enjoyment', 'point_rule', 'daily_binary'),
      jsonb_build_object('code', 'M',  'label', 'Movement',  'point_rule', 'daily_binary'),
      jsonb_build_object('code', 'A2', 'label', 'Action',    'point_rule', 'derived_from_missions'),
      jsonb_build_object('code', 'N',  'label', 'Network',  'point_rule', 'daily_binary')
    ),
    'weekly_max', 56
  )
);

--
-- Partner Connection Survey v1 — seed exactly the question set specified in §12.3.
-- Grammatical edits already applied per the spec.
--
with qset as (
  insert into survey_question_sets (version, effective_date)
  values ('v1', '2026-01-05')
  returning id
)
insert into survey_questions (question_set_id, sort_order, text)
select qset.id, ord, txt from qset,
  (values
    (1, 'How well do I truly know you?'),
    (2, 'How respected do you feel by me?'),
    (3, 'How vulnerable do you think I am with you?'),
    (4, 'How safe do you feel being vulnerable with me?'),
    (5, 'How much trust do you have in me?'),
    (6, 'How well do I receive constructive criticism from you?'),
    (7, 'How well do I express empathy toward you?'),
    (8, 'How well do I prioritize being kind to you?'),
    (9, 'How well do I respect your boundaries?'),
    (10, 'How committed do you believe I am to you?'),
    (11, 'How thoughtful am I toward you?'),
    (12, 'How well do I express my appreciation for you?'),
    (13, 'How well do I understand all the unseen work you do for our family?'),
    (14, 'How well do I support you when you need it most?'),
    (15, 'How good am I at following through on my commitments?')
  ) as q(ord, txt);
