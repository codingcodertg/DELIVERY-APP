import type { Res } from "./almacen";
import { codigoDeTienda } from "./duplicados";
import { nombreDeTienda, TIENDAS, type Cliente, type Parche } from "./reglas";

type T = (en: string, es: string) => string;

/**
 * El alta en varias tiendas (D-664). El dueño, con el desplegable «Store *» del alta abierto: «here add selection box so
 * it can select multiple stores or all». Desde D-633 (migración 189) un cliente es UNA fila por tienda y las de la misma
 * empresa comparten `company_id`: dar de alta en tres tiendas es crear tres filas con los mismos datos y la MISMA
 * empresa nueva, y la lista las enseña como una empresa con sus pastillas.
 */

/** «Todas»: todas las tiendas de `TIENDAS`, no una lista escrita aparte. */
export const TODAS = "todas" as const;

/**
 * D-NEXT: la tienda que el alta deja marcada de entrada: la de quien la pide (`profiles.store`, que guarda el NOMBRE,
 * «RDZ Brownsville», o a veces el código). El dueño, 2026-10-30: «los users que tienen tienda asignada, cuando piden request
 * para crear un nuevo customer, así como se llena la parte de sales rep, también se llenará el de tienda arriba». Sin tienda,
 * o con una que no está en `TIENDAS`, nada marcado, como antes.
 */
export function tiendaPreelegida(store: string | null | undefined): string {
  const s = (store ?? "").trim().toLowerCase();
  if (!s) return "";
  return TIENDAS.find((x) => x.code.toLowerCase() === s || x.nombre.toLowerCase() === s)?.code ?? "";
}

/**
 * Las tiendas marcadas, en el orden de `TIENDAS` (el de las casillas: la primera marcada es la que se enseña al
 * terminar), sin repetir, en mayúsculas. Un código que no esté en `TIENDAS` va al final, tal cual.
 */
export function tiendasDelAlta(marcadas: readonly string[] | typeof TODAS): string[] {
  if (marcadas === TODAS) return TIENDAS.map((x) => x.code);
  const pedidas = [...new Set(marcadas.map(codigoDeTienda).filter((c) => c !== ""))];
  const conocidas = TIENDAS.map((x) => x.code).filter((c) => pedidas.includes(c));
  return [...conocidas, ...pedidas.filter((c) => !conocidas.includes(c))];
}

/**
 * Las filas que se insertan: una por tienda marcada, cada una con TODOS los datos del alta, su tienda y el mismo
 * `company_id` (nuevo: quien llama lo genera, como «Separar de la empresa»). Todas llevan las mismas claves: un insert
 * de varias filas en supabase-js pide `columns` = la unión de las claves, y a la que le falte una se le escribe NULL,
 * no el valor por defecto.
 */
export function filasDelAlta(parche: Parche, marcadas: readonly string[] | typeof TODAS, companyId: string): Parche[] {
  return tiendasDelAlta(marcadas).map((store) => ({ ...parche, store, company_id: companyId }));
}

/** Lo que dejó un alta: las filas creadas (en el orden de las tiendas) y las tiendas donde no se pudo. */
export type ResultadoDelAlta = { creados: Cliente[]; noCreadas: { store: string; duplicado: boolean; error: string }[] };

/**
 * Crea las filas UNA POR UNA con `crear` y reparte: lo creado, y lo que no (con si fue un choque, 23505). Una que choca
 * no tumba a las demás. Si no se crea ninguna, el fallo de la primera: el error de siempre.
 */
export async function creaUnaPorUna(filas: readonly Parche[], crear: (f: Parche) => Promise<Res<Cliente>>): Promise<Res<ResultadoDelAlta>> {
  const creados: Cliente[] = [];
  const noCreadas: ResultadoDelAlta["noCreadas"] = [];
  let primerFallo: Res<never> | null = null;
  for (const f of filas) {
    const r = await crear(f);
    if (r.ok) { creados.push(r.valor); continue; }
    noCreadas.push({ store: String(f.store ?? ""), duplicado: r.duplicado, error: r.error });
    primerFallo ??= r;
  }
  if (creados.length === 0) return primerFallo ?? { ok: false, sinTabla: false, sinPermiso: false, duplicado: false, error: "no store chosen" };
  return { ok: true, valor: { creados, noCreadas } };
}

/** La fila que la ventana enseña al terminar: la de la primera tienda marcada que se creó. */
export function filaQueSeEnsena(r: ResultadoDelAlta, tiendas: readonly string[]): Cliente | null {
  for (const s of tiendas) {
    const c = r.creados.find((x) => codigoDeTienda(x.store) === codigoDeTienda(s));
    if (c) return c;
  }
  return r.creados[0] ?? null;
}

/** El aviso de las tiendas donde no se creó: «Ya existía en RDZ Pharr: no se creó ahí.» Vacío si se crearon todas. */
export function avisoDeNoCreadas(r: ResultadoDelAlta, t: T): string {
  const chocan = r.noCreadas.filter((x) => x.duplicado).map((x) => nombreDeTienda(x.store));
  const otras = r.noCreadas.filter((x) => !x.duplicado);
  const partes: string[] = [];
  if (chocan.length) partes.push(t(`Already existed in ${chocan.join(", ")}: not created there.`, `Ya existía en ${chocan.join(", ")}: no se creó ahí.`));
  for (const o of otras) partes.push(t(`Not created in ${nombreDeTienda(o.store)}: ${o.error}`, `No se creó en ${nombreDeTienda(o.store)}: ${o.error}`));
  return partes.join(" ");
}
