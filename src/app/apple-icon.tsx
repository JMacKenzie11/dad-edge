import { ImageResponse } from "next/og";
import fs from "node:fs";
import path from "node:path";

/**
 * Home-screen icon rendered when a coachee adds the app to iOS or
 * iPadOS. iOS deliberately ignores transparency on
 * `<link rel="apple-touch-icon">` sources and paints them onto a
 * white square, so we can't just point at `mark-white.png` — the
 * white logo would land invisible on a white tile. Instead we
 * compose a real 180×180 PNG here: pure-black background with the
 * mark centered on top, generated via `next/og`.
 *
 * Next.js's file-based icon convention wires this file up
 * automatically: the export is served at `/apple-icon` and the
 * <link> tag is injected into <head> without any layout changes.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Read the source mark once at module load, base64-encode, and
// pass as a data URL inside the JSX. Simpler than an HTTP fetch
// (which `next/og` would try if given a bare path) and works
// identically on dev + build.
const markPath = path.join(process.cwd(), "public", "brand", "mark-white.png");
const markDataUrl = `data:image/png;base64,${fs
  .readFileSync(markPath)
  .toString("base64")}`;

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#000000",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={markDataUrl}
          alt=""
          width={128}
          height={143}
          style={{ objectFit: "contain" }}
        />
      </div>
    ),
    size,
  );
}
