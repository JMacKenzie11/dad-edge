import { NextResponse } from "next/server";
import { clearItcSessionCookie } from "@/lib/itc/session";

// POST-only: GET would let Next.js <Link> prefetch silently clear the session
// cookie whenever a page containing a sign-out link renders. See docs/itc-isolation.md.
export async function POST() {
  await clearItcSessionCookie();
  return NextResponse.redirect(
    new URL("/itc/login", process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3300"),
    { status: 303 },
  );
}
