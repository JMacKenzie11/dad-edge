# Help content — staleness report

_Generated 2026-10-14T22:35:25.142Z_

Fresh manifests: 70. DB rows: 74. Stale: 4. Missing: 5. Orphan: 0.

**STALE** = the underlying UI changed since this help content was generated. Regenerate via /admin/help-content → REGEN, then re-review. **Missing** = extraction found a manifest but no DB row exists (run `npm run help:generate`). **Orphan** = a DB row for a route/view/role that no longer exists in the code (page was deleted / renamed); consider deleting the row.

## STALE (4)

| Route | View | Role | Stored hash | Fresh hash | Reviewed |
|-------|------|------|-------------|------------|----------|
| `/me` | — | member | `632f529a2fa2d977` | `3c50db1c39223884` | yes |
| `/me/partner` | — | member | `117049e9adae5d13` | `8fb2bc04a097f1b8` | yes |
| `/missions` | — | member | `8dc92d41d8089f0f` | `7b2fe5fcbd38c41f` | yes |
| `/onboarding/kids` | — | member | `99c1c6ef1322723a` | `5721d0a8ff216ad7` | yes |

## MISSING (5)

Manifests without a DB row. Run `npm run help:generate`.

- `/admin/help-content` · — · admin
- `/goals/[id]` · — · member
- `/messages` · — · member
- `/messages/[threadId]` · — · member
- `/messages/with/[userId]` · — · member
