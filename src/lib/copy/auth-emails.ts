/**
 * Copy for the two transactional auth emails: account activation and
 * password reset. Per the auth-phase spec (2026-08-22), these are
 * the only two email types Stage B (Resend + verified domain) covers.
 * Nudges, digests, and every other email in src/lib/email.ts stay
 * exactly where they were.
 *
 * Voice per docs/app-voice-adaptation.md and
 * docs/coach-voice-and-tone.md: plain, direct, no em-dashes, no
 * wellness-speak, no AI-signature vocab. Short — these are
 * utilitarian emails, not coach turns.
 *
 * Centralization pattern: subject + text + html bodies live here as
 * pure functions from context to strings. sender in email.ts consumes
 * these; nothing else does. Updating copy is a one-file change and
 * doesn't require touching the send logic.
 */

export interface EmailBody {
  subject: string;
  text: string;
  html: string;
}

function htmlShell(headline: string, bodyHtml: string): string {
  return `
<!doctype html><html><body style="background:#000;color:#fff;font-family:Inter,Arial,sans-serif;margin:0;padding:24px;">
  <table role="presentation" style="max-width:520px;margin:0 auto;background:#0b0f14;border:1px solid #1e2630;border-radius:14px;padding:24px;">
    <tr><td>
      <p style="font-family:Archivo,Arial,sans-serif;text-transform:uppercase;letter-spacing:0.12em;font-size:11px;color:#9aa7b4;margin:0 0 8px;">DAD EDGE</p>
      <h1 style="font-family:Archivo,Arial,sans-serif;text-transform:uppercase;letter-spacing:0.04em;font-size:22px;margin:0 0 12px;color:#fff;">${headline}</h1>
      <div style="font-size:14px;line-height:1.5;color:#fff;">${bodyHtml}</div>
    </td></tr>
  </table>
</body></html>`;
}

function ctaButton(url: string, label: string): string {
  return `<p><a href="${url}" style="display:inline-block;background:#0075c9;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-family:Archivo,Arial,sans-serif;letter-spacing:0.04em;text-transform:uppercase;font-size:12px;">${label}</a></p>`;
}

export function activationEmail(opts: {
  firstName: string | null;
  activationUrl: string;
  communityName: string | null;
}): EmailBody {
  const greeting = opts.firstName ? `${opts.firstName},` : "Hey,";
  const communityLine = opts.communityName
    ? `You're in ${opts.communityName} on Dad Edge.`
    : "You're in on Dad Edge.";
  const text = `${greeting}

${communityLine}

Set your password and sign in:
${opts.activationUrl}

The link is short-lived. If it expires, ask your admin for a fresh one.

Dad Edge`;
  const html = htmlShell(
    "Set your password.",
    `<p>${greeting}</p>
     <p>${communityLine}</p>
     <p>Set your password and sign in.</p>
     ${ctaButton(opts.activationUrl, "Set my password")}
     <p style="color:#9aa7b4;font-size:12px;">The link is short-lived. If it expires, ask your admin for a fresh one.</p>`,
  );
  return {
    subject: opts.communityName
      ? `Set your password for ${opts.communityName}`
      : "Set your password",
    text,
    html,
  };
}

export function passwordResetEmail(opts: {
  firstName: string | null;
  resetUrl: string;
}): EmailBody {
  const greeting = opts.firstName ? `${opts.firstName},` : "Hey,";
  const text = `${greeting}

You (or someone with your email) asked to reset your Dad Edge password. Use the link below within an hour:

${opts.resetUrl}

If this wasn't you, ignore the email. Your password won't change unless you use the link.

Dad Edge`;
  const html = htmlShell(
    "Reset your password.",
    `<p>${greeting}</p>
     <p>You (or someone with your email) asked to reset your Dad Edge password. Use the link below within an hour.</p>
     ${ctaButton(opts.resetUrl, "Reset my password")}
     <p style="color:#9aa7b4;font-size:12px;">If this wasn't you, ignore the email. Your password won't change unless you use the link.</p>`,
  );
  return {
    subject: "Reset your Dad Edge password",
    text,
    html,
  };
}
