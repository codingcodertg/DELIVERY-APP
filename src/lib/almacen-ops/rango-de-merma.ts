/**
 * Operaciones de almacén (D-911): el rango de fechas de la merma. El dueño: «on the scrap select date range».
 *
 * En la vista de gerentes (Reportes → pestaña Merma) un selector con atajos —hoy, esta semana, la semana pasada, este
 * mes, el mes pasado, los últimos 30 días— o un rango a mano (Desde / Hasta). El rango manda sobre la lista de merma Y
 * sobre la tabla de «$ de pérdida por tienda». Todo cuenta por el día en que se rompió (`broken_on`, 266), en días de
 * Texas; las semanas empiezan en domingo, como Tile Ops y como los totales que ya había.
 *
 * El rango viaja en la URL (`?rango=mes`, `?rango=otro&desde=2026-10-01&hasta=2026-10-31`): aguanta un refresh y se
 * puede compartir. Sin React: lo usan la pantalla y las pruebas.
 */
import { diaDelReporte, esDia, hoyEnTexas } from "./fecha-del-dano";
import { formateadorDeFecha } from "@/lib/formateador";

export const ATAJOS = ["hoy", "semana", "semana-pasada", "mes", "mes-pasado", "30-dias", "otro"] as const;
export type Atajo = (typeof ATAJOS)[number];
/** Con lo que abre la pantalla si la URL no dice otra cosa. */
export const ATAJO_INICIAL: Atajo = "mes";

export const NOMBRE_DE_ATAJO: Record<Atajo, { en: string; es: string }> = {
  hoy: { en: "Today", es: "Hoy" },
  semana: { en: "This week", es: "Esta semana" },
  "semana-pasada": { en: "Last week", es: "La semana pasada" },
  mes: { en: "This month", es: "Este mes" },
  "mes-pasado": { en: "Last month", es: "El mes pasado" },
  "30-dias": { en: "Last 30 days", es: "Últimos 30 días" },
  otro: { en: "📅 Date range", es: "📅 Rango de fechas" },
};

export function esAtajo(v: unknown): v is Atajo {
  return typeof v === "string" && (ATAJOS as readonly string[]).includes(v);
}

/** Un rango cerrado de días `YYYY-MM-DD`; un extremo vacío es abierto (sin límite por ese lado). */
export interface Rango { desde: string; hasta: string }

/** Lo que eligió quien mira, tal como viaja en la URL. */
export interface Eleccion { atajo: Atajo; desde: string; hasta: string }

// Aritmética de días sobre `YYYY-MM-DD` en UTC: ni horas ni zonas se meten en la cuenta.
const aFecha = (dia: string) => { const [a, m, d] = dia.split("-").map(Number); return new Date(Date.UTC(a, m - 1, d)); };
const aDia = (f: Date) => f.toISOString().slice(0, 10);
/** `dia` más `n` días (negativo resta). */
export function sumarDias(dia: string, n: number): string {
  const f = aFecha(dia);
  f.setUTCDate(f.getUTCDate() + n);
  return aDia(f);
}
const domingoDe = (dia: string) => sumarDias(dia, -aFecha(dia).getUTCDay());
const primeroDelMes = (dia: string) => dia.slice(0, 8) + "01";
const ultimoDelMes = (dia: string) => { const f = aFecha(dia); return aDia(new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 0))); };

/** El rango de un atajo, contado desde `hoy` (el día de Texas). Para «otro», el rango a mano que venga. */
export function rangoDeAtajo(atajo: Atajo, hoy: string = hoyEnTexas(), aMano: Partial<Rango> = {}): Rango {
  switch (atajo) {
    case "hoy": return { desde: hoy, hasta: hoy };
    case "semana": return { desde: domingoDe(hoy), hasta: hoy };
    case "semana-pasada": { const dom = domingoDe(hoy); return { desde: sumarDias(dom, -7), hasta: sumarDias(dom, -1) }; }
    case "mes": return { desde: primeroDelMes(hoy), hasta: hoy };
    case "mes-pasado": { const ant = sumarDias(primeroDelMes(hoy), -1); return { desde: primeroDelMes(ant), hasta: ant }; }
    case "30-dias": return { desde: sumarDias(hoy, -29), hasta: hoy };
    case "otro": return { desde: esDia(aMano.desde) ? aMano.desde : "", hasta: esDia(aMano.hasta) ? aMano.hasta : "" };
  }
}

/** ¿Cuadra el rango a mano? Cada extremo, si viene, es un día de verdad; y Desde no va después de Hasta. */
export function rangoAManoValido(r: Partial<Rango> | null | undefined): boolean {
  if (!r) return false;
  const { desde = "", hasta = "" } = r;
  if (desde && !esDia(desde)) return false;
  if (hasta && !esDia(hasta)) return false;
  return !(desde && hasta && desde > hasta);
}

/** La elección que trae la URL. Sin `rango` (o uno que no existe) abre con el atajo inicial; días mal escritos se descartan. */
export function eleccionDeUrl(p: { get(k: string): string | null } | null | undefined): Eleccion {
  const atajo = p?.get("rango");
  const desde = p?.get("desde") ?? "";
  const hasta = p?.get("hasta") ?? "";
  if (!esAtajo(atajo)) return { atajo: ATAJO_INICIAL, desde: "", hasta: "" };
  if (atajo !== "otro") return { atajo, desde: "", hasta: "" };
  return { atajo, desde: esDia(desde) ? desde : "", hasta: esDia(hasta) ? hasta : "" };
}

/** Los parámetros con que la elección vuelve a la URL. El atajo inicial sin nada a mano no deja rastro. */
export function eleccionAUrl(e: Eleccion): Record<string, string> {
  if (e.atajo === "otro") {
    const out: Record<string, string> = { rango: "otro" };
    if (esDia(e.desde)) out.desde = e.desde;
    if (esDia(e.hasta)) out.hasta = e.hasta;
    return out;
  }
  return e.atajo === ATAJO_INICIAL ? {} : { rango: e.atajo };
}

/** El rango que de verdad se aplica a una elección (o null si lo escrito a mano no cuadra). */
export function rangoDeEleccion(e: Eleccion, hoy: string = hoyEnTexas()): Rango | null {
  if (e.atajo === "otro" && !rangoAManoValido(e)) return null;
  return rangoDeAtajo(e.atajo, hoy, e);
}

/** ¿Cae el día dentro del rango? Un extremo vacío no limita. */
export function diaEnRango(dia: string, r: Rango): boolean {
  if (r.desde && dia < r.desde) return false;
  if (r.hasta && dia > r.hasta) return false;
  return true;
}

/** Las filas cuyo día que cuenta (en la merma, cuando se rompió) cae en el rango. */
export function filtrarPorRango<T extends { kind: string; created_at: string; broken_on?: string | null }>(filas: readonly T[], r: Rango): T[] {
  return filas.filter((f) => diaEnRango(diaDelReporte(f), r));
}

/** La pérdida en el rango por tienda, y «*» = todas. Solo entran las filas de merma; redondeado a centavos. */
export function perdidaEnRango(filas: readonly { kind: string; created_at: string; broken_on?: string | null; store: string; total_loss: number | null }[], r: Rango): Record<string, number> {
  const out: Record<string, number> = { "*": 0 };
  for (const f of filtrarPorRango(filas, r)) {
    if (f.kind !== "scrap") continue;
    const v = f.total_loss ?? 0;
    out["*"] += v;
    out[f.store] = (out[f.store] ?? 0) + v;
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k] * 100) / 100;
  return out;
}

/** El rango para leer en la tabla: «Oct 1 – Oct 31», «Nov 6», «Oct 1, 2025 – Nov 6, 2026»; abierto: «From Oct 1» / «Until Oct 31». */
export function etiquetaDeRango(r: Rango, lang: "en" | "es" = "en", hoy: string = hoyEnTexas()): string {
  const fmt = (dia: string, conAno: boolean) => formateadorDeFecha(lang === "es" ? "es-MX" : "en-US",
    { timeZone: "UTC", month: "short", day: "numeric", ...(conAno ? { year: "numeric" } : {}) }).format(aFecha(dia)).replace(".", "");
  const ano = hoy.slice(0, 4);
  const conAno = (r.desde && r.desde.slice(0, 4) !== ano) || (r.hasta && r.hasta.slice(0, 4) !== ano);
  if (r.desde && r.hasta) return r.desde === r.hasta ? fmt(r.desde, !!conAno) : `${fmt(r.desde, !!conAno)} – ${fmt(r.hasta, !!conAno)}`;
  if (r.desde) return (lang === "es" ? "Desde " : "From ") + fmt(r.desde, !!conAno);
  if (r.hasta) return (lang === "es" ? "Hasta " : "Until ") + fmt(r.hasta, !!conAno);
  return lang === "es" ? "Siempre" : "All time";
}
