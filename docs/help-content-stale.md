# Help content — staleness report

_Generated 2026-09-03T10:49:51.898Z_

Fresh manifests: 64. DB rows: 68. Stale: 3. Missing: 5. Orphan: 0.

**STALE** = the underlying UI changed since this help content was generated. Regenerate via /admin/help-content → REGEN, then re-review. **Missing** = extraction found a manifest but no DB row exists (run `npm run help:generate`). **Orphan** = a DB row for a route/view/role that no longer exists in the code (page was deleted / renamed); consider deleting the row.

## STALE (3)

| Route | View | Role | Stored hash | Fresh hash | Reviewed |
|-------|------|------|-------------|------------|----------|
| `/itc/[mapId]` | assumptions | member | `c62b7adb37819a9b` | `b970e841eafc2450` | no |
| `/itc/[mapId]` | worries | member | `1e81e3e5fa52b84c` | `8d3df9d08c0683c9` | no |
| `/missions` | — | member | `b410a3d05c8ab370` | `8dc92d41d8089f0f` | no |

## MISSING (5)

Manifests without a DB row. Run `npm run help:generate`.

- `/admin/help-content` · — · admin
- `/goals/[id]` · — · member
- `/messages` · — · member
- `/messages/[threadId]` · — · member
- `/messages/with/[userId]` · — · member
