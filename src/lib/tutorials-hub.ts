import { normaliza } from "@/lib/phone-book";
import { esAdmin } from "@/lib/impersonation";
import { ROLE_INFO, ROLE_ORDER } from "@/lib/constants";
import type { Tutorial, TutorialApp, UserRole } from "@/lib/types";

/**
 * Los tutoriales del hub (D-268): agrupar, buscar, quién los gestiona, y guardarlos.
 *
 * Vivían dentro de la «Cuenta» de Entregas (commit b5fb6dd, v0.9.15, sin decisión registrada).
 * Pasan al hub porque son de todas las apps, igual que «Mi perfil» (D-265). Aquí va lo que se decide
 * sin pantalla, para probarlo con datos.
 */

/** El orden de los grupos. No es alfabético: va el de las apps en el hub, y General al final. */
export const APPS_DE_TUTORIAL: readonly TutorialApp[] = ["deliveries", "recruiting", "timetracker", "clockin", "erp"];

export type GrupoDeTutoriales = { app: TutorialApp | "general"; tutoriales: Tutorial[] };

/** El grupo de un tutorial. Sin `app`, o con una que no existe, va a General y no desaparece. */
export function appDeTutorial(t: Pick<Tutorial, "app">): TutorialApp | "general" {
  return APPS_DE_TUTORIAL.includes(t.app as TutorialApp) ? (t.app as TutorialApp) : "general";
}

/**
 * Los tutoriales por app, en el orden fijo, sin grupos vacíos. Dentro de cada grupo, el orden en que
 * los puso el admin. Con texto en el buscador, solo los que lo tienen en el título, sin acentos ni
 * mayúsculas (la misma regla que el directorio).
 */
export function agrupaTutoriales(lista: Tutorial[], filtro = ""): GrupoDeTutoriales[] {
  const q = normaliza(filtro);
  const visibles = q ? lista.filter((t) => normaliza(t.title ?? "").includes(q)) : lista;
  return [...APPS_DE_TUTORIAL, "general" as const]
    .map((app) => ({ app, tutoriales: visibles.filter((t) => appDeTutorial(t) === app) }))
    .filter((g) => g.tutoriales.length > 0);
}

/** Solo el admin añade y quita. La base lo exige también: `settings` solo lo actualiza `is_admin()` (100). */
export function puedeGestionarTutoriales(rol: string | null | undefined): boolean {
  return esAdmin(rol);
}

/** El tutorial nuevo, o `null` si falta el título o el enlace. General se guarda sin `app`. */
export function nuevoTutorial(
  entrada: { title: string; url: string; description?: string; app: TutorialApp | "general"; roles?: readonly string[] },
  autor: { id: string },
  cuando: Date,
  id: string,
): Tutorial | null {
  const title = entrada.title.trim();
  const url = entrada.url.trim();
  if (!title || !url) return null;
  return {
    id,
    title,
    description: entrada.description?.trim() || null,
    url,
    app: entrada.app === "general" ? null : entrada.app,
    roles: limpiaRoles(entrada.roles),
    added_by: autor.id,
    added_at: cuando.toISOString(),
  };
}

/** Lo mínimo del cliente de Supabase que hace falta para guardar, para probarlo sin red. */
export type ClienteDeAjustes = {
  from: (tabla: "settings") => {
    select: (col: "tutorials") => { eq: (c: "id", v: 1) => { maybeSingle: () => PromiseLike<{ data: { tutorials?: unknown } | null; error: unknown }> } };
    update: (v: { tutorials: Tutorial[] }) => { eq: (c: "id", v: 1) => { select: (col: "id") => PromiseLike<{ data: unknown[] | null; error: unknown }> } };
  };
};

export type ResultadoDeGuardar = { ok: true; tutoriales: Tutorial[] } | { ok: false; motivo: "lectura" | "escritura" | "sin_permiso" };

/**
 * Añadir o quitar, contra lo que HAY en la base, no contra lo que tenía la pantalla.
 *
 * - **Se relee la columna entera justo antes de escribir.** La lista de la pantalla sale de
 *   `public.tutorials()`, que no devuelve `added_by` ni `added_at`: reescribir desde ella los
 *   borraría. Y releer acorta la ventana en la que dos admins se pisan.
 * - **Se exige que el update toque una fila** (`.select("id")`). Si la política no deja, PostgREST
 *   vuelve sin error y con cero filas, y eso no es «guardado».
 */
export async function guardaTutoriales(
  cliente: ClienteDeAjustes,
  cambio: (actual: Tutorial[]) => Tutorial[],
): Promise<ResultadoDeGuardar> {
  const { data, error } = await cliente.from("settings").select("tutorials").eq("id", 1).maybeSingle();
  if (error || !data) return { ok: false, motivo: "lectura" };
  const actual = Array.isArray(data.tutorials) ? (data.tutorials as Tutorial[]) : [];
  const siguiente = cambio(actual);
  const { data: filas, error: errorAlGuardar } = await cliente.from("settings").update({ tutorials: siguiente }).eq("id", 1).select("id");
  if (errorAlGuardar) return { ok: false, motivo: "escritura" };
  if (!filas || filas.length !== 1) return { ok: false, motivo: "sin_permiso" };
  return { ok: true, tutoriales: siguiente };
}

// ---- Para quién es cada video (D-NEXT) ---------------------------------------------------------
//
// La audiencia de un video son roles de Entregas que ya existen (`ROLE_INFO`). Vacío = para todos.
// **Quién ve qué NO se decide aquí**: lo decide `public.tutorials()` en la base (114). Aquí solo se
// cambia la lista y se avisa al admin de lo que no va a encontrar nadie.

/** Los roles que se pueden elegir como audiencia, en el orden de siempre. El admin no: ya lo ve todo. */
export const ROLES_DE_AUDIENCIA: readonly UserRole[] = ROLE_ORDER.filter((r) => r !== "admin");

const esRolConocido = (r: string): r is UserRole => Object.prototype.hasOwnProperty.call(ROLE_INFO, r);

/** Solo roles elegibles, sin repetir, en el orden de `ROLE_ORDER`. */
export function limpiaRoles(roles: readonly string[] | null | undefined): UserRole[] {
  const set = new Set(roles ?? []);
  return ROLES_DE_AUDIENCIA.filter((r) => set.has(r));
}

/**
 * Los roles de un video que no existen en `ROLE_INFO`. Si algún día se renombra un rol, un video que
 * lo tenga deja de encontrarlo cualquiera que no sea admin: por eso se enseña al admin, no se calla.
 */
export function rolesDesconocidos(roles: readonly string[] | null | undefined): string[] {
  return [...new Set((roles ?? []).filter((r) => !esRolConocido(r)))];
}

/**
 * ¿Solo lo ve el admin? Sí cuando tiene audiencia y ninguno de sus roles existe: ni es «para todos»
 * ni coincide con el rol de nadie. `admin` como audiencia cuenta como conocido pero no añade a nadie.
 */
export function soloLoVeElAdmin(roles: readonly string[] | null | undefined): boolean {
  const lista = roles ?? [];
  return lista.length > 0 && limpiaRoles(lista).length === 0;
}

/** Poner o quitar un rol en la audiencia de un video. Los desconocidos que tuviera se conservan. */
export function alternaRolDeTutorial(lista: Tutorial[], tutorialId: string, rol: UserRole): Tutorial[] {
  if (!ROLES_DE_AUDIENCIA.includes(rol)) return lista;
  return lista.map((t) => {
    if (t.id !== tutorialId) return t;
    const actuales = t.roles ?? [];
    const roles = actuales.includes(rol) ? actuales.filter((r) => r !== rol) : [...actuales, rol];
    return { ...t, roles };
  });
}

/** Quitar de un video los roles que no existen. Si no le queda ninguno, vuelve a ser para todos. */
export function quitaRolesDesconocidos(lista: Tutorial[], tutorialId: string): Tutorial[] {
  return lista.map((t) => (t.id === tutorialId ? { ...t, roles: (t.roles ?? []).filter((r) => esRolConocido(r)) } : t));
}
