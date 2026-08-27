import type { Metadata, Viewport } from "next";
import { fontHeading, fontBody } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  // "Dad Edge OS" everywhere the user-facing brand shows up. iOS
  // Safari falls back to <title> if it doesn't pick up
  // apple-mobile-web-app-title, and Add-to-Home-Screen defaults to
  // <title> when creating the shortcut label. Keep them aligned.
  title: "Dad Edge OS",
  description: "Daily check-ins, day-anchored missions, community leaderboards.",
  // icon.tsx and apple-icon.tsx (both file-based routes in this dir)
  // supply the actual PNGs — Next.js auto-injects the <link> tags.
  // manifest.ts provides the Android/Chrome web-app manifest.
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    // Title shown under the icon when added to iOS home screen.
    // Kept short so it doesn't truncate at 12 chars on the launcher.
    title: "Dad Edge OS",
    // Black-translucent lets our own dark chrome show through the
    // notch area when launched in standalone mode from the home
    // screen (matches the black-first design across the app).
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  // Matches manifest.theme_color + background_color so the browser
  // toolbar and iOS standalone launch splash stay black instead of
  // flashing white before the app paints.
  themeColor: "#000000",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fontHeading.variable} ${fontBody.variable}`}>
      <body>
        <div className="brand-texture" aria-hidden />
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
