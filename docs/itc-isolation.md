# ITC Isolation Proof

The ITC Map Builder is an ad-hoc addition. Because it uses a shared demo password (`1111`), the isolation from the main app has to be watertight. This document records how — and where in the code — the boundary is enforced.

## The requirement

An ITC demo session must never grant access to any existing app route or data. The shared password must never become a skeleton key to real member data.

## The four boundaries

### 1. Separate identity table

- `itc_participants` is defined in `supabase/migrations/20260811000017_itc_map_builder.sql`.
- No foreign key to `public.users`. Email uniqueness is scoped to `itc_participants` only.
- `upsertParticipantByEmail()` (`src/lib/itc/participant.ts`) touches only `itc_participants`. Even when a submitted email matches a `users.email`, no link is created and no user row is read.

### 2. Distinct signed cookie, path-scoped

- Cookie name is `itc_session` (constants in `src/lib/itc/session.ts`). Supabase uses `sb-*` cookie names — no collision.
- The cookie is set with `path: "/itc"`. Browsers do not attach it to requests for `/today`, `/api/coach/messages`, etc. This is enforced by the browser, not by our server.
- The cookie value is `<base64url(payload)>.<base64url(hmac_sha256)>`, signed with `ITC_SESSION_SECRET`. Verification uses `timingSafeEqual`. Expired or tampered cookies decode to `null`.

### 3. Middleware refuses to consult the ITC cookie for main-app auth

- `src/middleware.ts` short-circuits on any `/itc/*` request with `NextResponse.next({ request })` — it never runs `updateSession()` for those.
- `src/lib/supabase/middleware.ts` (`updateSession`) reads only Supabase cookies via `createServerClient`. It never touches `itc_session`. Even if a client managed to send the ITC cookie to a non-`/itc` route (which is browser-blocked by path scope), main middleware would ignore it.
- The route-protection block in `updateSession` checks for `user` from Supabase auth. A caller with only an ITC session and no Supabase session is treated as unauthenticated: `/today`, `/missions`, `/goals`, `/community`, `/me`, `/coach`, `/reset-password`, `/onboarding`, `/leader`, `/admin` all redirect to `/login`.

### 4. RLS deny-all on `itc_*` tables

- Every `itc_*` table has `alter table ... enable row level security` with no policies attached (`supabase/migrations/20260811000017_itc_map_builder.sql`).
- The anon key cannot read or write any of these tables — a leaked browser client key gives no ITC access.
- Only the service role (used by `/api/itc/*` server code — added in Checkpoint B) can read/write. Participant scoping happens in application code, keyed off the `pid` in the verified `itc_session` cookie.

## Manual test procedure (Checkpoint A gate)

Assumes `ITC_DEMO_AUTH=1` and `ITC_SESSION_SECRET` are set locally.

1. **Feature flag off returns 404.**
   - Unset `ITC_DEMO_AUTH` (or set to anything other than `1`).
   - Restart the dev server. `GET /itc/login` returns 404. `GET /itc` returns 404.
2. **Feature flag on shows the login page.**
   - Set `ITC_DEMO_AUTH=1`, restart.
   - `GET /itc/login` renders the form. The disclosure line is visible.
3. **Wrong password is rejected.**
   - Submit `test@example.com` / `9999`. Redirects to `/itc/login?error=bad_password`. No participant row is created (verify with `select count(*) from itc_participants where email='test@example.com';`).
4. **Right password creates a participant and lands on `/itc`.**
   - Submit `test@example.com` / `1111`. Redirects to `/itc`. Landing page shows the email.
   - `itc_session` cookie is now set in DevTools with `path=/itc`, `HttpOnly`, `SameSite=Lax`.
5. **ITC session cannot reach main-app routes.**
   - With the `itc_session` cookie set (and no Supabase session): `GET /today` → redirected to `/login?next=/today`. Same for `/missions`, `/me`, `/admin`.
   - DevTools confirms the browser did not send `itc_session` on those requests (path scope).
6. **Main-app session cannot reach ITC data.**
   - Sign into the main app normally (Supabase magic link). Cookie `sb-*` is now set.
   - `GET /itc` (without an `itc_session`) → redirects to `/itc/login`. The main-app session is ignored by the ITC gate.
7. **Matching email does not link identities.**
   - Sign into the main app as `you@yourdomain.com`. Log into ITC as `you@yourdomain.com` / `1111`.
   - The ITC participant row and the `public.users` row have different ids and no cross-references. `select id from public.users where email='you@yourdomain.com'` and `select id from itc_participants where email='you@yourdomain.com'` return distinct uuids.
8. **RLS keeps the anon key out of ITC tables.**
   - Using an anon-key Supabase client in a scratch script: `.from('itc_participants').select('*')` returns an empty array (RLS blocks) with no error. Same for every `itc_*` table.

If any step fails, isolation is broken and Checkpoint A is not complete.
