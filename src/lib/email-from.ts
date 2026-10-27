/** The name inboxes show for every email the app sends. */
export const SENDER_NAME = "Dad Edge Operating System";

/**
 * The From header for Resend. RESEND_FROM in production is a bare address
 * (no-reply@dadedgeoperatingsystem.com), which inboxes show as is; this
 * puts the app's name in front of it. A value that already names itself
 * ("Name <address>") is kept.
 */
export function fromHeader(raw: string | undefined): string {
  const value = (raw ?? "").trim() || "noreply@dadedge.local";
  return value.includes("<") ? value : `${SENDER_NAME} <${value}>`;
}
