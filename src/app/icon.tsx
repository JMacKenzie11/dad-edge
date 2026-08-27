import { ImageResponse } from "next/og";
import fs from "node:fs";
import path from "node:path";

/**
 * Browser tab / favicon. Same black-background + centered-mark
 * treatment as `apple-icon.tsx` so it stays legible on light-themed
 * browser chrome (white mark on transparent PNG becomes invisible in
 * Safari's tab strip). 32×32 is the standard favicon size; browsers
 * will scale it up for larger contexts.
 */
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

const markPath = path.join(process.cwd(), "public", "brand", "mark-white.png");
const markDataUrl = `data:image/png;base64,${fs
  .readFileSync(markPath)
  .toString("base64")}`;

export default function Icon() {
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
          width={24}
          height={27}
          style={{ objectFit: "contain" }}
        />
      </div>
    ),
    size,
  );
}
