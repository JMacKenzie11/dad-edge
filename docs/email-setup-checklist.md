# Email setup checklist (Stage B — Resend + verified domain)

This checklist covers the DNS + Resend work that has to happen before the auth-phase Stage B email flow can be flipped live. **No real invite goes out to any real person until every box below is checked** — Stage A (Supabase's default sender) is fine for internal testing but not for actual coachees.

Jason does the DNS + Resend account work. Claude Code does the code wiring (already shipped in Checkpoint D of the auth-phase spec).

---

## What Stage B does

Two transactional emails go through Resend + your verified sending domain instead of Supabase's default:

1. **Account activation** — sent by admin Send Invite (individual + batch)
2. **Password reset** — sent by `Forgot password?` on `/login`

Nudges, digests, week-close, disengagement, and leader alerts stay exactly where they are (they were already Resend-routed via `src/lib/email.ts`; this only changes the auth-specific pair).

---

## The go-live gate

The app checks `EMAIL_STAGE=B` AND a non-empty `RESEND_API_KEY` before sending auth emails through Resend. If either is missing, it falls back to Stage A (Supabase's default sender) so the app never breaks in dev or on a misconfigured environment.

That means: **flipping `EMAIL_STAGE=B` in production is the last step**. Do it only after every box below is checked.

---

## Checklist

- [ ] **Create the Resend account.** [resend.com](https://resend.com). Free tier is fine for the volume this app sends.

- [ ] **Add the sending domain in Resend.** Use a subdomain you're comfortable dedicating to app mail (recommended: `mail.dadedge.com` or similar). Do NOT use your root domain — SPF conflicts with anything else sending mail from that domain get ugly.

- [ ] **Add SPF record.** In your DNS registrar (Cloudflare, Route53, GoDaddy, etc.), add the TXT record Resend gives you at the subdomain root. Looks like: `v=spf1 include:amazonses.com ~all`.

- [ ] **Add DKIM records.** Resend gives you two or three CNAME records to add at specific subdomains (e.g. `resend._domainkey.mail.dadedge.com`). Add all of them exactly as shown.

- [ ] **Add DMARC record (recommended).** Optional but hardens deliverability: `v=DMARC1; p=none; rua=mailto:you@example.com` at `_dmarc.mail.dadedge.com`. Start with `p=none` while you monitor; move to `p=quarantine` later once mail is flowing cleanly.

- [ ] **Verify the domain in Resend.** Wait for the "Verified" badge (DNS propagation can take 5 minutes to a few hours). Click "Verify" in the Resend dashboard until it goes green.

- [ ] **Generate a production Resend API key.** Scope it to sending only. Rotate the one currently in dev if it's ever been shared.

- [ ] **Set the production env vars:**
  - `RESEND_API_KEY=<the new key>`
  - `RESEND_FROM=Dad Edge <no-reply@mail.dadedge.com>` (or whatever your subdomain resolves to)
  - `EMAIL_STAGE=B`

- [ ] **Test delivery from Stage B.** Send yourself an activation invite from `/admin/users` (create a test account, hit Send Invite). Confirm the email arrives from your sending domain (not a Resend sandbox domain), not in spam, with the copy from `src/lib/copy/auth-emails.ts`. Do the same for password reset via `/login` → "Forgot password?".

- [ ] **Send yourself a real invite from a fresh incognito window.** End to end: receive email → click link → land on `/set-password` → set password → sign in → land on `/today` (or `/itc/{mapId}` for migrated ITC users). Do the same for a reset.

- [ ] **Only then** send an invite to a real person.

---

## Stage B failure modes to watch

- **Landing in spam.** If your first-send report shows delivery but the recipient reports the mail landed in spam, the issue is almost always missing/incorrect DMARC. Add DMARC, wait for propagation, resend.

- **"Domain not verified" errors from Resend API.** DNS hasn't propagated. Wait 30 minutes and try again. If it's been over 6 hours, the CNAMEs are wrong — re-copy them from Resend and check for typos.

- **Wrong sender name.** `RESEND_FROM` needs to match the verified domain. `Dad Edge <no-reply@mail.dadedge.com>` works if `mail.dadedge.com` is verified. `Dad Edge <no-reply@dadedge.com>` won't work unless the ROOT domain is verified.

- **Rate-limit errors.** Resend's free tier has send limits. If a large batch fails partway through with rate-limit messages, upgrade the plan or chunk the batch.

---

## Emergency rollback

If Stage B breaks in production for any reason:

- Unset `EMAIL_STAGE` in your production env (or set to any value other than `B`).
- Redeploy or restart.
- The code falls back to Stage A (Supabase's default) automatically. Users get an ugly-but-functional activation/reset email until you diagnose.

This is the whole point of the stage gate. Stage A is always a safe fallback because it doesn't depend on any DNS state we control.
