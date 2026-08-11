import type { Metadata } from "next";
import { fontHeading, fontBody } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "BRAVE MAN OS",
  description: "Daily check-ins, day-anchored missions, community leaderboards.",
  icons: {
    icon: "/brand/mark-white.png",
    apple: "/brand/mark-white.png",
  },
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
