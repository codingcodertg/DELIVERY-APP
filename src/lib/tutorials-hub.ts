import { normaliza } from "@/lib/phone-book";
import { esAdmin } from "@/lib/impersonation";
import { CLOCKIN_ROLE_LABELS, MODULE_ACCESS, ROLE_ORDER } from "@/lib/constants";
import type { Lang } from "@/lib/prefs";
import type { Tutorial, TutorialApp } from "@/lib/types";

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
    roles: rolesParaApp(entrada.app, entrada.roles),
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

// ---- Para quién es cada video: roles de SU app (D-269, y por app desde D-270) ------------------
//
// La audiencia de un video son roles que ya existen **en la app del video**: los de Entregas para un
// video de Entregas, los de RR. HH. para uno de RR. HH., y así. Vacío = para todos. General usa los de
// Entregas, como en D-269, así que un video sin app y con roles de Entregas se ve igual que antes.
//
// **Quién ve qué NO se decide aquí**: lo decide `public.tutorials()` en la base (115). Aquí están los
// vocabularios, que salen de lo que ya usa cada módulo (`MODULE_ACCESS`, `CLOCKIN_ROLE_LABELS`), y lo
// que se guarda.

type Vocabulario = { claves: readonly string[]; etiqueta: (clave: string, lang: Lang) => string };

const deModulo = (key: string): Vocabulario => {
  const m = MODULE_ACCESS.find((x) => x.key === key);
  if (!m) throw new Error(`sin módulo ${key}`);
  return { claves: m.roleKeys, etiqueta: m.roleLabel };
};

/**
 * Los roles de cada app, con sus etiquetas.
 *
 * - **Entregas y General:** `ROLE_ORDER` menos `admin`, porque el admin de Entregas es el admin del hub
 *   y ya lo ve todo (D-269).
 * - **RR. HH., Time Tracker y ERP:** los de `MODULE_ACCESS`, **con** su admin: el admin de RR. HH. no
 *   es admin del hub, así que un video solo para él tiene sentido.
 * - **Fichaje:** owner, manager y employee, los que emite la vista `clockin.profiles`.
 */
export const ROLES_POR_APP: Record<TutorialApp | "general", Vocabulario> = (() => {
  const entregas = deModulo("deliveries");
  const sinAdmin: Vocabulario = { claves: ROLE_ORDER.filter((r) => r !== "admin"), etiqueta: entregas.etiqueta };
  return {
    deliveries: sinAdmin,
    general: sinAdmin,
    recruiting: deModulo("recruiting"),
    timetracker: deModulo("timetracker"),
    clockin: {
      claves: Object.keys(CLOCKIN_ROLE_LABELS),
      etiqueta: (k, lang) => (lang === "es" ? CLOCKIN_ROLE_LABELS[k]?.es : CLOCKIN_ROLE_LABELS[k]?.en) ?? k,
    },
    erp: deModulo("erp"),
  };
})();

/** El vocabulario de un video según su app. Sin app, o con una que no existe, el de General. */
export const vocabularioDe = (app: Tutorial["app"] | "general" | undefined): Vocabulario =>
  ROLES_POR_APP[appDeTutorial({ app: app === "general" ? null : app })];

/** Solo roles de esa app, sin repetir, en el orden de la app. */
export function rolesParaApp(app: Tutorial["app"] | "general" | undefined, roles: readonly string[] | null | undefined): string[] {
  const set = new Set(roles ?? []);
  return vocabularioDe(app).claves.filter((r) => set.has(r));
}

/**
 * Los roles de un video que no son de su app. Pasa si se renombra un rol, o si alguien cambia la app a
 * mano en la base: no coinciden con nadie, así que se le enseñan al admin.
 */
export function rolesDesconocidos(app: Tutorial["app"] | "general" | undefined, roles: readonly string[] | null | undefined): string[] {
  const validos = new Set(vocabularioDe(app).claves);
  return [...new Set((roles ?? []).filter((r) => !validos.has(r)))];
}

/** ¿Solo lo ve el admin? Sí cuando tiene audiencia y ninguno de sus roles es de su app. */
export function soloLoVeElAdmin(app: Tutorial["app"] | "general" | undefined, roles: readonly string[] | null | undefined): boolean {
  return (roles ?? []).length > 0 && rolesParaApp(app, roles).length === 0;
}

/**
 * Cambiar la app de lo que se está editando. **Los roles que no son de la app nueva se quitan**, y se
 * devuelven para decirlo en el formulario: dejarlos colgando haría que el video no lo viera nadie más
 * que el admin, sin que nada lo avisara. Los que existen en las dos apps (p. ej. `manager`) se quedan.
 */
export function cambiaApp(
  roles: readonly string[],
  nuevaApp: TutorialApp | "general",
): { roles: string[]; quitados: string[] } {
  const quedan = rolesParaApp(nuevaApp, roles);
  return { roles: quedan, quitados: roles.filter((r) => !quedan.includes(r)) };
}

/**
 * Editar un video: título, descripción, enlace, app y roles, con las mismas reglas que al añadir. Se
 * conservan la id, el autor y la fecha. `null` si falta el título o el enlace, o si el video no existe.
 */
export function editaTutorial(
  lista: Tutorial[],
  id: string,
  entrada: { title: string; url: string; description?: string; app: TutorialApp | "general"; roles?: readonly string[] },
): Tutorial[] | null {
  const actual = lista.find((t) => t.id === id);
  if (!actual) return null;
  const nuevo = nuevoTutorial(entrada, { id: actual.added_by ?? "" }, new Date(actual.added_at ?? 0), id);
  if (!nuevo) return null;
  const editado: Tutorial = { ...actual, ...nuevo, added_by: actual.added_by, added_at: actual.added_at };
  return lista.map((t) => (t.id === id ? editado : t));
}
