import { appForPath } from "@/lib/app-for-path";
import { MODULES } from "@/lib/constants";
import type { Idioma } from "@/lib/idioma";
import { cookieDeEnsenanza, ensenanzaDeLasCookies } from "@/lib/ensenanza-general";
import { cookieDeCapacitacion } from "@/lib/timetracker/capacitacion";
import { olvidaPractica } from "@/lib/practica/fetch-de-practica";

/**
 * El botón general (D-623, 2026-10-21): UNA burbuja abajo a la derecha, en todas las apps, que al pulsarla despliega
 * hacia arriba las opciones: Ayuda y Chat para todos; Cambiar usuario, Vista móvil y Modo enseñanza solo para el
 * admin de verdad (rol admin y no dentro de otra identidad).
 *
 * El dueño: «lo que es el chat va a estar en un solo bobo en una esquina, que ese es el de ayuda, pero el de ayuda se
 * ha transformado en un bobo que va a ser general, que cuando se abra […] van a salir las cinco […] con todas las
 * opciones […] Y eso va a estar así como las mismas reglas de la ayuda y el chat, que van a estar en todas las apps».
 *
 * Lo que decide vive aquí, puro, para probarlo importándolo: qué opciones salen, a dónde se cae al cambiar de usuario
 * o al volver, y la señal de enseñanza que comparten la burbuja y Entregas.
 */

export type OpcionGeneral = "ayuda" | "chat" | "usuario" | "movil" | "ensenanza";

/** De abajo arriba: la primera queda pegada al botón. */
export function opcionesDelBotonGeneral(a: { adminReal: boolean; switchHabilitado: boolean }): OpcionGeneral[] {
  const out: OpcionGeneral[] = ["ayuda", "chat"];
  if (!a.adminReal) return out;
  if (a.switchHabilitado) out.push("usuario");
  out.push("movil", "ensenanza");
  return out;
}

/**
 * A dónde cae uno tras cambiar de usuario o tras volver a su cuenta: a la PORTADA DE LA APP EN LA QUE ESTÁ, no siempre
 * a Entregas. El dueño: «si dice cambio usuario, él cambia a la app en la que ya está. Pero si ese usuario no tiene
 * acceso a eso, pues cae al hub. […] si está en el delivery sub, cae al delivery sub. O en el HR, cae el HR, pero no
 * que siempre esté cayendo el delivery sub».
 *
 * Es la portada y no la ruta exacta: la ruta exacta puede ser de un rol que la otra persona no tiene (un chofer en
 * «Gestor de rutas»), y cada layout ya rebota a quien no puede entrar a la app (`landingRoute`: el hub si tiene varias,
 * su única app si tiene una). En el hub se cae al hub.
 */
export function destinoDeLaApp(pathname: string | null | undefined): string {
  const p = pathname || "/";
  if (p === "/home" || p.startsWith("/home/")) return "/home";
  const app = appForPath(p);
  if (app === "deliveries") return "/";
  // El fichaje vive dentro de Time Tracker (D-111): no tiene tarjeta propia, y su portada es la de Time Tracker.
  const clave = app === "clockin" ? "timetracker" : app;
  return MODULES.find((m) => m.key === clave)?.href ?? "/";
}

/** La burbuja pide abrir la Ayuda o el Chat; cada uno sigue siendo su componente (el formulario, el hilo). */
export const EVENTO_ABRIR_AYUDA = "rtg:abrir-ayuda";
export const EVENTO_ABRIR_CHAT = "rtg:abrir-chat";
/** El chat cuenta sus no leídos y la burbuja general los enseña (`detail: number`). */
export const EVENTO_CHAT_SIN_LEER = "rtg:chat-sin-leer";

/**
 * El modo enseñanza. Nació en Entregas (D-274: un entorno de práctica sobre las órdenes reales) y su bandera vive en el
 * navegador con esta clave desde siempre (`data-provider.tsx`); la burbuja la enciende y la apaga desde cualquier app
 * y avisa con este evento para que Entregas, si está montada, cambie en el acto.
 *
 * Desde D-626 vale para TODAS las apps (`ensenanza-general.ts`): con la bandera se escriben dos cookies, la general
 * (`rtg_ensenanza`, que corta lo que escribe en el hub, el Inventario, RR. HH. y las demás) y la del modo capacitación
 * de Time Tracker (D-490). Un solo interruptor.
 */
export const CLAVE_ENSENANZA = "rtg_teaching";
export const EVENTO_ENSENANZA = "rtg:ensenanza";

type Almacen = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void; key?(i: number): string | null; readonly length?: number };

export function leeEnsenanza(almacen: Almacen | null | undefined): boolean {
  try { return almacen?.getItem(CLAVE_ENSENANZA) === "1"; } catch { return false; }
}

type Galletas = { cookie: string };

export function escribeEnsenanza(
  almacen: Almacen | null | undefined,
  encendido: boolean,
  // `document` y el idioma de la persona (el servidor contesta «no se guardó» en él). Sin ellos, solo Entregas.
  galletas?: { doc: Galletas | null | undefined; idioma: Idioma },
): void {
  try {
    if (encendido) almacen?.setItem(CLAVE_ENSENANZA, "1");
    else almacen?.removeItem(CLAVE_ENSENANZA);
  } catch { /* sin almacenamiento: la bandera no persiste */ }
  // Encender empieza una práctica limpia y apagar la tira (D-628): todo vuelve a como estaba.
  olvidaPractica(almacen);
  if (!galletas?.doc) return;
  const idioma = encendido ? galletas.idioma : null;
  galletas.doc.cookie = cookieDeEnsenanza(idioma);
  galletas.doc.cookie = cookieDeCapacitacion(idioma);
}

/**
 * La bandera de Entregas manda: si la cookie general no dice lo mismo (se encendió antes de D-626, o se borraron las
 * cookies), se pone igual. Time Tracker no se toca aquí: allí se puede salir de la capacitación sin apagar lo demás.
 * Devuelve si cambió algo.
 */
export function igualaCookieDeEnsenanza(almacen: Almacen | null | undefined, doc: Galletas | null | undefined, idioma: Idioma): boolean {
  if (!doc) return false;
  const bandera = leeEnsenanza(almacen);
  const cookie = ensenanzaDeLasCookies(doc.cookie) !== null;
  if (bandera === cookie) return false;
  doc.cookie = cookieDeEnsenanza(bandera ? idioma : null);
  return true;
}
