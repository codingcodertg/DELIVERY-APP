// ============================================================
// Presencial en VARIAS tiendas, en el FICHAJE (2026-11-25). Parte pura, sin React ni Supabase.
//
// El dueño, sobre Francis Lestarpe: «en el timer sí puede elegir store pero en el clock in and out no puede
// elegir la tienda»; «a Francis remuévele el timer porque él va a funcionar como un in person employee only,
// pero él como pasa cambiando puede choose el store en el clock in and out».
//
// Reglas que aquí viven (las pantallas y el servidor las llaman; ninguno decide por su cuenta):
//  · Quién ve el cronómetro: el presencial que no es admin NUNCA lo ve. Si tiene uno corriendo de antes,
//    solo ve el botón de parar, para no dejar una sesión viva sin poder pararla (`vistaDelCronometro`).
//  · Qué tiendas se ofrecen al fichar: las mismas que ofrece el cronómetro (`tiendasParaElegir`), y solo a
//    quien va en varias tiendas (`tiendasQueOfreceElFichaje`).
//  · Qué tienda manda el servidor: solo si la persona va en varias; debe estar entre las activas de su
//    empresa. Para quien no va en varias, la tienda que llegue se ignora (`validarTiendaDelFichaje`).
//  · Dónde se ve la tienda de cada fichaje en Nómina: `tiendasDeLaPersonaEnElPeriodo` (el filtro de tienda
//    y el «Tiendas:» de la hoja se apoyan en él).
// ============================================================

import { effWorkerType } from "@/lib/timetracker/helpers";
import {
  esMultiTienda, tiendasParaElegir, type PersonaMultiTienda, type TiendaElegible,
} from "@/lib/timetracker/multitienda";

// --- Quién ve el cronómetro --------------------------------------------------

/**
 * «completo»: el admin y el remoto, como siempre.
 * «solo_fichaje»: el presencial que no es admin. Entrada y salida, y nada de cronómetro.
 * «solo_parar»: el mismo presencial, con un cronómetro vivo de antes. Solo el botón de parar.
 */
export type VistaDelCronometro = "completo" | "solo_parar" | "solo_fichaje";

export function vistaDelCronometro(
  p: PersonaMultiTienda | null | undefined,
  esAdmin: boolean,
  hayCronometroVivo: boolean,
): VistaDelCronometro {
  if (esAdmin || effWorkerType(p) !== "inhouse") return "completo";
  return hayCronometroVivo ? "solo_parar" : "solo_fichaje";
}

// --- Qué tiendas se ofrecen al fichar ----------------------------------------

/** Las tiendas del desplegable de fichar: solo para quien va en varias; a los demás, ninguna. */
export function tiendasQueOfreceElFichaje(
  p: PersonaMultiTienda | null | undefined,
  tiendas: TiendaElegible[] | null | undefined,
): TiendaElegible[] {
  return esMultiTienda(p) ? tiendasParaElegir(tiendas) : [];
}

/** Al cambiar de tienda se ofrecen las demás, sin la que ya está marcando. */
export function tiendasParaCambiar(
  p: PersonaMultiTienda | null | undefined,
  tiendas: TiendaElegible[] | null | undefined,
  actual: string | null | undefined,
): TiendaElegible[] {
  return tiendasQueOfreceElFichaje(p, tiendas).filter((t) => t.id !== actual);
}

// --- Lo que manda el servidor -------------------------------------------------

export type ResultadoTiendaDelFichaje =
  | { ok: true; storeId: string | null }
  | { ok: false; code: "tienda_requerida" | "tienda_no_permitida" };

/**
 * Valida la tienda que manda un fichaje.
 *  · Quien no va en varias tiendas: la tienda se ignora (`storeId` null, como hoy).
 *  · Quien va en varias: tiene que mandar una, y esa tiene que estar entre las tiendas activas de su empresa.
 */
export function validarTiendaDelFichaje(args: {
  multiStore: boolean;
  storeId: string | null | undefined;
  tiendasActivas: { id: string }[];
}): ResultadoTiendaDelFichaje {
  if (!args.multiStore) return { ok: true, storeId: null };
  if (!args.storeId) return { ok: false, code: "tienda_requerida" };
  if (!args.tiendasActivas.some((t) => t.id === args.storeId)) return { ok: false, code: "tienda_no_permitida" };
  return { ok: true, storeId: args.storeId };
}

// --- Nómina -------------------------------------------------------------------

/**
 * Las tiendas en las que una persona fichó en un conjunto de fichajes (sin repetir, sin vacías).
 * Quien no va en varias tiendas no tiene ninguna: su `work_store_id` es siempre null.
 */
export function tiendasDeLaPersonaEnElPeriodo(
  fichajes: readonly { employee_id: string; work_store_id?: string | null }[],
  personaId: string,
): string[] {
  const ids = new Set<string>();
  for (const f of fichajes) {
    if (f.employee_id === personaId && f.work_store_id) ids.add(f.work_store_id);
  }
  return [...ids];
}
