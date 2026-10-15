"use client";

import { AppError } from "@/components/app-error";
import { fontBody, fontHeading } from "@/lib/fonts";
import "./globals.css";

/**
 * A crash the page-level boundary can't catch, including the router
 * itself failing on a response from a newer deploy (FM-14). It replaces
 * the root layout, so it brings its own <html> and <body>.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en" className={`${fontHeading.variable} ${fontBody.variable}`}>
      <body>
        <div className="brand-texture" aria-hidden />
        <div className="relative z-10">
          <AppError error={error} />
        </div>
      </body>
    </html>
  );
}
