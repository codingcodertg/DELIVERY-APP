// ============================================================
// Qué pestañas pinta la barra de Time Tracker, y cuáles van dentro del botón «👤 Mío ▾» (D-NEXT).
//
// El dueño, el 2026-10-11: «en el clock in app, ajustes, tegistrar tiempo mi semana mi solicitus y
// mi diaro que vayan en un solo boton dropdwow». La barra del ADMIN tenía trece pestañas en fila
// (cinco filas en un teléfono de 390 px): las ocho de gestión, Ajustes y, tras una raya, sus cuatro
// personales. Ajustes y esas cuatro pasan a un solo desplegable; las ocho de gestión se quedan.
//
// Aquí, puro y sin React, lo que decide la barra (`TopBar`):
//   · `barraDeTt` — qué pestañas van en la fila, cuáles en el menú y cuál del menú es la de la
//     pantalla en la que se está.
//   · `claveDelRotulo` — qué dice el botón: «👤 Mío» fuera de esas pantallas; dentro de una, su
//     nombre («📅 Mi semana»), para que se sepa dónde se está sin abrirlo.
//   · `opcionesDelMenuMio` — las opciones del desplegable: su texto, cuál es la actual y a dónde lleva.
//   · `esPestanaActiva` — la regla de siempre para resaltar una pestaña, una sola vez para las dos.
//
// El empleado y el gerente no cambian: tienen tres pestañas (Registrar tiempo · Mi semana · Mis
// solicitudes) y no tienen Ajustes ni Mi diario, así que no hay nada que recoger.
// ============================================================

import type { OpcionDelMenu } from "@/components/MenuDeAcciones";
import { esAdminDeTt, pestanasPara } from "@/lib/timetracker/vista-empleado";

export type Pestana = { id: string; href: string };

/**
 * Las pestañas que el admin ya no ve en la fila sino dentro de «👤 Mío ▾», en el orden del menú.
 * Primero las suyas, en el orden en que estaban en la barra, y Ajustes al final, como en casi cualquier
 * menú (en la barra iba antes que ellas, al final de las de gestión).
 */
export const PESTANAS_DEL_MENU_MIO = ["track", "week", "requests", "diary", "settings"] as const;

const vanAlMenu = (id: string) => (PESTANAS_DEL_MENU_MIO as readonly string[]).includes(id);

/**
 * ¿Es esta pestaña la de la pantalla en la que se está? «Registrar tiempo» es la raíz del módulo
 * (`/timetracker`): solo cuenta exacta, si no estaría encendida en todas. Las demás cuentan también
 * en sus subrutas (`/timetracker/people/…`), pero por tramos enteros: `/timetracker/requests` no
 * enciende nada en `/timetracker/requests-viejo`.
 */
export function esPestanaActiva(href: string, pathname: string): boolean {
  if (href === "/timetracker") return pathname === "/timetracker";
  return pathname === href || pathname.startsWith(href + "/");
}

export type BarraDeTt = {
  /** Las pestañas sueltas, en fila, en su orden. */
  fila: Pestana[];
  /**
   * En el teléfono, ¿caben las pestañas sueltas en UNA fila? Las tres del empleado (y del gerente), sí: se reparten el
   * ancho con letra algo menor y su nombre corto (`claveCorta`). El dueño, el 2026-10-11, mirando las de Carlos Fuentes:
   * «those 3 things should be in the same row make it fit». Las del admin no: son ocho y un botón, y se parten en filas
   * como siempre.
   */
  enUnaFila: boolean;
  /** Las de «👤 Mío ▾», en el orden del menú. Vacía: no hay botón (empleado y gerente). */
  menu: Pestana[];
  /** La del menú cuya pantalla está abierta, o `null`. El botón la nombra y se resalta. */
  activaDelMenu: Pestana | null;
};

export function barraDeTt(role: string | null | undefined, pathname: string): BarraDeTt {
  const todas = pestanasPara(role);
  if (!esAdminDeTt(role)) return { fila: todas, enUnaFila: true, menu: [], activaDelMenu: null };
  const menu = PESTANAS_DEL_MENU_MIO
    .map((id) => todas.find((p) => p.id === id))
    .filter((p): p is Pestana => !!p);
  const fila = todas.filter((p) => !vanAlMenu(p.id));
  const activaDelMenu = menu.find((p) => esPestanaActiva(p.href, pathname)) ?? null;
  return { fila, enUnaFila: false, menu, activaDelMenu };
}

/**
 * La clave del nombre CORTO de una pestaña, el que lleva en el teléfono cuando van en una fila (`enUnaFila`). En
 * inglés es el mismo nombre («⏱ Track Time · 📅 My Week · 📝 My Requests» caben); en español se acortan los dos
 * largos: «⏱ Registrar · 📅 Mi semana · 📝 Solicitudes». En el escritorio, el nombre de siempre.
 */
export function claveCorta(id: string): string {
  return "tab.corta." + id;
}

/** La clave de i18n del texto del botón: la pestaña abierta si es del menú; si no, «👤 Mío / Mine». */
export function claveDelRotulo(barra: Pick<BarraDeTt, "activaDelMenu">): string {
  return barra.activaDelMenu ? "tab." + barra.activaDelMenu.id : "tab.mine";
}

/**
 * Las opciones de «👤 Mío ▾», listas para `MenuDeAcciones`: cada una con el MISMO texto que tenía su pestaña
 * (`tab.<id>`), la de la pantalla abierta marcada (`actual`), y al pulsarla, a su pantalla (`ir`, que en la barra es
 * `router.push`).
 */
export function opcionesDelMenuMio(
  barra: Pick<BarraDeTt, "menu" | "activaDelMenu">,
  t: (clave: string) => string,
  ir: (href: string) => void,
): OpcionDelMenu[] {
  return barra.menu.map((p) => ({
    id: p.id,
    texto: t("tab." + p.id),
    actual: p === barra.activaDelMenu,
    alPulsar: () => ir(p.href),
  }));
}
