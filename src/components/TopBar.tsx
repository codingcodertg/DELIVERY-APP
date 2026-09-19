"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { TABS, ROLE_INFO, ROLE_ORDER, canOpenTab, roleHome, roleLabel } from "@/lib/constants";
import { opcionesDelMenuDeCuenta } from "@/lib/account-menu";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { avatarColor, awaitingDriver, initials } from "@/lib/utils";
import { HubHomeLink } from "@/components/HubHomeLink";
import { BotonRecargar } from "@/components/BotonRecargar";
import { NotificationBell } from "@/components/NotificationBell";
import { OfflineBanner } from "@/components/OfflineBanner";
import { AppUpdateBanner } from "@/components/AppUpdateBanner";
import { PendingDeadlineWatcher } from "@/components/PendingDeadlineWatcher";
import { SwitchUserPanel } from "@/components/SwitchUserPanel";
import type { Profile, UserRole } from "@/lib/types";

/** Los botones del aviso de modo enseñanza, «Salir» y «Reiniciar práctica», con un mismo estilo
 *  escrito una vez: dos botones iguales no son dos decisiones de color (`inline-colors.test.ts`).
 *  (`FONDO_BOTON_BARRA`, el fondo del botón «Switch usuario», se fue en D-306; el botón volvió en D-NEXT sin fondo propio.) */
const BOTON_DEL_AVISO = { marginLeft: 12, background: "rgba(255,255,255,.25)", color: "#fff", padding: "2px 10px", borderRadius: 6, fontWeight: 700 } as const;

export function TopBar({ me: propMe }: { me: Profile }) {
  const pathname = usePathname();
  const router = useRouter();
  const { settings, deliveries, users, me: ctxMe, realRole, viewAs, setViewAs, teaching, setTeaching, clearTrainingData } = useData();
  // «Switch user» TAMBIÉN aquí (D-NEXT), duplicado a sabiendas del de la herramienta del hub (D-306, que sigue igual).
  // Si se puede lo dice el servidor —la bandera vive en el entorno—: `habilitado` solo se le contesta a un ADMIN REAL,
  // y nunca dentro de una suplantación (ahí la ruta contesta otra cosa, sin `habilitado`): dentro manda el botón del
  // banner, y así nunca hay dos botones de cambio a la vez. Se pregunta UNA vez, y solo si el rol es admin.
  const [puedeSwitch, setPuedeSwitch] = useState(false);
  const [switchAbierto, setSwitchAbierto] = useState(false);
  useEffect(() => {
    if (realRole !== "admin") return;
    let vivo = true;
    fetch("/api/impersonate/state?ask=switch")
      .then((r) => r.json())
      .then((d: { habilitado?: boolean }) => { if (vivo) setPuedeSwitch(d.habilitado === true); })
      .catch(() => { /* sin respuesta, el botón no aparece: la dirección segura */ });
    return () => { vivo = false; };
  }, [realRole]);
  const { lang, t } = usePrefs();
  // `me` is the EFFECTIVE user — its role follows the admin "view as" preview.
  const me = ctxMe ?? propMe;
  const [generalOpen, setGeneralOpen] = useState(false);
  // El desplegable del nombre (D-274). Sustituye a la burbuja del rol de D-089, que llevaba
  // «Salir» dentro para quien no era admin, y a la píldora «ver como» del admin, que ahora es una
  // opción más del menú. Qué opciones salen lo decide `opcionesDelMenuDeCuenta`, no esta barra.
  const [menuCuentaAbierto, setMenuCuentaAbierto] = useState(false);
  const menuCuentaRef = useRef<HTMLDivElement>(null);
  const [menuCuentaFlip, setMenuCuentaFlip] = useState(false);
  useEffect(() => {
    if (!menuCuentaAbierto) { setMenuCuentaFlip(false); return; }
    const el = menuCuentaRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.left < 8) setMenuCuentaFlip(true);
  }, [menuCuentaAbierto]);
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
  useEffect(() => { setGeneralOpen(false); setMenuCuentaAbierto(false); }, [pathname]);
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
  // La condición vive en `canOpenTab` (D-240), no aquí: es la misma pregunta que hacen
  // las páginas para decidir si se abren, y tenerla en dos sitios es como una pantalla
  // acabó dejando entrar a quien no tenía pestaña.
  const visibleTabs = TABS.filter((tb) => canOpenTab(tb.id, me));
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

  // «Ver como» sale en dos sitios —el menú, y el aviso de la barra mientras está activo— y los dos
  // hacen lo mismo: cambiar la vista y saltar a la pantalla de ese rol.
  const cambiaVista = (valor: string) => {
    const next = valor === "admin" ? null : (valor as UserRole);
    setViewAs(next);
    setMenuCuentaAbierto(false);
    router.push(roleHome(next ?? "admin"));
  };
  const opcionesDeRol = ROLE_ORDER.map((r) => (
    <option key={r} value={r}>
      {r === "admin" ? t("Me (admin)", "Yo (admin)") : roleLabel(r, lang)}
    </option>
  ));

  const reiniciaPractica = async () => {
    if (confirm(t("Discard all practice changes and reset the sandbox to the current real data?",
                  "¿Descartar todos los cambios de práctica y reiniciar el entorno con los datos reales actuales?"))) {
      await clearTrainingData();
    }
  };

  // Con el rol EFECTIVO, como la casa de `HubHomeLink`: quien no ve la casa encuentra en el menú
  // lo que antes le daba la pantalla de Cuenta.
  const opcionesMenu = opcionesDelMenuDeCuenta({ realRole, me });
  const cierraMenu = () => setMenuCuentaAbierto(false);

  return (
    <>
    <PendingDeadlineWatcher />
    <AppUpdateBanner app="deliveries" />
    <OfflineBanner />
    {teaching && (
      <div style={{ background: "var(--teaching-bg)", color: "#fff", textAlign: "center", padding: "6px 12px",
        fontSize: 12.5, fontWeight: 700, letterSpacing: ".03em" }}>
        🎓 {t("TEACHING MODE — practice data only. Real orders are hidden and untouched.",
             "MODO ENSEÑANZA — solo datos de práctica. Las órdenes reales están ocultas y no se tocan.")}
        {/* Vivía en la pantalla de Cuenta, que ya no existe (D-274). Aquí solo se ve con el modo
            encendido, que es cuando tiene sentido. */}
        <button onClick={reiniciaPractica} style={BOTON_DEL_AVISO}
          title={t("Throws away your practice changes and starts fresh from the current real data. Nothing real is affected.",
                   "Descarta tus cambios de práctica y empieza de nuevo con los datos reales actuales. Nada real se ve afectado.")}>
          🗑 {t("Reset practice", "Reiniciar práctica")}
        </button>
        <button onClick={() => setTeaching(false)} style={BOTON_DEL_AVISO}>
          {t("Exit", "Salir")}
        </button>
      </div>
    )}
    <div className="topbar">
      {/* La casa va pegada al nombre de la app (D-274), no con las pestañas. */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <h1>{settings.app_name || "RTG·HUB"}</h1>
        <HubHomeLink deliveriesRole={me.role} moduleAccess={me.module_access} />
      </div>
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
        <BotonRecargar titulo={t("Reload the app", "Recargar la app")} />
        <NotificationBell />
        {/* Tu nombre abre el menú de la cuenta (D-274). Antes llevaba a la pantalla de Cuenta y
            al lado iba la etiqueta del rol; el dueño pidió quitar las dos cosas. */}
        <div style={{ position: "relative" }}>
          <button
            className={"account-link" + (menuCuentaAbierto ? " active" : "")}
            onClick={() => setMenuCuentaAbierto((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuCuentaAbierto}
            style={{ fontSize: 12, opacity: 0.95, display: "inline-flex", alignItems: "center", gap: 6,
              padding: "4px 8px", borderRadius: 8, color: "inherit" }}
          >
            <span className="avatar sm" style={{ background: avatarColor(me.full_name || "?") }}>
              {initials(me.full_name || "?")}
            </span>
            {me.full_name} <span aria-hidden>▾</span>
          </button>
          {menuCuentaAbierto && (
            <>
              <div style={{ position: "fixed", inset: 0, zIndex: 70 }} onClick={cierraMenu} />
              <div
                ref={menuCuentaRef}
                className="col-menu"
                style={{
                  zIndex: 71,
                  minWidth: 210,
                  ...(menuCuentaFlip ? { left: 0, right: "auto" } : { right: 0, left: "auto" }),
                }}
                role="menu"
              >
                {opcionesMenu.map((o) => {
                  switch (o) {
                    case "ensenanza":
                      return (
                        <button
                          key={o}
                          className="col-opt"
                          role="menuitemcheckbox"
                          aria-checked={teaching}
                          style={{ width: "100%", textAlign: "left" }}
                          title={t(
                            "A private practice sandbox on top of the real orders: nothing you do is saved or seen by anyone else.",
                            "Un entorno de práctica privado sobre las órdenes reales: nada de lo que hagas se guarda ni lo ve nadie más.",
                          )}
                          onClick={() => { setTeaching(!teaching); cierraMenu(); }}
                        >
                          🎓 {teaching ? t("Turn teaching mode off", "Apagar modo enseñanza") : t("Teaching mode", "Modo enseñanza")}
                        </button>
                      );
                    case "vercomo":
                      return (
                        <label key={o} className="col-opt" style={{ justifyContent: "space-between" }}>
                          <span>👁 {t("View as", "Ver como")}</span>
                          <select
                            value={viewAs ?? "admin"}
                            aria-label={t("View the app as another role", "Ver la app como otro rol")}
                            onChange={(e) => cambiaVista(e.target.value)}
                            style={{ width: "auto", padding: "4px 6px", fontSize: 12.5 }}
                          >
                            {opcionesDeRol}
                          </select>
                        </label>
                      );
                    case "ajustes":
                      return (
                        <Link key={o} href="/settings" role="menuitem" className="col-opt" style={{ textDecoration: "none" }} onClick={cierraMenu}>
                          ⚙️ {t("Settings", "Ajustes")}
                        </Link>
                      );
                    case "perfil":
                      return (
                        <Link key={o} href="/home/profile" role="menuitem" className="col-opt" style={{ textDecoration: "none" }} onClick={cierraMenu}>
                          👤 {t("My profile", "Mi perfil")}
                        </Link>
                      );
                    case "tutoriales":
                      return (
                        <Link key={o} href="/home/tutorials" role="menuitem" className="col-opt" style={{ textDecoration: "none" }} onClick={cierraMenu}>
                          🎬 {t("Tutorials", "Tutoriales")}
                        </Link>
                      );
                    case "salir":
                      return (
                        <form action="/auth/signout" method="post" key={o}>
                          <button className="col-opt" type="submit" style={{ width: "100%", textAlign: "left" }} role="menuitem">
                            {t("Sign out", "Salir")}
                          </button>
                        </form>
                      );
                  }
                })}
              </div>
            </>
          )}
        </div>
        {/* Mientras el admin ve la app como otro rol, la barra lo dice (D-274). Es la píldora de
            siempre, con el mismo selector dentro, y solo existe mientras dura: fuera de eso la barra
            no lleva ninguna etiqueta de rol. Sin ella, quien olvidó que estaba previsualizando
            vería una app recortada sin nada que se lo explique. */}
        {realRole === "admin" && viewAs && (
          <label
            className="role-switch"
            style={{ background: ROLE_INFO[viewAs].color }}
            title={t("You are viewing the app as another role. Choose «Me (admin)» to go back.",
                     "Estás viendo la app como otro rol. Elige «Yo (admin)» para volver.")}
          >
            👁 {roleLabel(viewAs, lang)} <span aria-hidden>▾</span>
            <select
              value={viewAs}
              aria-label={t("View the app as another role", "Ver la app como otro rol")}
              onChange={(e) => cambiaVista(e.target.value)}
            >
              {opcionesDeRol}
            </select>
          </label>
        )}
        {/* «Switch usuario» vivió aquí de D-247 a D-306, que lo pasó al hub. El dueño lo quiere en los DOS sitios
            («add the switch user also in the deliveries app as a duplicate»): vuelve aquí, y la herramienta del hub
            (/home/switch-user) se queda tal cual. La vista móvil NO vuelve: sigue siendo solo del hub. */}
        {realRole === "admin" && puedeSwitch && (
          <div style={{ position: "relative" }}>
            <button className="tab" onClick={() => setSwitchAbierto((v) => !v)} aria-expanded={switchAbierto}>
              ⇄ {t("Switch user", "Cambiar usuario")}
            </button>
            {switchAbierto && <SwitchUserPanel users={users} tiendas={settings.stores ?? []} onClose={() => setSwitchAbierto(false)} />}
          </div>
        )}
      </div>
    </div>
    </>
  );
}
