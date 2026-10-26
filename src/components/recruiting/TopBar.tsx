"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { esGerenteDeTienda } from "@/lib/recruiting/vista-del-gerente";
import { NOMBRE_DEL_GRUPO, menusDeRrhh, pestanaActiva, type GrupoDeMenu } from "@/lib/recruiting/menus-rrhh";
import { TABS, ROLE_INFO } from "@/lib/recruiting/constants";
import { useData } from "@/lib/recruiting-data-provider";
import { usePrefs } from "@/lib/prefs";
import { GlobalSearch } from "@/components/recruiting/GlobalSearch";
import { ModuleSwitcher } from "@/components/ModuleSwitcher";
import { BarraDeApp } from "@/components/BarraDeApp";
import { OPCIONES_DEL_MENU_RRHH } from "@/lib/account-menu";
import { MenuDeCuenta, OpcionPersonalizar, OpcionSalir } from "@/components/MenuDeCuenta";
import type { Profile } from "@/lib/recruiting/types";
import type { UserRole } from "@/lib/types";

const TAB_ES: Record<string, string> = {
  today: "📋 Hoy", calls: "📞 Llamadas pendientes", employees: "👤 Empleados", "user-creation": "🔑 Crear usuarios", candidates: "👥 Candidatos", board: "🗂 Tablero", outcomes: "🤝 Resultados", questions: "❓ Preguntas",
  metrics: "📊 Métricas", calendar: "📅 Calendario", settings: "⚙️ Ajustes",
};
const ROLE_ES: Record<string, string> = { admin: "Admin", manager: "Gerente", recruiter: "Reclutador", store_manager: "Gerente de tienda" };

// deliveriesRole/moduleAccess are deliveries' own columns on the shared
// profiles row, threaded through separately from `me` (recruiting's own
// Profile type, where `role` means recruiting_role) — see ModuleSwitcher.tsx.
export function TopBar({ me, deliveriesRole, moduleAccess }: { me: Profile; deliveriesRole: UserRole; moduleAccess: string[] | null | undefined }) {
  const pathname = usePathname();
  const router = useRouter();
  const { settings, recruiters } = useData();
  // El gerente de tienda solo tiene Candidatos (D-600): cualquier otra ruta del módulo lo devuelve ahí.
  useEffect(() => {
    if (esGerenteDeTienda(me.role) && pathname !== "/recruiting") router.replace("/recruiting");
  }, [me.role, pathname, router]);
  const { lang } = usePrefs();
  const role = ROLE_INFO[me.role];
  const etiqueta = (t: { id: string; label: string }) => (lang === "es" ? TAB_ES[t.id] ?? t.label : t.label);
  const menus = menusDeRrhh(TABS, me.role, deliveriesRole);
  const avatar = recruiters.find((r) => r.id === me.id)?.avatar_url ?? me.avatar_url ?? null;

  return (
    // La barra de todas las apps (D-643): el nombre con la casa pegada a la izquierda, como Entregas, y aquí dentro lo
    // de la derecha. La casa vivía en `ModuleSwitcher`, a la derecha; ahí queda solo el ⇄. La caja de la derecha es la
    // de Entregas (`.entregas-barra-resto`), con el mismo `min-width: 0` que esta fila llevaba en línea (D-054).
    // En el teléfono esa caja se deshace y las pestañas bajan a su fila (D-545); el buscador y la etiqueta del rol
    // bajan detrás de ellas (`entregas-tras-pestanas`) para que la fila del nombre no se desborde.
    <BarraDeApp nombre={settings.app_name || "RTG·HR"} deliveriesRole={deliveriesRole} moduleAccess={moduleAccess}>
        <div className="entregas-tras-pestanas"><GlobalSearch /></div>
        <div className="tabs">
          {/* D-704: dos menús, Recruiting y HR, y Ajustes suelto. El filtro por rol es el de antes (menus-rrhh.ts). */}
          {menus.grupos.map((g) => (
            <MenuDesplegable key={g.grupo} grupo={g.grupo} items={g.items} pathname={pathname} etiqueta={etiqueta} />
          ))}
          {menus.sueltas.map((t) => (
            <Link key={t.id} href={t.href} className={"tab " + (pestanaActiva(t.href, pathname) ? "active" : "")}>{etiqueta(t)}</Link>
          ))}
        </div>
        <ModuleSwitcher current="recruiting" deliveriesRole={deliveriesRole} moduleAccess={moduleAccess} />
        {/* El nombre abre el menú de la cuenta, el mismo de Entregas y Time Tracker (D-490). Se llevó
            el botón ES/EN —el idioma se elige en «Personalizar», en el hub— y el «Salir» suelto. La
            etiqueta del rol se queda: el dueño pidió quitarla en Time Tracker, no aquí. */}
        <MenuDeCuenta nombre={me.full_name ?? ""} foto={avatar}>
          {(cierraMenu) => OPCIONES_DEL_MENU_RRHH.map((o) => {
            switch (o) {
              case "personalizar":
                return <OpcionPersonalizar key={o} alPulsar={cierraMenu} />;
              case "salir":
                return <OpcionSalir key={o} />;
            }
          })}
        </MenuDeCuenta>
        {role && <span className="sema entregas-tras-pestanas" style={{ background: role.color + "33", color: "#fff" }}>{lang === "es" ? ROLE_ES[me.role] : role.label}</span>}
    </BarraDeApp>
  );
}

type Item = { id: string; label: string; href: string };

/** Uno de los dos menús (D-704). El botón dice dónde estás si la página es de este menú, y se resalta. Se cierra con
 *  Escape, con un clic fuera y al navegar. La lista es `position: fixed` (ver recruiting.css) y se coloca con la caja
 *  del botón, para que la fila deslizable del teléfono no la recorte. */
function MenuDesplegable({ grupo, items, pathname, etiqueta }: { grupo: GrupoDeMenu; items: Item[]; pathname: string; etiqueta: (t: Item) => string }) {
  const { lang } = usePrefs();
  const [abierto, setAbierto] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const boton = useRef<HTMLButtonElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const activa = items.find((t) => pestanaActiva(t.href, pathname)) ?? null;
  const nombre = lang === "es" ? NOMBRE_DEL_GRUPO[grupo].es : NOMBRE_DEL_GRUPO[grupo].en;

  useEffect(() => { setAbierto(false); }, [pathname]);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      const n = e.target as Node;
      if (!boton.current?.contains(n) && !lista.current?.contains(n)) setAbierto(false);
    };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") { setAbierto(false); boton.current?.focus(); } };
    const cierra = () => setAbierto(false);
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", tecla);
    window.addEventListener("resize", cierra);
    window.addEventListener("scroll", cierra, true);
    lista.current?.querySelector("a")?.focus();
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", tecla);
      window.removeEventListener("resize", cierra);
      window.removeEventListener("scroll", cierra, true);
    };
  }, [abierto]);

  function alternar() {
    const r = boton.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: Math.max(16, Math.min(r.left, window.innerWidth - 216)) });
    setAbierto((a) => !a);
  }

  function flechas(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const enlaces = Array.from(lista.current?.querySelectorAll("a") ?? []);
    const i = enlaces.indexOf(document.activeElement as HTMLAnchorElement);
    const sig = e.key === "ArrowDown" ? (i + 1) % enlaces.length : (i - 1 + enlaces.length) % enlaces.length;
    enlaces[sig]?.focus();
  }

  return (
    <>
      <button ref={boton} type="button" className={"tab menu-rrhh " + (activa ? "active" : "")} data-menu={grupo}
        aria-haspopup="menu" aria-expanded={abierto} onClick={alternar}>
        <span>{nombre}{activa ? " · " + etiqueta(activa) : ""}</span><span aria-hidden="true">▾</span>
      </button>
      {abierto && (
        <div ref={lista} className="menu-rrhh-lista" role="menu" aria-label={nombre} style={{ top: pos.top, left: pos.left }} onKeyDown={flechas}>
          {items.map((t) => (
            <Link key={t.id} href={t.href} role="menuitem" className={pestanaActiva(t.href, pathname) ? "active" : ""}
              onClick={() => setAbierto(false)}>{etiqueta(t)}</Link>
          ))}
        </div>
      )}
    </>
  );
}
