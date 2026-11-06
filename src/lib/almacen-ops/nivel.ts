/**
 * Operaciones de almacén (D-NEXT, migración 265): el NIVEL de cada persona dentro de la app y las SECCIONES que abre.
 *
 * El dueño (2026-11-06): «francis tiene acceso mismo que admin a todo, y los de warehouse por ahora solo veran la parte
 * de scrap solamente». Hasta hoy la app no tenía escalafón propio: quien tenía la casilla llenaba los siete reportes.
 * Ahora hay un rol dentro de la app, `profiles.warehouse_ops_role`, como `recruiting_role` o `erp_role`:
 *
 *   admin        todo, en TODAS las tiendas (lo que ve un admin del hub).
 *   store_admin  todo lo que hace un admin, pero solo en SUS tiendas (profiles.store y visible_stores).
 *   full         los siete reportes; ve según su rol del hub, como antes de la 265 (lo suyo; el gerente y el supervisor
 *                de almacén, lo de su tienda).
 *   scrap_only   solo la merma: el formulario, sus borradores y sus propios reportes de merma. Nada más.
 *
 * Sin valor escrito manda el rol del hub: `warehouse` es `scrap_only`, los demás `full`. El admin del hub es `admin`
 * siempre, y sin la casilla del módulo no hay nivel.
 *
 * Es la MISMA regla que `public.warehouse_ops_level()` y `public.warehouse_ops_kinds_of(text)` de la 265. La base es la
 * que manda (RLS y el guardia de `warehouse_reports`); esto decide qué pantalla ofrecer. La prueba lee el SQL para que
 * no se separen.
 *
 * Este fichero no importa React: lo usan el layout y la página del servidor.
 */
import { TIPOS, esTipo, type TipoDeReporte } from "./tipos";

export const MODULO = "warehouse_ops";
export const COLUMNA_DE_NIVEL = "warehouse_ops_role";

export const NIVELES = ["admin", "store_admin", "full", "scrap_only"] as const;
export type Nivel = (typeof NIVELES)[number];

export function esNivel(x: unknown): x is Nivel {
  return typeof x === "string" && (NIVELES as readonly string[]).includes(x);
}

/**
 * Lo que abre cada nivel. `tipos`: los formularios que puede llenar (y, en `scrap_only`, los únicos reportes suyos que
 * ve). `reportes`: si se le ofrece la vista de gerentes; en `full` depende además del rol del hub (ver `veLosReportes`).
 *
 * «Por ahora» solo merma: para abrirle otra sección a `scrap_only` se añade su tipo AQUÍ y en
 * `public.warehouse_ops_kinds_of` (una migración nueva con esa sola función). Nada más cambia.
 */
export const SECCIONES: Record<Nivel, { tipos: readonly TipoDeReporte[]; reportes: boolean }> = {
  admin: { tipos: TIPOS, reportes: true },
  store_admin: { tipos: TIPOS, reportes: true },
  full: { tipos: TIPOS, reportes: true },
  scrap_only: { tipos: ["scrap"], reportes: false },
};

export interface ConNivel {
  role: string;
  module_access?: string[] | null;
  warehouse_ops_role?: string | null;
}

/** El nivel que le toca a un rol del hub cuando nadie le escribió uno. */
export function nivelPorDefecto(rolDelHub: string): Nivel {
  return rolDelHub === "admin" ? "admin" : rolDelHub === "warehouse" ? "scrap_only" : "full";
}

/** El nivel efectivo. Null = no tiene la app (ni admin del hub ni la casilla). */
export function nivelDe(q: ConNivel): Nivel | null {
  if (q.role === "admin") return "admin";
  if (!(q.module_access ?? []).includes(MODULO)) return null;
  return esNivel(q.warehouse_ops_role) ? q.warehouse_ops_role : nivelPorDefecto(q.role);
}

/** Los formularios que puede llenar, en el orden del tablero. */
export function tiposPermitidos(q: ConNivel): TipoDeReporte[] {
  const n = nivelDe(q);
  return n ? TIPOS.filter((k) => SECCIONES[n].tipos.includes(k)) : [];
}

export function puedeLlenar(q: ConNivel, tipo: unknown): tipo is TipoDeReporte {
  return esTipo(tipo) && tiposPermitidos(q).includes(tipo);
}

/** ¿Admin dentro de la app? (`admin` en todas las tiendas, `store_admin` en las suyas). */
export function esAdminDeLaApp(q: ConNivel): boolean {
  const n = nivelDe(q);
  return n === "admin" || n === "store_admin";
}

/** Las etiquetas del selector de Usuarios. */
export const INFO_DE_NIVEL: Record<Nivel, { en: string; es: string; desc_en: string; desc_es: string }> = {
  admin: {
    en: "Admin (all stores)", es: "Admin (todas las tiendas)",
    desc_en: "Everything an admin sees in this app: every form, the manager view and every store.",
    desc_es: "Todo lo que ve un admin en esta app: todos los formularios, la vista de gerentes y todas las tiendas.",
  },
  store_admin: {
    en: "Admin (their stores only)", es: "Admin (solo sus tiendas)",
    desc_en: "Same as admin, limited to the stores they are assigned to.",
    desc_es: "Igual que admin, limitado a las tiendas que tiene asignadas.",
  },
  full: {
    en: "All reports", es: "Todos los reportes",
    desc_en: "Files the seven reports and sees their own. Managers and warehouse supervisors also see their store's.",
    desc_es: "Llena los siete reportes y ve los suyos. Los managers y supervisores de almacén ven además los de su tienda.",
  },
  scrap_only: {
    en: "Scrap only", es: "Solo merma",
    desc_en: "Only the scrap / damage form and their own scrap reports.",
    desc_es: "Solo el formulario de merma / daños y sus propios reportes de merma.",
  },
};

/**
 * Lee el nivel escrito de UNA persona con la sesión de quien mira. Tolera que la 265 aún no esté aplicada (la columna
 * no existe): devuelve null y entonces manda el rol del hub, que es lo mismo que hará la base al aplicarla.
 */
export async function leerNivelEscrito(
  sb: { from: (t: string) => any },
  id: string,
): Promise<string | null> {
  try {
    const { data, error } = await sb.from("profiles").select(COLUMNA_DE_NIVEL).eq("id", id).maybeSingle();
    if (error || !data) return null;
    const v = (data as Record<string, unknown>)[COLUMNA_DE_NIVEL];
    return typeof v === "string" ? v : null;
  } catch { return null; }
}
