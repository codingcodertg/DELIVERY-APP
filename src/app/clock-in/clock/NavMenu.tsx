"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import EnableNotifications from "./EnableNotifications";
import SignOutButton from "./SignOutButton";
import { t, type Lang } from "@/lib/clockin/i18n";

export default function NavMenu({
  lang,
  isManager,
  isOwner = false,
  unread,
}: {
  lang: Lang;
  isManager: boolean;
  isOwner?: boolean;
  unread: number;
}) {
  const tr = t(lang);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the menu when the route actually changes, NOT in each link's onClick.
  // Closing during the tap unmounted the link mid-navigation, and on mobile that
  // race is why a menu link sometimes needed two or three taps to go through.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const links: { href: string; label: string; badge?: number }[] = [
    // Home is the top-left 🏠 button on every page, so it's not repeated here.
    { href: "/clock-in/notifications", label: tr.notifications, badge: unread },
  ];
  // My Schedule / Daily Notes / My Accountability are tiles on the home screen —
  // don't repeat them here. Owners have no personal screens at all (Account lives
  // under Settings for them).
  if (!isOwner) {
    links.push(
      { href: "/clock-in/time-off", label: tr.timeOff },
      { href: "/clock-in/account", label: tr.account },
    );
  }
  // Manager/owner tools.
  if (isManager) {
    links.push({ href: "/clock-in/coverage", label: tr.teamCoverage });
    links.push({ href: "/clock-in/dashboard", label: tr.mgr.dashboard });
    links.push({ href: "/clock-in/settings", label: tr.mgr.settings });
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Menu"
        data-tour="menu"
        className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-800 hover:border-emerald-400 transition-colors"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="17" x2="20" y2="17" />
        </svg>
        {unread > 0 && <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-red-600 border-2 border-white dark:border-zinc-950" />}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-60 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl z-40 p-1.5 flex flex-col">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                {l.label}
                {l.badge ? (
                  <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-red-600 text-white text-xs font-semibold">
                    {l.badge > 9 ? "9+" : l.badge}
                  </span>
                ) : null}
              </Link>
            ))}
            <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
            <div className="px-3.5 py-2 flex items-center justify-between">
              <EnableNotifications lang={lang} />
            </div>
            <div className="px-3.5 py-2">
              <SignOutButton />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
