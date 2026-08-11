import { Archivo, Inter } from "next/font/google";

/**
 * Fallback fonts wired via next/font. When Adobe Fonts (Trade Gothic Bold + Proxima Nova)
 * licensing is confirmed, replace these two loaders with the Adobe Fonts <link> tag or
 * localFont() calls — the CSS var names in globals.css do not change, so components
 * do not need to be touched.
 */
export const fontHeading = Archivo({
  subsets: ["latin"],
  weight: ["700", "800", "900"],
  variable: "--font-heading-loaded",
  display: "swap",
});

export const fontBody = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body-loaded",
  display: "swap",
});
