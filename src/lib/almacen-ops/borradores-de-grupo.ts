/**
 * Grupos de aprobación en BORRADOR (dueño, 11 nov). «Iniciar aprobación» ya no crea el grupo en la base: abre su hoja
 * como borrador con «💾 Guardar grupo». Solo Guardar lo crea (y entonces se firma). Si se cierra sin guardar, queda
 * como borrador en ESTE navegador, por persona, y sale en «Grupos» con la etiqueta «Borrador» para reabrirlo (Guardar
 * o Descartar). El borrador guarda los ids de las mermas; al reabrirlo se vuelven a leer y se quitan las que ya no se
 * pueden agrupar (ya en un grupo, o ya no fotografiadas).
 */
import { seleccionableParaHoja } from "./etapas";
import type { Reporte } from "./datos";

export const PREFIJO_BORRADOR = "borrador-";

export interface BorradorDeGrupo { id: string; nombre: string; store: string; reportes: string[]; creado: string }
export interface Almacen { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

export const claveDeBorradores = (uid: string) => `rtg:merma:grupos-borrador:${uid}`;
function almacenDelNavegador(): Almacen | null {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; }
}

export function esBorradorDeGrupo(id: string | null | undefined): boolean {
  return !!id && id.startsWith(PREFIJO_BORRADOR);
}

export function listarBorradoresDeGrupo(uid: string, a: Almacen | null = almacenDelNavegador()): BorradorDeGrupo[] {
  if (!a) return [];
  try {
    const x = JSON.parse(a.getItem(claveDeBorradores(uid)) ?? "[]");
    if (!Array.isArray(x)) return [];
    return x.filter((b): b is BorradorDeGrupo => !!b && esBorradorDeGrupo(b.id) && Array.isArray(b.reportes))
      .sort((p, q) => q.creado.localeCompare(p.creado));
  } catch { return []; }
}

function escribe(uid: string, lista: BorradorDeGrupo[], a: Almacen | null): boolean {
  if (!a) return false;
  try { a.setItem(claveDeBorradores(uid), JSON.stringify(lista)); return true; } catch { return false; }
}

/** Crea el borrador con las mermas marcadas y devuelve su id. */
export function crearBorradorDeGrupo(uid: string, nombre: string, reportes: readonly Pick<Reporte, "id" | "store">[], a: Almacen | null = almacenDelNavegador()): string {
  const id = PREFIJO_BORRADOR + (globalThis.crypto?.randomUUID?.() ?? String(Date.now()));
  const b: BorradorDeGrupo = { id, nombre, store: reportes[0]?.store ?? "", reportes: reportes.map((r) => r.id), creado: new Date().toISOString() };
  escribe(uid, [b, ...listarBorradoresDeGrupo(uid, a)], a);
  return id;
}

export function leerBorradorDeGrupo(uid: string, id: string, a: Almacen | null = almacenDelNavegador()): BorradorDeGrupo | null {
  return listarBorradoresDeGrupo(uid, a).find((b) => b.id === id) ?? null;
}

export function borrarBorradorDeGrupo(uid: string, id: string, a: Almacen | null = almacenDelNavegador()): void {
  escribe(uid, listarBorradoresDeGrupo(uid, a).filter((b) => b.id !== id), a);
}

/** Al reabrir: de los ids del borrador, las mermas que todavía se pueden agrupar y las que se quitaron. */
export function depuraBorrador<R extends Reporte>(b: BorradorDeGrupo, reportes: readonly R[]): { elegibles: R[]; quitadas: number } {
  const porId = new Map(reportes.map((r) => [r.id, r]));
  const elegibles = b.reportes.map((id) => porId.get(id)).filter((r): r is R => !!r && seleccionableParaHoja(r) && !r.scrap_group_id);
  return { elegibles, quitadas: b.reportes.length - elegibles.length };
}
