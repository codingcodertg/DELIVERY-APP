import { normaliza } from "@/lib/phone-book";
import { esAdmin } from "@/lib/impersonation";
import type { Tutorial, TutorialApp } from "@/lib/types";

/**
 * Los tutoriales del hub (D-NEXT): agrupar, buscar, quién los gestiona, y guardarlos.
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
  entrada: { title: string; url: string; description?: string; app: TutorialApp | "general" },
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
