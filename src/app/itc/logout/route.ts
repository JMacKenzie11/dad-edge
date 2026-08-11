import { NextResponse } from "next/server";
import { clearItcSessionCookie } from "@/lib/itc/session";

export async function GET() {
  await clearItcSessionCookie();
  return NextResponse.redirect(new URL("/itc/login", process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3300"));
}
