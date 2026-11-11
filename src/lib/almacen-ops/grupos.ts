/**
 * Operaciones de almacén — GRUPOS de aprobación de merma (migración 281).
 *
 * El dueño (10 nov): seleccionar varias mermas, crear un grupo con nombre, firmarlo UNA vez (gerente + supervisor) y con
 * eso aprobar todas a la vez; el grupo queda archivado. Es un camino ADICIONAL: la firma por reporte (280) sigue. Un
 * grupo NO se puede aprobar sin las dos firmas; con las dos se aprueba solo (283) y las puede poner la misma persona.
 *
 * Regla PURA (sin React, sin red). Reusa los ayudantes de firmas por reporte (`firmas.ts`): las firmas del grupo tienen
 * la misma forma (`FirmaDeMerma`).
 */
import { firmasFaltantes, nombreDeSlot, tieneAmbasFirmas, type FirmaDeMerma, type SlotDeFirma } from "./firmas";
import type { Lang } from "./etapas";
import { diaEnTexas } from "./fecha-del-dano";

export interface GrupoDeMerma {
  id: string;
  name: string;
  store: string;
  created_by_name: string | null;
  created_at: string;
  approved_at: string | null;
  approved_by: string | null;
  /** Cuántas mermas trae (para la lista de archivo). */
  n_reportes?: number;
  /** Las dos firmas (en la lista, sin el dibujo; con `signature_png` al abrir la hoja). */
  firmas?: readonly FirmaDeMerma[] | null;
}

type EstadoFirmas = Pick<GrupoDeMerma, "approved_at" | "firmas">;

/** ¿Ya está aprobado el grupo? */
export function grupoAprobado(g: Pick<GrupoDeMerma, "approved_at">): boolean {
  return !!g.approved_at;
}

/** ¿Se puede aprobar ya? No aprobado y con las dos firmas. (La base lo vuelve a exigir, y con las dos aprueba solo; 283.) */
export function puedeAprobarGrupo(g: EstadoFirmas): boolean {
  return !grupoAprobado(g) && tieneAmbasFirmas(g.firmas);
}

/** ¿El grupo está «En revisión» (requiere firma)? No aprobado y le falta alguna firma. */
export function grupoRequiereFirma(g: EstadoFirmas): boolean {
  return !grupoAprobado(g) && !tieneAmbasFirmas(g.firmas);
}

/**
 * El aviso del estado del grupo para la lista/archivo:
 *   - aprobado → «Aprobado»
 *   - las dos firmas pero sin aprobar → «Listo para aprobar»
 *   - falta firma → «Pendiente: firma del …»
 */
export function estadoDelGrupo(g: EstadoFirmas, lang: Lang): string {
  if (grupoAprobado(g)) return lang === "es" ? "Aprobado" : "Approved";
  const faltan = firmasFaltantes(g.firmas);
  if (faltan.length === 0) return lang === "es" ? "Listo para aprobar" : "Ready to approve";
  const nombres = faltan.map((s) => nombreDeSlot(s, lang));
  if (lang === "es") {
    return faltan.length === 2 ? "Pendiente de firma (gerente y supervisor)" : `Pendiente: firma del ${nombres[0].toLowerCase()}`;
  }
  return faltan.length === 2 ? "Pending signature (manager and supervisor)" : `Pending: ${nombres[0].toLowerCase()} signature`;
}

export type FiltroDeGrupos = "todos" | "pendientes" | "aprobados";

/**
 * La lista de «Grupos» (dueño, 10 nov): filtra por estado (pendientes de firma/aprobación o ya aprobados) y, salvo que
 * pidan «Ver todos», por el rango de fechas elegido arriba (el día en Texas en que se creó el grupo).
 */
export function filtrarGrupos<G extends Pick<GrupoDeMerma, "approved_at" | "created_at">>(
  grupos: readonly G[], estado: FiltroDeGrupos, rango: { desde: string; hasta: string } | null, verTodos: boolean,
): G[] {
  return grupos.filter((g) => {
    if (estado === "pendientes" && grupoAprobado(g)) return false;
    if (estado === "aprobados" && !grupoAprobado(g)) return false;
    if (verTodos || !rango) return true;
    const dia = diaEnTexas(g.created_at);
    return dia >= rango.desde && dia <= rango.hasta;
  });
}

/**
 * 292 (dueño, 10 nov: «the warehouse should be able to see what is pending for his signature»): qué espacio de firma
 * le toca a cada quien. El gerente firma «gerente»; el supervisor de almacén (permiso `warehouse_ops_supervisor`) y el
 * personal de almacén miran «supervisor»; el admin, cualquiera de los dos. Solo decide QUÉ SE LE MUESTRA: quién puede
 * firmar de verdad lo sigue diciendo la base (`warehouse_ops_can_manage`), sin cambios.
 */
export function slotsQueMeTocan(q: { role: string; permissions?: string[] | null }): readonly SlotDeFirma[] {
  if (q.role === "admin") return ["gerente", "supervisor"];
  if ((q.permissions ?? []).includes("warehouse_ops_supervisor") || q.role === "warehouse") return ["supervisor"];
  if (q.role === "manager") return ["gerente"];
  return [];
}

/** Los grupos de SU tienda, sin aprobar, a los que les falta la firma que le toca (lo más viejo primero). */
export function gruposPendientesDeMiFirma<G extends Pick<GrupoDeMerma, "approved_at" | "firmas" | "store" | "created_at">>(
  grupos: readonly G[], q: { role: string; store?: string | null; visible_stores?: string[] | null; permissions?: string[] | null },
): G[] {
  const mios = slotsQueMeTocan(q);
  const deMiTienda = (s: string) => q.role === "admin" || q.store === s || (q.visible_stores ?? []).includes(s);
  return grupos
    .filter((g) => !grupoAprobado(g) && deMiTienda(g.store) && firmasFaltantes(g.firmas).some((s) => mios.includes(s)))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}
