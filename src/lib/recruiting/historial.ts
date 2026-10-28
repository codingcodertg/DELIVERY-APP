/**
 * El historial de RR. HH. (D-NEXT, migración 212): qué pasó, a quién, con qué activo, quién lo hizo y por qué.
 *
 * El dueño (2026-10-28): «todo tiene que quedar en un historial, que se mire, no se desactivó tal día por tal cosa».
 * Cada baja, reactivación, acceso al hub quitado o devuelto, y cada activo creado, editado, borrado, asignado, liberado o
 * respaldado deja una fila. Y las acciones deliberadas (liberar, respaldar, borrar) piden un motivo antes.
 *
 * Aquí lo que no toca la base: los tipos, las etiquetas, el texto de una fila y la regla del motivo.
 */

export const KINDS = [
  "employee_deactivated", "employee_leaving_edited", "employee_reactivated",
  "hub_access_removed", "hub_access_restored",
  "asset_created", "asset_edited", "asset_deleted", "asset_assigned", "asset_released", "asset_released_on_leaving",
  "asset_backed_up", "asset_status_changed",
] as const;
export type TipoDeHistorial = (typeof KINDS)[number];

export interface EntradaDeHistorial {
  id: string;
  at: string;
  kind: TipoDeHistorial;
  employee_id: string | null;
  employee_name: string | null;
  asset_id: string | null;
  asset_text: string | null;
  actor_id: string | null;
  actor_name: string | null;
  reason: string | null;
  detail: string | null;
  data: Record<string, unknown>;
}

/** Lo que se escribe (lo demás lo pone el servidor: quién, cuándo, los nombres). */
export interface NuevaEntrada {
  kind: TipoDeHistorial;
  employeeId?: string | null;
  assetId?: string | null;
  assetText?: string | null;
  reason?: string | null;
  detail?: string | null;
  data?: Record<string, unknown>;
}

const ETIQUETAS: Record<TipoDeHistorial, { en: string; es: string }> = {
  employee_deactivated: { en: "Deactivated", es: "Dado de baja" },
  employee_leaving_edited: { en: "Leaving details edited", es: "Baja corregida" },
  employee_reactivated: { en: "Reactivated", es: "Reactivado" },
  hub_access_removed: { en: "Hub access removed", es: "Acceso al hub quitado" },
  hub_access_restored: { en: "Hub access restored", es: "Acceso al hub devuelto" },
  asset_created: { en: "Asset added", es: "Activo agregado" },
  asset_edited: { en: "Asset edited", es: "Activo editado" },
  asset_deleted: { en: "Asset deleted", es: "Activo borrado" },
  asset_assigned: { en: "Assigned", es: "Asignado" },
  asset_released: { en: "Released", es: "Liberado" },
  asset_released_on_leaving: { en: "Released (deactivation)", es: "Liberado (baja)" },
  asset_backed_up: { en: "Backed up", es: "Respaldado" },
  asset_status_changed: { en: "Status changed", es: "Estado cambiado" },
};

export function etiquetaDeHistorial(kind: TipoDeHistorial, lang: "en" | "es"): string {
  return ETIQUETAS[kind][lang];
}

/** Las entradas que son del empleado (baja, alta, acceso) y no de un activo. */
export function esDeEmpleado(kind: TipoDeHistorial): boolean {
  return kind.startsWith("employee_") || kind.startsWith("hub_");
}

/** Lo mínimo que se acepta como motivo escrito: tres letras, como la razón de un rechazo (D-520). */
export const MINIMO_MOTIVO = 3;

export function motivoValido(s: string | null | undefined): boolean {
  return (s ?? "").trim().replace(/\s+/g, " ").length >= MINIMO_MOTIVO;
}

/** Las acciones que piden motivo y confirmación antes de hacerse (el dueño: «antes de hacer algo así tan deliberado
 *  como liberar»). Asignar y agregar no lo piden: se deshacen liberando o borrando. */
export const PIDEN_MOTIVO: readonly TipoDeHistorial[] = ["asset_released", "asset_backed_up", "asset_deleted", "hub_access_removed"];

/**
 * Una línea que cuenta la fila: «Dado de baja — Juan Pérez · motivo: …». Para la tabla, cada trozo va en su columna;
 * esto es para el tooltip, el CSV y las pruebas.
 */
export function textoDeEntrada(e: EntradaDeHistorial, lang: "en" | "es"): string {
  const partes = [etiquetaDeHistorial(e.kind, lang)];
  const sobre = [e.asset_text, e.employee_name].filter(Boolean).join(" → ");
  if (sobre) partes.push(sobre);
  if (e.detail) partes.push(e.detail);
  if (e.reason) partes.push((lang === "es" ? "motivo: " : "reason: ") + e.reason);
  return partes.join(" · ");
}

/** El texto con el que se guarda un activo en el historial: «✉️ ana@rdz…» o «📞 956-555-0123 ext. 12». */
export function textoDeActivoParaHistorial(a: { kind: "email" | "phone"; value: string; ext?: string | null }): string {
  if (a.kind === "email") return `✉️ ${a.value}`;
  return `📞 ${a.value}${a.ext ? ` ext. ${a.ext}` : ""}`;
}

/** Lo que cambió entre dos versiones de un activo, para `data` y para el detalle. */
export function cambiosDeActivo(antes: Record<string, unknown>, despues: Record<string, unknown>, campos: readonly string[]): Record<string, { de: unknown; a: unknown }> {
  const out: Record<string, { de: unknown; a: unknown }> = {};
  for (const c of campos) {
    const de = antes[c] ?? null, a = despues[c] ?? null;
    if (String(de ?? "") !== String(a ?? "")) out[c] = { de, a };
  }
  return out;
}

export function detalleDeCambios(cambios: Record<string, { de: unknown; a: unknown }>): string | null {
  const partes = Object.entries(cambios).map(([c, v]) => `${c}: ${v.de ?? "—"} → ${v.a ?? "—"}`);
  return partes.length ? partes.join(" · ") : null;
}
