/**
 * Grupos de aprobación de merma EN PRÁCTICA (modo enseñanza, dueño 10 nov: «quiero crear grupos en teaching mode»).
 * En práctica la base no se toca: el grupo vive solo en la memoria de esta pestaña. Se crea, se firma (gerente y
 * supervisor), se aprueba solo con las dos firmas (como la 283) y desaparece al recargar. Nada llega a la base.
 */
import type { FirmaDeMerma, SlotDeFirma } from "@/lib/almacen-ops/firmas";
import type { GrupoDeMerma } from "@/lib/almacen-ops/grupos";
import type { Reporte } from "@/lib/almacen-ops/datos";

export const PREFIJO_PRACTICA = "practica-";

const grupos = new Map<string, { grupo: GrupoDeMerma; reportes: Reporte[] }>();

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
  return id;
}

export function grupoDePractica(id: string): { grupo: GrupoDeMerma; reportes: Reporte[] } | null {
  const g = grupos.get(id);
  return g ? { grupo: { ...g.grupo, firmas: [...(g.grupo.firmas ?? [])] }, reportes: [...g.reportes] } : null;
}

export function gruposDePractica(): GrupoDeMerma[] {
  return [...grupos.values()].map((g) => ({ ...g.grupo })).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** Firma un lado. Con las dos firmas el grupo se aprueba solo (igual que en la base, 283). */
export function firmarGrupoDePractica(id: string, slot: SlotDeFirma, png: string, quien: { id: string; nombre: string }): void {
  const g = grupos.get(id);
  if (!g || g.grupo.approved_at) return;
  const firma: FirmaDeMerma = { slot, signer_id: quien.id, signer_name: quien.nombre, signed_at: new Date().toISOString(), signature_png: png };
  const firmas = [...(g.grupo.firmas ?? []).filter((f) => f.slot !== slot), firma];
  g.grupo = { ...g.grupo, firmas };
  if (firmas.some((f) => f.slot === "gerente") && firmas.some((f) => f.slot === "supervisor")) aprobarGrupoDePractica(id, quien.id);
}

export function quitarFirmaDePractica(id: string, slot: SlotDeFirma): void {
  const g = grupos.get(id);
  if (!g || g.grupo.approved_at) return;
  g.grupo = { ...g.grupo, firmas: (g.grupo.firmas ?? []).filter((f) => f.slot !== slot) };
}

export function aprobarGrupoDePractica(id: string, quien: string): void {
  const g = grupos.get(id);
  if (!g || g.grupo.approved_at) return;
  g.grupo = { ...g.grupo, approved_at: new Date().toISOString(), approved_by: quien };
}
