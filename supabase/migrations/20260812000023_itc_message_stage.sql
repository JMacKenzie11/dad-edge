-- Chat-per-stage: itc_messages gets a stage_at_creation tag so the chat
-- pane can filter to only the current stage's turns without touching the
-- coach's memory (which still gets the full history via listMessages).
--
-- Default 'goal' is fine for backfill — existing test maps haven't
-- shipped anywhere real.

alter table itc_messages
  add column stage_at_creation text not null default 'goal';

create index itc_messages_stage_idx on itc_messages(map_id, stage_at_creation);
