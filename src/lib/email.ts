/**
 * Email delivery via Resend. Falls back to console logging when RESEND_API_KEY
 * is not set, so the app runs cleanly in dev without accidentally sending mail.
 *
 * §8 covers the notification set: reminders, nudges, digests, week-close.
 * Magic links themselves are still delivered by Supabase Auth, not this module.
 */

const FROM = process.env.RESEND_FROM ?? "BRAVE MAN OS <noreply@dadedge.local>";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3300";

type SendResult = { ok: true; id?: string } | { ok: false; error: string };

async function send(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.info("[email:dev]", { to: opts.to, subject: opts.subject, text: opts.text });
    return { ok: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      }),
    });
    if (!res.ok) {
      // Read the response body so we can see WHY Resend rejected —
      // "domain not verified", "invalid from", auth errors, etc.
      // The status code alone ("Resend 400") tells us nothing.
      const detail = await res.text().catch(() => "(no body)");
      console.warn(
        "[email:send] Resend %d for from=%s to=%s subject=%s :: %s",
        res.status,
        FROM,
        opts.to,
        opts.subject,
        detail.slice(0, 500),
      );
      return { ok: false, error: `Resend ${res.status}: ${detail.slice(0, 200)}` };
    }
    const body = (await res.json()) as { id?: string };
    console.info(
      "[email:send] Resend ok id=%s from=%s to=%s subject=%s",
      body.id ?? "(no id)",
      FROM,
      opts.to,
      opts.subject,
    );
    return { ok: true, id: body.id };
  } catch (err) {
    console.warn(
      "[email:send] Resend threw for from=%s to=%s :: %s",
      FROM,
      opts.to,
      err instanceof Error ? err.message : String(err),
    );
    return { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }
}

function shell(headline: string, body: string): string {
  return `
<!doctype html><html><body style="background:#000;color:#fff;font-family:Inter,Arial,sans-serif;margin:0;padding:24px;">
  <table role="presentation" style="max-width:520px;margin:0 auto;background:#0b0f14;border:1px solid #1e2630;border-radius:14px;padding:24px;">
    <tr><td>
      <p style="font-family:Archivo,Arial,sans-serif;text-transform:uppercase;letter-spacing:0.12em;font-size:11px;color:#9aa7b4;margin:0 0 8px;">BRAVE MAN OS</p>
      <h1 style="font-family:Archivo,Arial,sans-serif;text-transform:uppercase;letter-spacing:0.04em;font-size:22px;margin:0 0 12px;color:#fff;">${headline}</h1>
      <div style="font-size:14px;line-height:1.5;color:#fff;">${body}</div>
    </td></tr>
  </table>
</body></html>`;
}

// sendInviteEmail removed 2026-08-24 — legacy magic-link body from
// the pre-password era. Its only callers (/admin/invites and the
// leader /leader/members invite form) are gone. All invites go
// through sendActivationEmail via /admin/users → Send Invite.

// -------------------------------------------------------------------------
// Auth-phase transactional emails (Section 4 of the 2026-08-22 spec).
//
// Two email types in scope: account activation and password reset. Copy
// lives in src/lib/copy/auth-emails.ts. Sending uses the same send()
// helper as every other email in this file.
//
// Stage A convention: for these two types SPECIFICALLY, we let Supabase
// send its own default email (via inviteUserByEmail / resetPasswordForEmail
// in the callers) — ugly but functional. Callers route through the
// functions below only when EMAIL_STAGE === "B", the explicit go-live
// flag Jason flips after DNS verification per
// docs/email-setup-checklist.md.
// -------------------------------------------------------------------------

/** True when the app should send activation + reset emails via our own
 *  Resend transport rather than Supabase's default. Gated on an
 *  explicit env var (EMAIL_STAGE=B) — not just presence of
 *  RESEND_API_KEY — so a dev with a key set for other emails doesn't
 *  accidentally start sending auth emails through an unverified domain. */
export function isStageBEmailLive(): boolean {
  const key = process.env.RESEND_API_KEY;
  return process.env.EMAIL_STAGE === "B" && Boolean(key) && key!.length > 0;
}

export async function sendActivationEmail(opts: {
  to: string;
  firstName: string | null;
  communityName: string | null;
  activationUrl: string;
}) {
  const { activationEmail } = await import("./copy/auth-emails");
  const body = activationEmail({
    firstName: opts.firstName,
    activationUrl: opts.activationUrl,
    communityName: opts.communityName,
  });
  return send({
    to: opts.to,
    subject: body.subject,
    text: body.text,
    html: body.html,
  });
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  firstName: string | null;
  resetUrl: string;
}) {
  const { passwordResetEmail } = await import("./copy/auth-emails");
  const body = passwordResetEmail({
    firstName: opts.firstName,
    resetUrl: opts.resetUrl,
  });
  return send({
    to: opts.to,
    subject: body.subject,
    text: body.text,
    html: body.html,
  });
}

export async function sendDailyReminderEmail(opts: {
  to: string;
  firstName: string | null;
  weekTotal: number;
  streak: number;
}) {
  const greeting = opts.firstName ?? "Brother";
  const url = `${APP_URL}/today`;
  return send({
    to: opts.to,
    subject: "Log today.",
    text: `${greeting},\n\nWeek total: ${opts.weekTotal}/49. Engagement streak: ${opts.streak}.\n\nLog today: ${url}\n\nBRAVE MAN OS`,
    html: shell(
      "Log today.",
      `<p>${greeting},</p><p>Week total: <strong>${opts.weekTotal}/49</strong>. Engagement streak: <strong>${opts.streak}</strong>.</p>
       <p><a href="${url}" style="display:inline-block;background:#0075c9;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-family:Archivo,Arial,sans-serif;letter-spacing:0.04em;text-transform:uppercase;font-size:12px;">Log today</a></p>`,
    ),
  });
}

export async function sendMissionDayNudgeEmail(opts: {
  to: string;
  firstName: string | null;
  missionDescription: string;
}) {
  const greeting = opts.firstName ?? "Brother";
  const url = `${APP_URL}/missions`;
  return send({
    to: opts.to,
    subject: "Mission day. Report back.",
    text: `${greeting},\n\nToday's mission: ${opts.missionDescription}\n\nReport back: ${url}\n\nBRAVE MAN OS`,
    html: shell(
      "Mission day.",
      `<p>${greeting},</p><p><strong>${opts.missionDescription}</strong></p>
       <p><a href="${url}" style="display:inline-block;background:#0075c9;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-family:Archivo,Arial,sans-serif;letter-spacing:0.04em;text-transform:uppercase;font-size:12px;">Report back</a></p>`,
    ),
  });
}

export async function sendDisengagementEmail(opts: {
  to: string;
  firstName: string | null;
  daysSince: number;
  tone: "gentle" | "direct";
}) {
  const greeting = opts.firstName ?? "Brother";
  const url = `${APP_URL}/today`;
  const line =
    opts.tone === "direct"
      ? `${opts.daysSince} days. Your brothers noticed. Get back in.`
      : `Been ${opts.daysSince} days since your last check-in.`;
  return send({
    to: opts.to,
    subject: opts.tone === "direct" ? "You've gone quiet." : "Log today.",
    text: `${greeting},\n\n${line}\n\n${url}\n\nBRAVE MAN OS`,
    html: shell(
      opts.tone === "direct" ? "You've gone quiet." : "Log today.",
      `<p>${greeting},</p><p>${line}</p>
       <p><a href="${url}" style="display:inline-block;background:#0075c9;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-family:Archivo,Arial,sans-serif;letter-spacing:0.04em;text-transform:uppercase;font-size:12px;">Log today</a></p>`,
    ),
  });
}

export async function sendLeaderDisengagementAlert(opts: {
  to: string;
  memberName: string;
  daysSince: number;
  communityName: string;
}) {
  const url = `${APP_URL}/leader/disengagement`;
  return send({
    to: opts.to,
    subject: `${opts.memberName}: ${opts.daysSince} days silent`,
    text: `${opts.memberName} (${opts.communityName}) hasn't logged in ${opts.daysSince} days. Time to reach out.\n\n${url}`,
    html: shell(
      "Reach out.",
      `<p><strong>${opts.memberName}</strong> (${opts.communityName}) hasn't logged in ${opts.daysSince} days.</p>
       <p>Personal check-in from you now saves the man.</p>
       <p><a href="${url}" style="display:inline-block;background:#0075c9;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-family:Archivo,Arial,sans-serif;letter-spacing:0.04em;text-transform:uppercase;font-size:12px;">Open leader panel</a></p>`,
    ),
  });
}

export async function sendWeekCloseEmail(opts: {
  to: string;
  firstName: string | null;
  weekTotal: number;
  daysUnlogged: number;
  locksAt: string;
}) {
  const greeting = opts.firstName ?? "Brother";
  const url = `${APP_URL}/today`;
  const line = opts.daysUnlogged > 0
    ? `${opts.daysUnlogged} day${opts.daysUnlogged === 1 ? "" : "s"} unlogged.`
    : `Week's in the books at ${opts.weekTotal}/49.`;
  return send({
    to: opts.to,
    subject: `Week locks ${opts.locksAt}.`,
    text: `${greeting},\n\n${line} Week locks ${opts.locksAt}.\n\n${url}\n\nBRAVE MAN OS`,
    html: shell(
      "Week close.",
      `<p>${greeting},</p><p>${line} Week locks <strong>${opts.locksAt}</strong>.</p>
       <p><a href="${url}" style="display:inline-block;background:#0075c9;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-family:Archivo,Arial,sans-serif;letter-spacing:0.04em;text-transform:uppercase;font-size:12px;">Close it out</a></p>`,
    ),
  });
}

export async function sendDigestEmail(opts: {
  to: string;
  communityName: string;
  weekStart: string;
  htmlBody: string;
  textBody: string;
}) {
  return send({
    to: opts.to,
    subject: `${opts.communityName}: week of ${opts.weekStart}`,
    text: opts.textBody,
    html: shell(`${opts.communityName}: week of ${opts.weekStart}`, opts.htmlBody),
  });
}
