import { ordersLikeOfficeManager } from "@/lib/constants";
import { todayISO } from "@/lib/utils";

// ============================================================
// El domingo no se entrega, y una fecha tiene que ser posible (D-658).
//
// El dueño, 2026-10-23: «el domingo no se hacen entregas» y «domingo solamente con un overdrive para casos especiales».
// Medido en producción ese día: 30 órdenes vivas con entrega en domingo (27 del domingo 2026-09-27, del cron D-406), una
// con `delivery_date` 22026-10-11 (año de 5 cifras) y otra con 2023-08-13 creada en 2026.
//
// Una sola regla para todo lo que pone o cambia `delivery_date`: la ficha (crear, enviar, editar, borrador y «solo la
// fecha» de D-480), «📅 Reprogramar» (y «Reprogramar a …» de Recomendaciones, que pasa por el mismo `reprogramarOrden`),
// la celda de fecha del Gestor, la fecha en bloque de Órdenes y la importación CSV. Como D-532, se mira la FECHA NUEVA:
// una orden que ya estaba en domingo (o con un año imposible) se sigue editando sin tocarle la fecha.
//
// La excepción («caso especial») es solo de oficina, gerente y admin, con un motivo, y deja nota en el historial. El año
// imposible no tiene excepción. La base no lleva CHECK: hay filas viejas en domingo y una con año 22026 sin decidir.
//
// Puro: sin React, sin red. Una fecha `YYYY-MM-DD` es un día del calendario de Texas: se lee por sus cifras, nunca con
// `new Date("YYYY-MM-DD")`, que la toma como medianoche UTC y en Texas es la noche del día anterior.
// ============================================================

/** Las cifras de una fecha `YYYY-MM-DD` (se acepta la cola `T…` de un timestamp). Null si no tiene esa forma o no existe. */
function partes(fecha: string): { y: number; m: number; d: number } | null {
  const s = fecha.trim().split("T")[0];
  const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!r) return null;
  const y = Number(r[1]), m = Number(r[2]), d = Number(r[3]);
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return { y, m, d };
}

/** ¿Ese día del calendario es domingo? Aritmética de calendario, sin zona horaria. Una fecha que no se lee, no. */
export function esDomingo(fecha: string | null | undefined): boolean {
  const p = fecha ? partes(fecha) : null;
  if (!p) return false;
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() === 0;
}

/** Los años que se aceptan: del anterior a hoy hasta dos más. Fuera de ahí es un error de tecleo (22026, 2023). */
export function aniosValidos(hoy: string = todayISO()): { desde: number; hasta: number } {
  const y = Number(hoy.slice(0, 4));
  return { desde: y - 1, hasta: y + 2 };
}

/** El `max` del selector de fecha: el último día del último año que se acepta. */
export function maxFechaDeEntrega(hoy: string = todayISO()): string {
  return `${aniosValidos(hoy).hasta}-12-31`;
}

export type ProblemaDeFecha = "fecha_imposible" | "domingo" | "domingo_sin_motivo";

/** Lo mínimo que se acepta como motivo del caso especial: tres letras, como la nota de «Reprogramar». */
export const MINIMO_MOTIVO_DOMINGO = 3;

const limpio = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ");

/**
 * ¿Qué le pasa a esta fecha? `null` si vale. Sin fecha, nada (eso lo dicen los campos obligatorios).
 * - `fecha_imposible`: no es `YYYY-MM-DD`, no existe (31 de febrero) o el año está fuera de `aniosValidos`. Sin excepción.
 * - `domingo`: domingo sin excepción.
 * `excepcion` ya viene decidida (rol + casilla + motivo): esta función no sabe de roles.
 */
export function problemaDeFecha(
  fecha: string | null | undefined,
  { excepcion = false, hoy = todayISO() }: { excepcion?: boolean; hoy?: string } = {},
): ProblemaDeFecha | null {
  if (!fecha || !fecha.trim()) return null;
  const p = partes(fecha);
  if (!p) return "fecha_imposible";
  const { desde, hasta } = aniosValidos(hoy);
  if (p.y < desde || p.y > hasta) return "fecha_imposible";
  if (esDomingo(fecha) && !excepcion) return "domingo";
  return null;
}

/** ¿Quién puede autorizar una entrega en domingo? Oficina, gerente de oficina y admin. */
export function puedeAutorizarDomingo(rol: string | null | undefined): boolean {
  return ordersLikeOfficeManager(rol) || rol === "admin";
}

/** La casilla «Caso especial: entregar en domingo» y su motivo, tal como están en la pantalla. */
export type CasoEspecial = { marcado: boolean; motivo: string };
export const SIN_CASO_ESPECIAL: CasoEspecial = { marcado: false, motivo: "" };

/** ¿La escritura PONE esta fecha? Solo si es nueva o cambia (D-532): la misma fecha de siempre no es agendar. */
export function cambiaLaFecha(nueva: string | null | undefined, actual: string | null | undefined): boolean {
  if (!nueva) return false;
  return nueva.trim().slice(0, 10) !== (actual ?? "").trim().slice(0, 10);
}

/**
 * La regla de una escritura: qué problema tiene PONER `nueva` donde había `actual`, para este rol y esta casilla.
 * La excepción solo cuenta con el rol que la puede dar, la casilla marcada y un motivo.
 */
export function problemaAlAgendar(
  nueva: string | null | undefined,
  actual: string | null | undefined,
  { rol, caso = SIN_CASO_ESPECIAL, hoy = todayISO() }: { rol: string | null | undefined; caso?: CasoEspecial; hoy?: string },
): ProblemaDeFecha | null {
  if (!cambiaLaFecha(nueva, actual)) return null;
  const autoriza = puedeAutorizarDomingo(rol) && caso.marcado;
  const p = problemaDeFecha(nueva, { excepcion: autoriza && limpio(caso.motivo).length >= MINIMO_MOTIVO_DOMINGO, hoy });
  if (p === "domingo" && autoriza) return "domingo_sin_motivo";
  return p;
}

/** ¿Esta escritura usa la excepción? Entonces, tras guardar, va la nota al historial. */
export function usaCasoEspecial(
  nueva: string | null | undefined,
  actual: string | null | undefined,
  { rol, caso = SIN_CASO_ESPECIAL, hoy = todayISO() }: { rol: string | null | undefined; caso?: CasoEspecial; hoy?: string },
): boolean {
  return cambiaLaFecha(nueva, actual) && esDomingo(nueva) && problemaAlAgendar(nueva, actual, { rol, caso, hoy }) === null;
}

/** La nota del historial: quién la autorizó y por qué. */
export function notaDeDomingo(quien: string | null | undefined, motivo: string, lang: "en" | "es"): string {
  const q = limpio(quien) || (lang === "es" ? "alguien sin nombre" : "someone without a name");
  return lang === "es"
    ? `Entrega en domingo autorizada por ${q}: ${limpio(motivo)}`
    : `Sunday delivery authorized by ${q}: ${limpio(motivo)}`;
}

/**
 * El aviso de cada problema, para este rol. `sinCasilla`: el sitio no tiene la casilla del caso especial (la celda del
 * Gestor, la fecha en bloque): a quien puede darlo se le dice dónde está.
 */
export function textoDelProblema(
  p: ProblemaDeFecha,
  rol: string | null | undefined,
  { hoy = todayISO(), sinCasilla = false }: { hoy?: string; sinCasilla?: boolean } = {},
): { en: string; es: string } {
  if (p === "fecha_imposible") {
    const { desde, hasta } = aniosValidos(hoy);
    return {
      en: `That delivery date isn't valid: the year has to be between ${desde} and ${hasta}.`,
      es: `Esa fecha de entrega no es válida: el año tiene que estar entre ${desde} y ${hasta}.`,
    };
  }
  if (p === "domingo_sin_motivo") {
    return {
      en: "There are no deliveries on Sundays. For a special case, write the reason.",
      es: "Los domingos no hay entregas. Para el caso especial, escribe el motivo.",
    };
  }
  if (puedeAutorizarDomingo(rol) && sinCasilla) {
    return {
      en: "There are no deliveries on Sundays. For a special case, use «📅 Reschedule» or the order's form.",
      es: "Los domingos no hay entregas. Para un caso especial, usa «📅 Reprogramar» o la ficha de la orden.",
    };
  }
  return puedeAutorizarDomingo(rol)
    ? {
        en: "There are no deliveries on Sundays. For a special case, tick «Special case: deliver on Sunday» and write the reason.",
        es: "Los domingos no hay entregas. Para un caso especial, marca «Caso especial: entregar en domingo» y escribe el motivo.",
      }
    : {
        en: "There are no deliveries on Sundays. If it's a special case, ask the office.",
        es: "Los domingos no hay entregas. Si es un caso especial, pídeselo a la oficina.",
      };
}

/** El siguiente día que no es domingo (para proponer fechas). */
export function saltaDomingo(fecha: string): string {
  if (!esDomingo(fecha)) return fecha;
  const p = partes(fecha)!;
  return new Date(Date.UTC(p.y, p.m - 1, p.d + 1)).toISOString().slice(0, 10);
}
