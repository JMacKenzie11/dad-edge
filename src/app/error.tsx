"use client";

import { AppError } from "@/components/app-error";

/** A crash inside any page. The root layout still renders around it. */
export default function PageError({ error }: { error: Error & { digest?: string } }) {
  return <AppError error={error} />;
}
