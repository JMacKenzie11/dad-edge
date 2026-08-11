/**
 * Hardcoded admin list for the ITC beta. Emails are compared case-insensitively.
 * Formal roles/RBAC come later — for now, anyone in this list can view every
 * participant's map. Never edits, only views.
 */
export const ITC_ADMIN_EMAILS: readonly string[] = [
  "larryh@thedadedge.com",
  "jasonm@thedadedge.com",
  "march@thedadedge.com",
];

export function isItcAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return ITC_ADMIN_EMAILS.some((a) => a.toLowerCase() === normalized);
}
