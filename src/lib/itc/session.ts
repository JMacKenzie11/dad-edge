import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * ITC demo session — deliberately isolated from Supabase auth.
 *
 * Cookie name: `itc_session` (distinct from Supabase's `sb-*` cookies).
 * Cookie path: `/itc`, so browsers do not send it to any other route.
 * Payload:     `{ pid: <participant_uuid>, exp: <unix_seconds> }`
 * Signed:      HMAC-SHA256 over the payload using ITC_SESSION_SECRET.
 *
 * This session grants access ONLY to /itc/* server code. Main app auth
 * uses Supabase and does not consult this cookie. See DECISIONS.md
 * "ITC Addendum" for the isolation contract.
 */

export const ITC_COOKIE_NAME = "itc_session";
// Path was "/itc" originally for defense-in-depth (browser wouldn't send the
// cookie to non-/itc routes). In practice that broke server-action POSTs on
// Vercel — cookie reached the /itc GET but not the /itc POST for the action.
// Widened to "/". Isolation still holds: (a) main middleware never consults
// this cookie, (b) every itc_* table has RLS deny-all. See docs/itc-isolation.md.
export const ITC_COOKIE_PATH = "/";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

type ItcSessionPayload = {
  pid: string;
  exp: number;
};

function getSecret(): string {
  const secret = process.env.ITC_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "ITC_SESSION_SECRET is missing or too short (need >= 32 chars).",
    );
  }
  return secret;
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64");
}

function sign(payload: string): string {
  return b64url(createHmac("sha256", getSecret()).update(payload).digest());
}

export function encodeItcSession(participantId: string): string {
  const payload: ItcSessionPayload = {
    pid: participantId,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function decodeItcSession(raw: string | undefined): ItcSessionPayload | null {
  if (!raw) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;

  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(b64urlDecode(body).toString("utf8"));
  } catch {
    return null;
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as ItcSessionPayload).pid !== "string" ||
    typeof (parsed as ItcSessionPayload).exp !== "number"
  ) {
    return null;
  }

  const payload = parsed as ItcSessionPayload;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export async function readItcSession(): Promise<ItcSessionPayload | null> {
  const store = await cookies();
  return decodeItcSession(store.get(ITC_COOKIE_NAME)?.value);
}

export async function setItcSessionCookie(participantId: string): Promise<void> {
  const store = await cookies();
  store.set(ITC_COOKIE_NAME, encodeItcSession(participantId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: ITC_COOKIE_PATH,
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearItcSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(ITC_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: ITC_COOKIE_PATH,
    maxAge: 0,
  });
}

export function itcDemoAuthEnabled(): boolean {
  return process.env.ITC_DEMO_AUTH === "1";
}
