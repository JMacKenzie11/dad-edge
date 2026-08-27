import type { MetadataRoute } from "next";

/**
 * Web App Manifest — powers Add-to-Home-Screen on Android / Chrome
 * (iOS reads separate `apple-mobile-web-app-*` meta tags + the
 * pre-composed `/apple-icon` PNG; see src/app/apple-icon.tsx and
 * the appleWebApp block in src/app/layout.tsx).
 *
 * Black background_color + theme_color matches the app's dark
 * chrome so the launch splash and system toolbar don't flash white
 * before the app paints.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dad Edge OS",
    short_name: "Dad Edge",
    description:
      "Daily check-ins, day-anchored missions, community leaderboards.",
    start_url: "/today",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      {
        src: "/icon",
        sizes: "32x32",
        type: "image/png",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
      },
      // Android uses these for the splash + launcher — same 180×180
      // source scales cleanly for the sizes home-screen launchers ask
      // for. "any maskable" lets Android crop it into shaped launcher
      // icons without losing the mark.
      {
        src: "/apple-icon",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/apple-icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
