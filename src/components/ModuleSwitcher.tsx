"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePrefs } from "@/lib/prefs";
import { accessibleModules, canReachHub, roleHome } from "@/lib/constants";
import { isDesktop } from "@/lib/timetracker/desktop";
import type { UserRole } from "@/lib/types";

// ============================================================
// Two ways to move between modules once you're inside one (D-054/D-055):
// jump straight to the other module, or step back to /home to pick from
// there. Same gate for both — neither exists for a 1-module user, and the
// driver exception is absolute regardless of module_access.
//
// D-056 split that single gate into two, because it stopped being one
// question: "is there another module to jump to" (⇄) and "is there a
// reason to visit the hub" (⌂) now have different answers for a
// deliveries-only admin — nothing to switch to, but Users (a hub tool, not
// a module) still lives there. HUB_TOOLS is the same registry /home/page.tsx
// and HomeSelector read, so a tool visible to a wider audience someday
// widens who sees ⌂ automatically, with nothing here to touch.
//
// Pure presentation — no hook from either DataProvider (deliveries' or
// recruiting's). Both TopBars mount this the same way, passing plain props
// built from whatever `me`/`profile` shape each already has. That's what
// lets one component live in both route groups without pulling in anything
// D-052 deliberately kept out of recruiting (no GPS tracking, no deliveries
// realtime channels) — a component with no data of its own can't leak either.
//
// `deliveriesRole` is named that on purpose, never `role`: inside recruiting's
// own TopBar, `me.role` means recruiting_role (admin|manager|recruiter) — the
// same name collision that caused two of D-052's three bugs. This component
// only ever needs the DELIVERIES role, because that's the only thing that
// decides the driver exception, which tools are visible, and where "back to
// Deliveries" lands.
// ============================================================

interface ModuleSwitcherProps {
  /** Which module this TopBar belongs to — never appears in its own menu. */
  current: string;
  deliveriesRole: UserRole;
  moduleAccess: string[] | null | undefined;
}

export function ModuleSwitcher({ current, deliveriesRole, moduleAccess }: ModuleSwitcherProps) {
  const { lang, t } = usePrefs();
  const [open, setOpen] = useState(false);
  // Hidden entirely inside the timetracker desktop shell (D-076): its
  // Electron window has no address bar, so this switcher was the ONLY way
  // to navigate away from Track Time — which silently stops the
  // screenshot/activity capture tick loop (mounted only on /timetracker) the
  // moment you do. isDesktop() (window.ttDesktop) has no dependency on any
  // module's DataProvider, so importing it here doesn't break this
  // component's "pure presentation" shape — it's a generic "am I running
  // inside the Electron shell" check, not a timetracker-data read.
  const [desktopClient, setDesktopClient] = useState(false);
  useEffect(() => { setDesktopClient(isDesktop()); }, []);
  // The menu hangs from the button's RIGHT edge and grows leftwards — fine
  // when the switcher sits on the topbar's unwrapped first line, near the
  // right edge, but this row wraps onto its own line constantly (it's the
  // last thing to get room once the tabs don't fit), and once it does, the
  // switcher can land near the LEFT edge instead. Same flip pattern as the
  // "General ▾" menu in TopBar.tsx: measured once on open, flipped to grow
  // rightwards when there isn't room on the left (D-055 follow-up — this
  // was reported live: the menu opened mostly off-screen to the left).
  const menuRef = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState(false);
  useEffect(() => {
    if (!open) { setFlip(false); return; }
    const el = menuRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.left < 8) setFlip(true);
  }, [open]);

  const modules = accessibleModules(moduleAccess);
  const canSwitch = modules.length > 1; // algo además de Entregas a lo que saltar
  // La misma pregunta que hace /home, en el mismo sitio (D-173). Lleva dentro la excepción
  // del chofer de D-051: nunca ve ninguno de los dos controles, le den lo que le den.
  // Nada que enseñar -> no se renderiza (no "se oculta").
  if (!canReachHub({ role: deliveriesRole, module_access: moduleAccess }) || desktopClient) return null;

  const others = modules.filter((m) => m.key !== current);
  const hrefFor = (key: string, fallback: string) => (key === "deliveries" ? roleHome(deliveriesRole) : fallback);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0 }}>
      {/* Back to the hub. Visible whenever canReachHub is (the early return
          above already guarantees that), even for a 1-module admin who has
          nothing to switch to but does have Users waiting at /home. */}
      <Link
        href="/home"
        className="tab tab-icon"
        aria-label={t("Back to module picker", "Volver al selector de módulos")}
        title={t("Back to module picker", "Volver al selector de módulos")}
      >
        ⌂
      </Link>

      {canSwitch && (
        <div style={{ position: "relative" }}>
          <button
            className="tab tab-icon"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={t("Switch module", "Cambiar de módulo")}
            title={t("Switch module", "Cambiar de módulo")}
          >
            ⇄
          </button>
          {open && (
            <>
              <div style={{ position: "fixed", inset: 0, zIndex: 70 }} onClick={() => setOpen(false)} />
              <div
                ref={menuRef}
                className="col-menu"
                style={{
                  zIndex: 71,
                  minWidth: 200,
                  ...(flip ? { left: 0, right: "auto" } : { right: 0, left: "auto" }),
                }}
                role="menu"
              >
                {others.map((m) => (
                  <Link
                    key={m.key}
                    href={hrefFor(m.key, m.href)}
                    role="menuitem"
                    className="col-opt"
                    style={{ textDecoration: "none" }}
                    onClick={() => setOpen(false)}
                  >
                    {m.emoji} {lang === "es" ? m.label_es : m.label_en}
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
