"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { TABS, ROLE_INFO, ROLE_ORDER, extraCaps, roleHome, roleLabel } from "@/lib/constants";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { avatarColor, awaitingDriver, initials } from "@/lib/utils";
import { ModuleSwitcher } from "@/components/ModuleSwitcher";
import { NotificationBell } from "@/components/NotificationBell";
import { OfflineBanner } from "@/components/OfflineBanner";
import { AppUpdateBanner } from "@/components/AppUpdateBanner";
import { PendingDeadlineWatcher } from "@/components/PendingDeadlineWatcher";
import type { Profile, UserRole } from "@/lib/types";

export function TopBar({ me: propMe }: { me: Profile }) {
  const pathname = usePathname();
  const router = useRouter();
  const { settings, deliveries, me: ctxMe, realRole, viewAs, setViewAs, teaching, setTeaching } = useData();
  const { lang, t } = usePrefs();
  // `me` is the EFFECTIVE user — its role follows the admin "view as" preview.
  const me = ctxMe ?? propMe;
  const role = ROLE_INFO[me.role];
  const [generalOpen, setGeneralOpen] = useState(false);
  // Non-admin's role badge (D-089): Sign out lives inside it as a dropdown,
  // same as admin's badge already doubles as the role-switcher — one bubble,
  // not a bubble plus a separate button next to it. Admin is EXCLUDED on
  // purpose (confirmed with the user): their badge is already the "view as"
  // switcher, and mixing Sign out into that dropdown would blur two
  // different jobs into one control.
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const roleMenuRef = useRef<HTMLDivElement>(null);
  const [roleMenuFlip, setRoleMenuFlip] = useState(false);
  useEffect(() => {
    if (!roleMenuOpen) { setRoleMenuFlip(false); return; }
    const el = roleMenuRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.left < 8) setRoleMenuFlip(true);
  }, [roleMenuOpen]);
  // The menu hangs from the button's RIGHT edge and grows leftwards, which
  // runs it off the window whenever the button sits near the left edge — and
  // on a wrapped tab row it always does. Measured once on open and flipped to
  // grow rightwards instead when there isn't room.
  const generalMenuRef = useRef<HTMLDivElement>(null);
  const [generalFlip, setGeneralFlip] = useState(false);
  useEffect(() => {
    if (!generalOpen) { setGeneralFlip(false); return; }
    const el = generalMenuRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // 8px so it never sits flush against the edge either.
    if (r.left < 8) setGeneralFlip(true);
  }, [generalOpen]);
  // Navigating away closes the menu (covers back/forward too).
  useEffect(() => { setGeneralOpen(false); setRoleMenuOpen(false); }, [pathname]);

  // Dispatch nudge (#29): how many orders due today/tomorrow still have no
  // driver — shown as a badge on the Map tab for the roles that assign drivers.
  const dispatchRole = me.role === "admin" || me.role === "manager" || me.role === "logistics";
  const unassignedDue = (() => {
    if (!dispatchRole) return 0;
    const now = new Date();
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const today = iso(now);
    const tomorrow = iso(new Date(now.getTime() + 86400000));
    return deliveries.filter((d) =>
      awaitingDriver(d) &&
      (d.delivery_date === today || d.delivery_date === tomorrow),
    ).length;
  })();

  // Visible by role, or unlocked by a capability an admin granted this
  // INDIVIDUAL beyond what their role already gives them — NOT just because
  // their role happens to carry that capability (e.g. warehouse has the
  // "deliver" capability so fulfillment actions work, but that alone shouldn't
  // surface the Driver tab).
  const visibleTabs = TABS.filter(
    (tb) => !tb.roles || tb.roles.includes(me.role) || (tb.cap ? extraCaps(me).includes(tb.cap) : false),
  );
  const mainTabs = visibleTabs.filter((tb) => tb.group !== "general");
  const generalTabs = visibleTabs.filter((tb) => tb.group === "general");

  // Match the exact route or a sub-route — never a prefix of another tab
  // (e.g. "/accounts" must not light up the "/account" tab).
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  // Warehouse and Driver each work entirely inside their own screen, so for
  // those roles that screen simply IS their orders and is labelled as such.
  // An admin (who sees every tab) keeps the role names, otherwise they'd get
  // three tabs all called "Orders".
  const tabLabel = (tb: (typeof TABS)[number]) => {
    if ((tb.id === "warehouse" && me.role === "warehouse") || (tb.id === "driver" && me.role === "driver")) {
      return t("📋 Orders", "📋 Órdenes");
    }
    return lang === "es" ? tb.label_es : tb.label;
  };

  return (
    <>
    <PendingDeadlineWatcher />
    <AppUpdateBanner app="deliveries" />
    <OfflineBanner />
    {teaching && (
      <div style={{ background: "#7c3aed", color: "#fff", textAlign: "center", padding: "6px 12px",
        fontSize: 12.5, fontWeight: 700, letterSpacing: ".03em" }}>
        🎓 {t("TEACHING MODE — practice data only. Real orders are hidden and untouched.",
             "MODO ENSEÑANZA — solo datos de práctica. Las órdenes reales están ocultas y no se tocan.")}
        <button onClick={() => setTeaching(false)}
          style={{ marginLeft: 12, background: "rgba(255,255,255,.25)", color: "#fff", padding: "2px 10px", borderRadius: 6, fontWeight: 700 }}>
          {t("Exit", "Salir")}
        </button>
      </div>
    )}
    <div className="topbar">
      <h1>{settings.app_name || "RTG·HUB"}</h1>
      {/* minWidth: 0 overrides the flex default (min-width: auto), which
          sizes a flex item to its widest unbreakable descendant — here the
          account link's full name. Without it, this row refuses to shrink
          below that width, and .tabs (its sibling, competing for the same
          line) gets pushed past the viewport instead of wrapping (D-054
          follow-up: adding the module switcher's button was what finally
          tipped a multi-module admin's already-full tab row over the edge,
          but the missing min-width was the real, preexisting cause). */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
        <div className="tabs">
          {mainTabs.map((tb) => (
            <Link key={tb.id} href={tb.href} className={"tab " + (isActive(tb.href) ? "active" : "")} style={{ position: "relative" }}>
              {tabLabel(tb)}
              {tb.id === "map" && unassignedDue > 0 && (
                <span
                  title={t(`${unassignedDue} order(s) due today/tomorrow with no driver`, `${unassignedDue} orden(es) para hoy/mañana sin chofer`)}
                  style={{ marginLeft: 6, background: "var(--amber, #e9a13b)", color: "#fff", borderRadius: 999, padding: "0 6px", fontSize: 11, fontWeight: 800, lineHeight: "16px", display: "inline-block", minWidth: 16, textAlign: "center" }}
                >
                  {unassignedDue}
                </span>
              )}
            </Link>
          ))}
          {/* The back-office screens live behind one "General" menu so the bar
              stays about the day's work. With only one of them visible there's
              nothing to group, so it just renders as its own tab. */}
          {generalTabs.length === 1 && (
            <Link href={generalTabs[0].href} className={"tab " + (isActive(generalTabs[0].href) ? "active" : "")}>
              {tabLabel(generalTabs[0])}
            </Link>
          )}
          {generalTabs.length > 1 && (
            <div style={{ position: "relative" }}>
              <button
                className={"tab " + (generalTabs.some((g) => isActive(g.href)) ? "active" : "")}
                onClick={() => setGeneralOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={generalOpen}
              >
                ☰ {t("General", "General")} <span aria-hidden>▾</span>
              </button>
              {generalOpen && (
                <>
                  {/* Click anywhere else to dismiss. */}
                  <div style={{ position: "fixed", inset: 0, zIndex: 70 }} onClick={() => setGeneralOpen(false)} />
                  <div
                    ref={generalMenuRef}
                    className="col-menu"
                    style={{
                      zIndex: 71,
                      minWidth: 190,
                      ...(generalFlip ? { left: 0, right: "auto" } : { right: 0, left: "auto" }),
                    }}
                    role="menu"
                  >
                    {generalTabs.map((tb) => (
                      <Link
                        key={tb.id}
                        href={tb.href}
                        role="menuitem"
                        // No `color: inherit` here — it would pick up the dark
                        // topbar's white text and vanish against the menu's
                        // light card. .col-opt already sets the readable color.
                        className="col-opt"
                        style={{
                          textDecoration: "none",
                          fontWeight: isActive(tb.href) ? 700 : undefined,
                          background: isActive(tb.href) ? "var(--accent-soft)" : undefined,
                        }}
                        onClick={() => setGeneralOpen(false)}
                      >
                        {tabLabel(tb)}
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <ModuleSwitcher current="deliveries" deliveriesRole={me.role} moduleAccess={me.module_access} />
        <NotificationBell />
        {/* Your name + avatar is the entry to the account view (replaces the
            old "Account" nav tab). Lights up like a tab when on /account. */}
        <Link
          href="/account"
          title={t("Account & preferences", "Cuenta y preferencias")}
          className={"account-link" + (pathname === "/account" || pathname.startsWith("/account/") ? " active" : "")}
          style={{ fontSize: 12, opacity: 0.95, display: "inline-flex", alignItems: "center", gap: 6,
            padding: "4px 8px", borderRadius: 8, textDecoration: "none", color: "inherit" }}
        >
          <span className="avatar sm" style={{ background: avatarColor(me.full_name || "?") }}>
            {initials(me.full_name || "?")}
          </span>
          {me.full_name}
        </Link>
        {/* The role tag beside the name. For the real admin it doubles as the
            "view as" role switcher (replaces the old 👁 dropdown); the visible
            pill IS the dropdown. Everyone else sees a static role badge. */}
        {realRole === "admin" ? (
          <label
            className="role-switch"
            style={{ background: role.color }}
            title={t("Preview the app as another role (admin only)", "Previsualiza la app como otro rol (solo admin)")}
          >
            {viewAs ? "👁 " : ""}{roleLabel(me.role, lang)} <span aria-hidden>▾</span>
            <select
              value={viewAs ?? "admin"}
              aria-label={t("View the app as another role", "Ver la app como otro rol")}
              onChange={(e) => {
                const next = e.target.value === "admin" ? null : (e.target.value as UserRole);
                setViewAs(next);
                // Jump straight to the previewed role's own view.
                router.push(roleHome(next ?? "admin"));
              }}
            >
              {ROLE_ORDER.map((r) => (
                <option key={r} value={r}>
                  {r === "admin" ? t("Me (admin)", "Yo (admin)") : roleLabel(r, lang)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          role && (
            <div style={{ position: "relative" }}>
              <button
                className="sema"
                style={{ background: role.color, color: "#fff", border: 0, cursor: "pointer" }}
                onClick={() => setRoleMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={roleMenuOpen}
              >
                {roleLabel(me.role, lang)} <span aria-hidden>▾</span>
              </button>
              {roleMenuOpen && (
                <>
                  <div style={{ position: "fixed", inset: 0, zIndex: 70 }} onClick={() => setRoleMenuOpen(false)} />
                  <div
                    ref={roleMenuRef}
                    className="col-menu"
                    style={{
                      zIndex: 71,
                      minWidth: 140,
                      ...(roleMenuFlip ? { left: 0, right: "auto" } : { right: 0, left: "auto" }),
                    }}
                    role="menu"
                  >
                    <form action="/auth/signout" method="post">
                      <button className="col-opt" type="submit" style={{ width: "100%", textAlign: "left", background: "none", border: 0 }} role="menuitem">
                        {t("Sign out", "Salir")}
                      </button>
                    </form>
                  </div>
                </>
              )}
            </div>
          )
        )}
        {realRole === "admin" && (
          <form action="/auth/signout" method="post">
            <button className="tab" type="submit" style={{ background: "rgba(255,255,255,.1)" }}>
              {t("Sign out", "Salir")}
            </button>
          </form>
        )}
      </div>
    </div>
    </>
  );
}
