"use client";

import { usePathname } from "next/navigation";
import { SideNav } from "@/components/shell/nav";
import { ItcStageNav } from "./itc-stage-nav";

/**
 * Left-rail content switcher on ITC pages.
 *
 * - On `/itc/[mapId]/...` → render `ItcStageNav` for the current map.
 * - Everywhere else on ITC (landing, admin, no-access, login) → render
 *   the normal main-app `SideNav` so the coachee's mental model
 *   "ITC is a section of Dad Edge OS" holds and the same routes are
 *   one click away.
 *
 * Route segments after `/itc/` that AREN'T map ids are enumerated in
 * RESERVED so a future admin subroute (e.g. `/itc/settings`) doesn't
 * get mistaken for a map id and try to fetch a non-existent map.
 */
const RESERVED = new Set(["admin", "login", "logout", "no-access"]);

export function ItcNavSwitcher({
  isPlatformAdmin,
  unreadMessageThreads,
}: {
  isPlatformAdmin: boolean;
  unreadMessageThreads: number;
}) {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  // ["itc", "<mapId or reserved>", ...]
  const second = segments[1];
  const isMapRoute = Boolean(second) && !RESERVED.has(second!);

  if (isMapRoute) {
    return <ItcStageNav mapId={second!} />;
  }
  return (
    <SideNav
      isPlatformAdmin={isPlatformAdmin}
      unreadMessageThreads={unreadMessageThreads}
    />
  );
}
