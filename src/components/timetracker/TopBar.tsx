"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { MANAGER_TABS, TABS } from "@/lib/timetracker/constants";
import { useData } from "@/lib/timetracker-data-provider";
import { getLang, setLang, useT } from "@/lib/timetracker/i18n";
import { usePrefs } from "@/lib/prefs";
import { NotificationBell } from "@/components/timetracker/NotificationBell";
import { ModuleSwitcher } from "@/components/ModuleSwitcher";
import { TtCheckUpdateLink } from "@/components/timetracker/UpdateBanner";
import type { UserRole } from "@/lib/types";

// deliveriesRole/moduleAccess threaded through separately from `me`
// (timetracker's own Employee type, where `role` means timetracker_role) —
// same pattern recruiting/TopBar.tsx already uses, same reason: `me.role`
// inside this module must never collide with the deliveries role (D-052's
// #1/#2 bug class).
export function TopBar({ deliveriesRole, moduleAccess }: { deliveriesRole: UserRole; moduleAccess: string[] | null | undefined }) {
  const pathname = usePathname();
  const { me, settings } = useData();
  const t = useT();
  // Shared with deliveries/recruiting (usePrefs(), not timetracker's own
  // useT() — theme is a container-wide concern, D-080). Nothing here used
  // to expose a way to change it; the desktop shell now defaults to dark
  // (layout.tsx's inline theme script + prefs.tsx's defaultTheme()), but
  // this toggle lets anyone — web or desktop — switch either way.
  const { theme, toggleTheme } = usePrefs();
  // useT()'s own subscription already re-renders this component on any
  // setLang() call; this local state just remembers which icon to show.
  const [lang, setLangState] = useState(getLang());
  const tabs = me.role === "admin" ? MANAGER_TABS : TABS;

  return (
    <div className="topbar">
      <div className="brand">{settings.appName || "TimeTracker"}</div>
      <div className="row" style={{ alignItems: "center", flexWrap: "wrap" }}>
        <div className="tabs">
          {tabs.map((tb, i) => {
            const active = tb.href === "/timetracker" ? pathname === "/timetracker" : pathname.startsWith(tb.href);
            // For an admin, MANAGER_TABS packs 10 manager screens ahead of
            // the 5 personal ones everyone gets — a thin divider marks
            // where "manager tools" ends and "my own stuff" begins, so 15
            // flat tabs don't read as one undifferentiated wall.
            const startsPersonal = tb.id === "track" && i > 0;
            return (
              <span key={tb.id} style={{ display: "inline-flex", alignItems: "center" }}>
                {startsPersonal && <span style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,.15)", margin: "0 6px" }} />}
                <Link href={tb.href} className={active ? "active" : ""}>
                  {t("tab." + tb.id)}
                </Link>
              </span>
            );
          })}
        </div>
        <ModuleSwitcher current="timetracker" deliveriesRole={deliveriesRole} moduleAccess={moduleAccess} />
        <span style={{ fontSize: 12, opacity: 0.8 }} className="nowrap">{me.fullName}</span>
        <span className="chip" style={{ background: "rgba(255,255,255,.18)", color: "#fff" }}>
          {me.role === "admin" ? t("shell.manager") : t("shell.employee")}
        </span>
        <NotificationBell />
        <button
          className="btn-ghost btn-sm"
          style={{ background: "rgba(255,255,255,.1)", color: "#fff" }}
          onClick={() => { const next = lang === "es" ? "en" : "es"; setLang(next); setLangState(next); }}
          title={t("lang.label")}
        >
          {lang === "es" ? "🇬🇧 EN" : "🇪🇸 ES"}
        </button>
        <button
          className="btn-ghost btn-sm"
          style={{ background: "rgba(255,255,255,.1)", color: "#fff" }}
          onClick={toggleTheme}
          title={theme === "dark" ? t("shell.lightMode") : t("shell.darkMode")}
        >
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
        <TtCheckUpdateLink />
        <form action="/auth/signout" method="post">
          <button className="btn-ghost btn-sm" style={{ background: "rgba(255,255,255,.1)", color: "#fff" }} type="submit">{t("shell.signOut")}</button>
        </form>
      </div>
    </div>
  );
}
