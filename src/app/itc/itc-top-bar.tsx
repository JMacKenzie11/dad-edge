import Link from "next/link";
import Image from "next/image";

/**
 * Slim top strip that appears on every /itc/* page above whatever
 * chrome that page owns. Serves one purpose: an unambiguous "you can
 * get out of here" affordance back to the main app so the ITC
 * workspace doesn't feel like a trap.
 *
 * Deliberately excludes the notification bell, messages icon, and
 * avatar menu that live on the main-app AppHeader. ITC is deep
 * coaching work — an unread-messages badge pulsing in the corner
 * during a vulnerable "hidden competing commitment" moment is the
 * exact interruption the workspace framing exists to prevent. The
 * coachee sees new activity when they exit; that's a feature.
 *
 * Anchor destination is /goals rather than /today: goals is where
 * the improvement map surfaces in the main app, so the mental
 * model "I was working on my improvement goal, now I'm back where
 * that goal lives" holds.
 */
export function ItcTopBar() {
  return (
    <div className="border-b border-[color:var(--color-border)] bg-[color:var(--color-bg)]">
      <div className="mx-auto max-w-6xl px-4 h-10 flex items-center">
        <Link
          href="/goals"
          className="inline-flex items-center gap-2 text-[11px] font-heading tracking-widest text-[color:var(--color-text-muted)] hover:text-white transition-colors"
        >
          <span aria-hidden>←</span>
          <Image
            src="/brand/mark-white.png"
            alt=""
            width={16}
            height={16}
            className="opacity-80"
          />
          <span>DAD EDGE OS</span>
        </Link>
      </div>
    </div>
  );
}
