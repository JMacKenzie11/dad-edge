import { test as base, expect, type Browser, type Page } from "@playwright/test";

/**
 * One signed-in page per role. Accounts come from .env.local:
 *   E2E_<ROLE>_EMAIL / E2E_<ROLE>_PASSWORD
 * and are created on the dev database by `npm run seed:e2e` (docs/e2e.md).
 */
export const ROLES = ["member", "leader", "admin", "coachee"] as const;
export type Role = (typeof ROLES)[number];

export function credentialsFor(role: Role): { email: string; password: string } {
  const emailVar = `E2E_${role.toUpperCase()}_EMAIL`;
  const passwordVar = `E2E_${role.toUpperCase()}_PASSWORD`;
  const email = process.env[emailVar];
  const password = process.env[passwordVar];
  const missing = [!email && emailVar, !password && passwordVar].filter(Boolean);
  if (missing.length) {
    throw new Error(
      `Missing ${missing.join(" and ")} in .env.local. Run \`npm run seed:e2e\` on the dev database and copy the lines it prints. See docs/e2e.md.`,
    );
  }
  return { email: email!, password: password! };
}

export async function signIn(page: Page, role: Role): Promise<void> {
  const { email, password } = credentialsFor(role);
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 }),
    page.keyboard.press("Enter"),
  ]);
}

async function signedInPage(browser: Browser, role: Role, use: (p: Page) => Promise<void>) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, role);
  await use(page);
  await context.close();
}

export const test = base.extend<{ asMember: Page; asLeader: Page; asAdmin: Page; asCoachee: Page }>({
  asMember: async ({ browser }, use) => signedInPage(browser, "member", use),
  asLeader: async ({ browser }, use) => signedInPage(browser, "leader", use),
  asAdmin: async ({ browser }, use) => signedInPage(browser, "admin", use),
  asCoachee: async ({ browser }, use) => signedInPage(browser, "coachee", use),
});

export { expect };
