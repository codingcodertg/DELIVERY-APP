import type { Lang } from "./prefs";
import type { Profile, UserRole } from "./types";
import { MODULE_ACCESS, type ModuleAccessKey, ROLE_INFO, ROLE_ORDER, normalizeModules, roleLabel } from "./constants";

/**
 * «Usuarios y Permisos» — la vista estilo QuickBooks (petición 7 y 9 de Roberto, junta 8 nov).
 *
 * Reúne, en un solo sitio y sin duplicar la lista general de usuarios, QUÉ tiene cada persona:
 *   - POR USUARIO: su rol de Entregas y qué módulos tiene (petición 7, «ver por usuario»).
 *   - POR ROL / módulo: elegir un rol o un módulo y ver la lista de esas personas (petición 7, «ver por rol»).
 *   - PERMISOS RÁPIDOS (bulk): activar/quitar módulos a varias personas de un jalón, con el botón «dar los 8 de
 *     gerente» (petición 9).
 *
 * Helpers PUROS con pruebas. La escritura la hace la página con los `updateUser…Access` del data-provider; aquí solo se
 * decide QUÉ hay que tocar. No duplica «company assets»: esta vista es de personas y permisos, no de activos.
 */

// ---------------------------------------------------------------------------------------------------------------
// Los 8 módulos base del gerente (petición 9)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Los 8 módulos que, según el dueño, debe tener un gerente: Deliveries, Leads, HR (recruiting), Time Tracker, Promos,
 * Customers, Warehouse Ops y Quote Builder (estimator). Encuestas (surveys) NO entra: «es solo marketing». Inventory
 * (erp) tampoco, no está en la lista del dueño.
 */
export const MODULOS_DE_GERENTE: readonly ModuleAccessKey[] = [
  "deliveries",
  "leads",
  "recruiting",
  "timetracker",
  "promos",
  "customers",
  "warehouse_ops",
  "estimator",
];

/** ¿Es `surveys`? Se aparta a propósito: el dueño lo dejó fuera de los 8. */
export const esSoloMarketing = (key: string): boolean => key === "surveys";

// ---------------------------------------------------------------------------------------------------------------
// Ver por usuario
// ---------------------------------------------------------------------------------------------------------------

/** La etiqueta bilingüe de un módulo, de `MODULE_ACCESS` (su fuente única). Desconocido → la propia clave. */
export function etiquetaDeModulo(key: string, lang: Lang): string {
  const m = MODULE_ACCESS.find((x) => x.key === key);
  if (!m) return key;
  return lang === "es" ? m.label_es : m.label_en;
}

/**
 * ¿Esta persona TIENE este módulo? El admin de Entregas los tiene todos (como en la base: `has_*_access()` deja pasar al
 * admin siempre). Para los demás, está en `module_access` (normalizado: 'clockin' cuenta como 'timetracker').
 */
export function tieneModulo(u: Pick<Profile, "role" | "module_access">, key: ModuleAccessKey): boolean {
  if (u.role === "admin") return true;
  return normalizeModules(u.module_access).includes(key);
}

/** Los módulos que tiene una persona, de entre un catálogo (por defecto los 8 del gerente), en su orden. */
export function modulosDeUsuario(
  u: Pick<Profile, "role" | "module_access">,
  catalogo: readonly ModuleAccessKey[] = MODULOS_DE_GERENTE,
): ModuleAccessKey[] {
  return catalogo.filter((k) => tieneModulo(u, k));
}

/** El resumen «por usuario»: su rol (texto bilingüe) y qué módulos tiene / le faltan, para pintar la ficha. */
export interface ResumenDeUsuario {
  id: string;
  nombre: string;
  role: UserRole;
  rolTexto: string;
  tiene: ModuleAccessKey[];
  faltan: ModuleAccessKey[];
}

export function resumenDeUsuario(
  u: Pick<Profile, "id" | "full_name" | "role" | "module_access">,
  lang: Lang,
  catalogo: readonly ModuleAccessKey[] = MODULOS_DE_GERENTE,
): ResumenDeUsuario {
  const tiene = modulosDeUsuario(u, catalogo);
  const faltan = catalogo.filter((k) => !tiene.includes(k));
  return { id: u.id, nombre: u.full_name, role: u.role, rolTexto: roleLabel(u.role, lang), tiene, faltan };
}

// ---------------------------------------------------------------------------------------------------------------
// Ver por rol / por módulo (petición 7, «elegir accounts payable y ver la lista de esas personas»)
// ---------------------------------------------------------------------------------------------------------------

/** Las personas con un rol de Entregas, en orden de nombre. Sin contar las dadas de baja si se pide. */
export function usuariosPorRol<T extends Pick<Profile, "role" | "full_name">>(users: readonly T[], role: UserRole): T[] {
  return [...users].filter((u) => u.role === role).sort((a, b) => a.full_name.localeCompare(b.full_name));
}

/** Las personas que tienen un módulo, en orden de nombre (el «elige un permiso y ve a quién lo tiene»). */
export function usuariosConModulo<T extends Pick<Profile, "role" | "module_access" | "full_name">>(
  users: readonly T[],
  key: ModuleAccessKey,
): T[] {
  return [...users].filter((u) => tieneModulo(u, key)).sort((a, b) => a.full_name.localeCompare(b.full_name));
}

/** Cuántas personas tienen cada rol, en el orden canónico de roles, para la columna «por rol». */
export function conteoPorRol(users: readonly Pick<Profile, "role">[]): { role: UserRole; n: number }[] {
  return ROLE_ORDER.map((role) => ({ role, n: users.filter((u) => u.role === role).length }));
}

/** Cuántas personas tienen cada uno de los 8 módulos, para la columna «por módulo». */
export function conteoPorModulo(
  users: readonly Pick<Profile, "role" | "module_access">[],
  catalogo: readonly ModuleAccessKey[] = MODULOS_DE_GERENTE,
): { key: ModuleAccessKey; n: number }[] {
  return catalogo.map((key) => ({ key, n: users.filter((u) => tieneModulo(u, key)).length }));
}

// ---------------------------------------------------------------------------------------------------------------
// Permisos rápidos (bulk) — petición 9
// ---------------------------------------------------------------------------------------------------------------

/** Una orden de cambio: a quién, qué módulo y si se concede (true) o se quita (false). La página la ejecuta. */
export interface CambioDeModulo {
  userId: string;
  key: ModuleAccessKey;
  conceder: boolean;
}

/**
 * El plan para «dar los 8 de gerente» a varias personas: solo los módulos que a cada quien le FALTAN (no se re-concede lo
 * que ya tiene, para no escribir de más). Al admin no se le toca: ya los tiene todos por su rol.
 */
export function planDarLosOcho(users: readonly Pick<Profile, "id" | "role" | "module_access">[]): CambioDeModulo[] {
  const plan: CambioDeModulo[] = [];
  for (const u of users) {
    if (u.role === "admin") continue;
    for (const key of MODULOS_DE_GERENTE) {
      if (!tieneModulo(u, key)) plan.push({ userId: u.id, key, conceder: true });
    }
  }
  return plan;
}

/**
 * El plan para activar o quitar UN módulo a varias personas (el toggle en bloque). Solo genera el cambio donde de verdad
 * hace falta: conceder a quien no lo tiene, o quitar a quien sí (nunca al admin, cuyo acceso viene del rol).
 */
export function planToggleModulo(
  users: readonly Pick<Profile, "id" | "role" | "module_access">[],
  key: ModuleAccessKey,
  conceder: boolean,
): CambioDeModulo[] {
  return users
    .filter((u) => u.role !== "admin" && tieneModulo(u, key) !== conceder)
    .map((u) => ({ userId: u.id, key, conceder }));
}

/** ¿Todas estas personas ya tienen los 8? (para pintar el botón «dar los 8» como hecho/deshabilitado). */
export function todosTienenLosOcho(users: readonly Pick<Profile, "role" | "module_access">[]): boolean {
  return users.every((u) => MODULOS_DE_GERENTE.every((k) => tieneModulo(u, k)));
}

/** El color del rol, de `ROLE_INFO`, para las pastillas de la vista (reutiliza la fuente única). */
export function colorDeRol(role: UserRole): string {
  return ROLE_INFO[role].color;
}
