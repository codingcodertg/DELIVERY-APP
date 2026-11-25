import { origenDe, type Lead } from "./reglas";

/**
 * Los leads que comparten lugar (STXP con STXP, GOV con GOV). El STXP trae una ubicación aproximada («FM 88 & Mile 12
 * N»), no una dirección exacta: varios permisos distintos caen en el mismo lugar. Si además son iguales en todo lo
 * demás menos el número, es un POSIBLE DUPLICADO. Son reglas puras: la pantalla no decide nada por su cuenta.
 */

export type Parecido = { clase: "posible_duplicado" | "mismo_lugar"; otros: string[] /* ids de los otros leads del grupo */; cuantos: number /* el grupo entero, este incluido */ };

/** Mínimo de caracteres útiles de un lugar para que cuente: menos, no agrupa (una «N» o un «Main» no dice nada). */
const LUGAR_MINIMO = 9;

/**
 * La clave del lugar: `site_address` sin acentos, sin mayúsculas y sin signos ni espacios. Menos de 9 caracteres útiles
 * = sin clave (no agrupa).
 */
export function claveDeLugar(l: Pick<Lead, "site_address">): string | null {
  const s = (l.site_address ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return s.length >= LUGAR_MINIMO ? s : null;
}

/** Para comparar: sin mayúsculas, con los espacios de más quitados. Dos vacíos son iguales. */
const igualdad = (s: string | null | undefined): string => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** ¿Coinciden en nombre del proyecto, tipo de trabajo, costo estimado y alcance? */
function mismoTrabajo(a: Lead, b: Lead): boolean {
  return igualdad(a.project_name) === igualdad(b.project_name)
    && igualdad(a.type_of_work) === igualdad(b.type_of_work)
    && igualdad(a.estimated_cost == null ? "" : String(a.estimated_cost)) === igualdad(b.estimated_cost == null ? "" : String(b.estimated_cost))
    && igualdad(a.scope_of_work) === igualdad(b.scope_of_work);
}

/**
 * Para cada lead que comparte lugar con otro del MISMO origen, su grupo. «posible_duplicado» si además coincide con
 * algún otro del grupo en el trabajo (`mismoTrabajo`); «mismo_lugar» si solo comparte el lugar. Los archivados no
 * cuentan. Devuelve un mapa id → Parecido: los leads sin grupo no están.
 */
export function parecidosDe(leads: readonly Lead[]): Map<string, Parecido> {
  const grupos = new Map<string, Lead[]>();
  for (const l of leads) {
    if (l.status === "archived") continue;
    const lugar = claveDeLugar(l);
    if (lugar === null) continue;
    const clave = `${origenDe(l)}|${lugar}`;
    grupos.set(clave, [...(grupos.get(clave) ?? []), l]);
  }
  const out = new Map<string, Parecido>();
  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue;
    for (const l of grupo) {
      const otros = grupo.filter((x) => x.id !== l.id);
      // Un posible duplicado cuenta SOLO los que son iguales a él (él incluido): «×2» son dos leads iguales, aunque en ese
      // lugar haya un tercero distinto (visto en pantalla: decía «×3» con dos iguales y uno que solo compartía el lugar).
      const iguales = otros.filter((x) => mismoTrabajo(l, x));
      if (iguales.length > 0) out.set(l.id, { clase: "posible_duplicado", otros: iguales.map((x) => x.id), cuantos: iguales.length + 1 });
      else out.set(l.id, { clase: "mismo_lugar", otros: otros.map((x) => x.id), cuantos: grupo.length });
    }
  }
  return out;
}

/** Los números de los otros del grupo, para el «title» de la etiqueta: como mucho seis, y luego «…». */
export function tituloDeOtros(tabs: readonly string[], max = 6): string {
  const lista = tabs.slice(0, max).join(", ");
  return tabs.length > max ? `${lista} …` : lista;
}
