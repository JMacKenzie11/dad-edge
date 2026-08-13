-- Add 'immune_system' to the itc_map_stage enum.
--
-- The 20260812000021_itc_immune_system_stage.sql migration added the
-- walkthrough_delivered flag column and shipped app-layer stage-machine
-- support for the new stage, but its comment incorrectly claimed
-- current_stage was a plain text column. It's actually the itc_map_stage
-- enum, which was defined in 20260811000017_itc_map_builder.sql without
-- immune_system. Every advance_stage to immune_system since then has
-- failed silently with "invalid input value for enum itc_map_stage:
-- 'immune_system'" — caught by cascade diagnostic logging on 2026-08-12.
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block. If
-- this migration fails on some runners, wrap it in a wrapper or run
-- manually. Supabase migration runner tolerates this by default.

alter type itc_map_stage add value if not exists 'immune_system' before 'prioritize';
