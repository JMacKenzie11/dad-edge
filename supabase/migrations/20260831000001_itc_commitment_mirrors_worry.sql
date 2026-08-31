-- Persist the mirrors_worry_identity boolean on itc_commitments.
--
-- The commitment depth rubric (scoreCommitmentDepth in
-- src/lib/itc/rubric.ts) already computes three binary criteria for
-- every save — is_first_person_never_vow, mirrors_worry_identity,
-- is_specific_not_generic — and aggregates them into the 0-3
-- depth_score already stored. Until now the per-criterion booleans
-- were logged to TurnEventLog for analytics but never persisted for
-- runtime use.
--
-- The honing rework needs mirrors_worry_identity persisted so the
-- shared criteria module can fire a commitment_doesnt_mirror_worry
-- finding when the vow doesn't carry the paired worry's identity
-- content. The Kegan/Lahey introductory form (Vol 1 pp 26-27) is a
-- direct mirror: worry → "I'm also committed to never <the thing the
-- worry fears>". A commitment that fails this criterion is a broken
-- link in the derivation chain and should surface both in the
-- construction column review and in the hone waterfall.
--
-- Nullable: pre-existing rows have no value. Rows saved after this
-- ships will populate it. The criterion check treats null the same
-- way it treats depth_score null — skip, no finding.

alter table itc_commitments
  add column if not exists mirrors_worry_identity boolean;
