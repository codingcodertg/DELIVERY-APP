import type { Lang } from "../prefs";
import { MODULE_ACCESS, type ModuleAccessKey } from "../constants";

/**
 * Agrupación y metadatos de ROL-POR-APP para el administrador de permisos de Security (D-940, Fase A).
 *
 * El dueño (9 nov): no basta la casilla on/off — varias apps tienen su propio ESCALAFÓN (RR. HH., Time Tracker,
 * Inventario/ERP, Almacén). Este módulo es puro: dice en qué grupo va cada app, cuál es su columna de rol (si tiene),
 * qué tier se le pone al conceder, y las opciones/etiquetas del rol — todo leído de `MODULE_ACCESS`, la fuente única.
 */

export interface GrupoDePermisos {
  titulo_en: string;
  titulo_es: string;
  keys: ModuleAccessKey[];
}

/** Los grupos de la vista, como el mockup «Permisos y uso en vivo». Juntos cubren TODO `MODULE_ACCESS`. */
export const GRUPOS_DE_PERMISOS: GrupoDePermisos[] = [
  { titulo_en: "Core", titulo_es: "Base", keys: ["deliveries"] },
  { titulo_en: "Sales", titulo_es: "Ventas", keys: ["estimator", "leads", "customers", "promos"] },
  { titulo_en: "Operations", titulo_es: "Operaciones", keys: ["warehouse_ops"] },
  { titulo_en: "Office", titulo_es: "Oficina", keys: ["recruiting", "timetracker"] },
  { titulo_en: "Other", titulo_es: "Otros", keys: ["surveys", "erp"] },
];

/** El tier por defecto al conceder un módulo con escalafón (el más bajo, nunca admin por accidente). */
export const ROL_POR_DEFECTO: Partial<Record<ModuleAccessKey, string>> = {
  recruiting: "recruiter",
  timetracker: "employee",
  erp: "staff",
  warehouse_ops: "scrap_only",
};

/** La columna de `profiles` donde vive el rol de este módulo, o null si no tiene escalafón propio.
 *  `deliveries` usa `role` pero se edita en Identidad, así que aquí NO se cuenta como editable-en-línea. */
export function columnaDeRol(key: ModuleAccessKey): string | null {
  const m = MODULE_ACCESS.find((x) => x.key === key);
  if (!m || !m.roleColumn || m.roleColumn === "role") return null;
  return m.roleColumn;
}

/** ¿Este módulo tiene un selector de rol propio en esta vista? (RR. HH., Time Tracker, ERP, Almacén). */
export function tieneRolPropio(key: ModuleAccessKey): boolean {
  return columnaDeRol(key) !== null;
}

/** Las opciones de rol de un módulo con escalafón, de `MODULE_ACCESS`. Vacío si no tiene. */
export function opcionesDeRol(key: ModuleAccessKey): string[] {
  if (!tieneRolPropio(key)) return [];
  return [...(MODULE_ACCESS.find((x) => x.key === key)?.roleKeys ?? [])];
}

/** La etiqueta bilingüe de un valor de rol de un módulo, de `MODULE_ACCESS`. */
export function etiquetaDeRol(key: ModuleAccessKey, role: string, lang: Lang): string {
  const m = MODULE_ACCESS.find((x) => x.key === key);
  return m?.roleLabel ? m.roleLabel(role, lang) : role;
}
