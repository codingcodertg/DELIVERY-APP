/**
 * Grupos de aprobación de merma EN PRÁCTICA (modo enseñanza, dueño 10 nov: «quiero crear grupos en teaching mode»).
 * En práctica la base no se toca. El dueño (11 nov: «en training no me está salvando los grupos»): se guardan en ESTE
 * navegador por persona (localStorage), así aguantan recargar y cerrar; se borran al salir del modo enseñanza o con
 * «Borrar práctica». Se crean, se firman (gerente y supervisor), se aprueban solos con las dos firmas (como la 283).
 */
import type { FirmaDeMerma, SlotDeFirma } from "@/lib/almacen-ops/firmas";
import type { GrupoDeMerma } from "@/lib/almacen-ops/grupos";
import type { Reporte } from "@/lib/almacen-ops/datos";

export const PREFIJO_PRACTICA = "practica-";

export interface Almacen { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
type Entrada = { grupo: GrupoDeMerma; reportes: Reporte[] };

const grupos = new Map<string, Entrada>();
let dueno: { uid: string; a: Almacen | null } | null = null;

export const claveDePractica = (uid: string) => `rtg:practica:grupos:${uid}`;
function almacenDelNavegador(): Almacen | null {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; }
}
function persiste(): void {
  if (!dueno?.a) return;
  try { dueno.a.setItem(claveDePractica(dueno.uid), JSON.stringify([...grupos.values()])); } catch { /* sin espacio: queda en memoria */ }
}

/** Liga los grupos de práctica a quien mira y carga los que tenía guardados en este navegador. */
export function cargaPractica(uid: string, a: Almacen | null = almacenDelNavegador()): void {
  if (dueno?.uid === uid && dueno.a === a) return;
  dueno = { uid, a };
  grupos.clear();
  if (!a) return;
  try {
    const x = JSON.parse(a.getItem(claveDePractica(uid)) ?? "[]");
    if (Array.isArray(x)) for (const e of x) if (e?.grupo?.id && esGrupoDePractica(e.grupo.id)) grupos.set(e.grupo.id, { grupo: e.grupo, reportes: Array.isArray(e.reportes) ? e.reportes : [] });
  } catch { /* guardado roto: se empieza vacío */ }
}

/** «Borrar práctica» o al salir del modo enseñanza: fuera todos los grupos de práctica de esta persona. */
export function borrarPractica(uid?: string, a: Almacen | null = dueno?.a ?? almacenDelNavegador()): void {
  grupos.clear();
  const u = uid ?? dueno?.uid;
  if (u && a) { try { a.removeItem(claveDePractica(u)); } catch { /* nada */ } }
}

export function esGrupoDePractica(id: string | null | undefined): boolean {
  return !!id && id.startsWith(PREFIJO_PRACTICA);
}

export function crearGrupoDePractica(nombre: string, reportes: readonly Reporte[], quien: string | null): string {
  const id = PREFIJO_PRACTICA + (globalThis.crypto?.randomUUID?.() ?? String(Date.now()));
  grupos.set(id, {
    grupo: {
      id, name: nombre, store: reportes[0]?.store ?? "", created_by_name: quien, created_at: new Date().toISOString(),
      approved_at: null, approved_by: null, n_reportes: reportes.length, firmas: [],
    },
    reportes: [...reportes],
  });
  persiste();
  return id;
}

export function grupoDePractica(id: string): Entrada | null {
  const g = grupos.get(id);
  return g ? { grupo: { ...g.grupo, firmas: [...(g.grupo.firmas ?? [])] }, reportes: [...g.reportes] } : null;
}

export function gruposDePractica(): GrupoDeMerma[] {
  return [...grupos.values()].map((g) => ({ ...g.grupo })).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** De qué grupo de práctica es cada merma (para la columna «Grupo» en práctica). */
export function grupoDePracticaPorReporte(): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of grupos.values()) for (const r of e.reportes) m.set(r.id, e.grupo.id);
  return m;
}

/** Firma un lado. Con las dos firmas el grupo se aprueba solo (igual que en la base, 283). */
export function firmarGrupoDePractica(id: string, slot: SlotDeFirma, png: string, quien: { id: string; nombre: string }): void {
  const g = grupos.get(id);
  if (!g || g.grupo.approved_at) return;
  const firma: FirmaDeMerma = { slot, signer_id: quien.id, signer_name: quien.nombre, signed_at: new Date().toISOString(), signature_png: png };
  const firmas = [...(g.grupo.firmas ?? []).filter((f) => f.slot !== slot), firma];
  g.grupo = { ...g.grupo, firmas };
  if (firmas.some((f) => f.slot === "gerente") && firmas.some((f) => f.slot === "supervisor")) aprobarGrupoDePractica(id, quien.id);
  persiste();
}

export function quitarFirmaDePractica(id: string, slot: SlotDeFirma): void {
  const g = grupos.get(id);
  if (!g || g.grupo.approved_at) return;
  g.grupo = { ...g.grupo, firmas: (g.grupo.firmas ?? []).filter((f) => f.slot !== slot) };
  persiste();
}

export function aprobarGrupoDePractica(id: string, quien: string): void {
  const g = grupos.get(id);
  if (!g || g.grupo.approved_at) return;
  g.grupo = { ...g.grupo, approved_at: new Date().toISOString(), approved_by: quien };
  persiste();
}

/** 296 en práctica: saca una merma de un grupo pendiente (se borran las firmas; si queda vacío, se borra el grupo). */
export function sacarDeGrupoDePractica(id: string, reporteId: string): void {
  const g = grupos.get(id);
  if (!g || g.grupo.approved_at) return;
  const reportes = g.reportes.filter((r) => r.id !== reporteId);
  if (reportes.length === g.reportes.length) return;
  if (reportes.length === 0) { grupos.delete(id); persiste(); return; }
  g.reportes = reportes;
  g.grupo = { ...g.grupo, firmas: [], n_reportes: reportes.length };
  persiste();
}

/** 296 en práctica: borra un grupo pendiente entero. */
export function borrarGrupoDePractica(id: string): void {
  const g = grupos.get(id);
  if (!g || g.grupo.approved_at) return;
  grupos.delete(id);
  persiste();
}
