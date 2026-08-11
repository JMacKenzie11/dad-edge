import { NextRequest, NextResponse } from "next/server";

/**
 * Cron endpoints are protected by a bearer secret. Vercel Cron sets it via the
 * `Authorization` header when we set CRON_SECRET in the deployment env.
 * In dev the same secret can be sent manually with `curl -H "Authorization: Bearer $CRON_SECRET"`.
 */
export function assertCronAuth(req: NextRequest): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // No secret configured — only allow in dev, never in prod.
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
    }
    return null;
  }
  const header = req.headers.get("authorization") ?? "";
  if (header !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export type JobResult = {
  job: string;
  ok: boolean;
  processed?: number;
  sent?: number;
  errors?: string[];
  detail?: Record<string, unknown>;
};
