/**
 * Los FILTROS GUARDADOS de la tabla de Órdenes (D-440).
 *
 * El dueño, literal (2026-09-28): «create cuztomizable filters that the user sorts different columns and that stays as a
 * filter». La tabla ya filtraba y ordenaba por columna desde el menú de cada cabecera (D-275, D-292), pero eso se perdía al
 * cambiar de pantalla o recargar. Aquí, lo que decide: qué foto se guarda, cómo se aplica, qué se rechaza y qué se ignora al
 * aplicar. Dónde vive (la quinta mitad de la fila `order_columns` de `user_prefs`, `_filtros`) y cómo se sanea lo leído está
 * en `user-prefs.ts`; el tope de tamaño, en `plantillas-de-columnas.ts` (`cabeEnLaFila`), que es el mismo para toda la fila.
 *
 * Aquí no hay React: se prueba con vitest, sin navegador.
 */
import { cabeEnLaFila } from "@/lib/plantillas-de-columnas";
import {
  MAX_FILTROS_GUARDADOS, MAX_NOMBRE_DE_FILTRO, PRESETS_GUARDABLES, filtrosGuardadosValidos,
  type DireccionDeOrden, type FiltroGuardado,
} from "@/lib/user-prefs";

export { MAX_FILTROS_GUARDADOS, MAX_NOMBRE_DE_FILTRO };

/** El orden de la tabla: una columna y una dirección. `null` = sin ordenar (el orden de entrada). */
export interface OrdenDeTabla { clave: string; dir: DireccionDeOrden }
/** Lo que la tabla tiene puesto por columna: filtros (columna → claves marcadas) y orden. Lo guarda la página (D-440). */
export interface VistaDeTabla { filtros: Record<string, Set<string>>; orden: OrdenDeTabla | null }
export const VISTA_VACIA: VistaDeTabla = { filtros: {}, orden: null };

/** Todo lo que decide qué filas se ven y en qué orden en Órdenes. */
export interface EstadoDeOrdenes {
  /** La pastilla de etapa encendida (`filter` en la página). */
  pastilla: string;
  /** El chip de fechas («all», «recent», «today»). */
  preset: string;
  vista: VistaDeTabla;
  lang: "en" | "es";
}

/**
 * Las columnas cuyo VALOR de filtro está traducido: la etapa y la prioridad se filtran por «Programado» / «Scheduled». Un
 * filtro guardado en un idioma sobre una de estas, aplicado en el otro, no encontraría nada — se ignora y se dice.
 */
export const COLUMNAS_SEGUN_IDIOMA: readonly string[] = ["stage", "priority"];

const clave = (nombre: string) => nombre.trim().toLowerCase();

/**
 * La foto de lo que se ve. Los filtros vacíos no se guardan (no filtran); los valores van ordenados, para que dos fotos del
 * mismo estado sean iguales. `conPastilla`: guardar también la pastilla de etapa y el chip de fechas.
 */
export function fotoDeOrdenes(e: EstadoDeOrdenes, conPastilla: boolean): Omit<FiltroGuardado, "n"> {
  const foto: Omit<FiltroGuardado, "n"> = {};
  if (conPastilla) {
    foto.f = e.pastilla;
    if (PRESETS_GUARDABLES.includes(e.preset)) foto.p = e.preset;
  }
  const c: Record<string, string[]> = {};
  for (const [k, s] of Object.entries(e.vista.filtros)) if (s && s.size > 0) c[k] = [...s].sort();
  if (Object.keys(c).length) foto.c = c;
  if (e.vista.orden) foto.s = [e.vista.orden.clave, e.vista.orden.dir];
  foto.l = e.lang;
  return foto;
}

/** El filtro guardado que se llama así, sin distinguir mayúsculas ni espacios de los lados. */
export function filtroLlamado(lista: readonly FiltroGuardado[], nombre: string): FiltroGuardado | undefined {
  const k = clave(nombre);
  return k ? lista.find((g) => clave(g.n) === k) : undefined;
}

export type MotivoDeRechazoDeFiltro = "sin-nombre" | "lleno" | "repetido" | "no-existe" | "no-cabe";
export type ResultadoDeFiltros =
  | { ok: true; lista: FiltroGuardado[]; reemplaza: boolean }
  | { ok: false; motivo: MotivoDeRechazoDeFiltro };

/**
 * Guarda `foto` con `nombre`. Un nombre que ya existe se REEMPLAZA en su sitio: es también «Actualizar con lo que se ve».
 * Uno nuevo va al final, si no se ha llegado a `MAX_FILTROS_GUARDADOS`. Devuelve una lista nueva; la de entrada no se toca.
 */
export function guardaFiltro(lista: readonly FiltroGuardado[], nombre: string, foto: Omit<FiltroGuardado, "n">): ResultadoDeFiltros {
  const n = nombre.trim().slice(0, MAX_NOMBRE_DE_FILTRO);
  if (!n) return { ok: false, motivo: "sin-nombre" };
  const nuevo = filtrosGuardadosValidos([{ ...foto, n }])[0];
  const i = lista.findIndex((g) => clave(g.n) === clave(n));
  if (i >= 0) { const r = [...lista]; r[i] = nuevo; return { ok: true, lista: r, reemplaza: true }; }
  if (lista.length >= MAX_FILTROS_GUARDADOS) return { ok: false, motivo: "lleno" };
  return { ok: true, lista: [...lista, nuevo], reemplaza: false };
}

/** Cambia el nombre de uno, en su sitio y con su contenido. Otro que ya se llame así (sin distinguir mayúsculas) lo impide. */
export function renombraFiltro(lista: readonly FiltroGuardado[], viejo: string, nuevo: string): ResultadoDeFiltros {
  const n = nuevo.trim().slice(0, MAX_NOMBRE_DE_FILTRO);
  if (!n) return { ok: false, motivo: "sin-nombre" };
  const i = lista.findIndex((g) => clave(g.n) === clave(viejo));
  if (i < 0) return { ok: false, motivo: "no-existe" };
  if (lista.some((g, j) => j !== i && clave(g.n) === clave(n))) return { ok: false, motivo: "repetido" };
  const r = [...lista];
  r[i] = { ...lista[i], n };
  return { ok: true, lista: r, reemplaza: true };
}

/** Quita el de ese nombre. Si no está, la lista sale igual (copia). */
export function borraFiltro(lista: readonly FiltroGuardado[], nombre: string): FiltroGuardado[] {
  const k = clave(nombre);
  return lista.filter((g) => clave(g.n) !== k);
}

/** Lo que se ignoró al aplicar, y por qué: la columna ya no existe, está oculta, la pastilla no la ve este rol, o el filtro
 *  se guardó en otro idioma sobre una columna traducida. */
export type AvisoDeFiltro = { tipo: "columna" | "oculta" | "pastilla" | "idioma"; clave: string };

/**
 * Lo que se pone al aplicar un filtro guardado. Se aplica TAL CUAL: los filtros de columna y el orden de la foto sustituyen
 * a los de ahora (sin orden en la foto, se quita el que hubiera). La pastilla y el chip, solo si la foto los trae.
 *
 * Lo que no se puede aplicar no rompe: se deja fuera y se dice (`avisos`).
 * - Una columna que ya no existe en la tabla: fuera, su filtro y su orden.
 * - Una pastilla que este rol no tiene: se queda la de ahora (`pastilla: null`).
 * - Un filtro de «Etapa» o «Prioridad» guardado en el otro idioma: fuera, porque no encontraría ninguna fila.
 * - Una columna que existe pero la persona tiene OCULTA: se pone igual, pero la tabla solo filtra y ordena por las que se
 *   ven (D-360), así que no hace nada hasta que la muestre — y se dice.
 */
export function aplicaFiltroGuardado(
  g: FiltroGuardado,
  ctx: { columnas: readonly string[]; visibles: readonly string[]; pastillas: readonly string[]; lang: "en" | "es" },
): { pastilla: string | null; preset: string | null; vista: VistaDeTabla; avisos: AvisoDeFiltro[] } {
  const avisos: AvisoDeFiltro[] = [];
  const avisa = (a: AvisoDeFiltro) => { if (!avisos.some((x) => x.tipo === a.tipo && x.clave === a.clave)) avisos.push(a); };
  const existe = new Set(ctx.columnas), seVe = new Set(ctx.visibles);
  const filtros: Record<string, Set<string>> = {};
  for (const [k, vals] of Object.entries(g.c ?? {})) {
    if (!existe.has(k)) { avisa({ tipo: "columna", clave: k }); continue; }
    if (g.l && g.l !== ctx.lang && COLUMNAS_SEGUN_IDIOMA.includes(k)) { avisa({ tipo: "idioma", clave: k }); continue; }
    if (!seVe.has(k)) avisa({ tipo: "oculta", clave: k });
    filtros[k] = new Set(vals);
  }
  let orden: OrdenDeTabla | null = null;
  if (g.s) {
    const [k, dir] = g.s;
    if (!existe.has(k)) avisa({ tipo: "columna", clave: k });
    else { if (!seVe.has(k)) avisa({ tipo: "oculta", clave: k }); orden = { clave: k, dir }; }
  }
  let pastilla: string | null = null;
  if (g.f !== undefined) {
    if (ctx.pastillas.includes(g.f)) pastilla = g.f;
    else avisa({ tipo: "pastilla", clave: g.f });
  }
  const preset = g.p !== undefined && PRESETS_GUARDABLES.includes(g.p) ? g.p : null;
  return { pastilla, preset, vista: { filtros, orden }, avisos };
}

/**
 * ¿Lo que se ve ahora es exactamente este filtro guardado? Es lo que enciende su pastilla. La pastilla de etapa y el chip
 * cuentan solo si el filtro los guardó; el idioma no cuenta.
 */
export function coincideConLaVista(g: FiltroGuardado, e: EstadoDeOrdenes): boolean {
  const ahora = fotoDeOrdenes(e, g.f !== undefined);
  if (g.f !== undefined && ahora.f !== g.f) return false;
  if (g.p !== undefined && ahora.p !== g.p) return false;
  const s1 = g.s ? g.s.join("|") : "", s2 = ahora.s ? ahora.s.join("|") : "";
  if (s1 !== s2) return false;
  const c1 = g.c ?? {}, c2 = ahora.c ?? {};
  const k1 = Object.keys(c1).sort(), k2 = Object.keys(c2).sort();
  if (k1.join("|") !== k2.join("|")) return false;
  return k1.every((k) => [...c1[k]].sort().join("\u0000") === c2[k].join("\u0000"));
}

/** El texto de lo ignorado, en los dos idiomas. `nombreDe` pone el nombre de una columna o una pastilla. */
export function textoDeLoIgnorado(avisos: readonly AvisoDeFiltro[], t: (en: string, es: string) => string, nombreDe: (clave: string) => string): string {
  const partes = avisos.map((a) => {
    const x = nombreDe(a.clave);
    switch (a.tipo) {
      case "columna": return t(`the column “${x}” no longer exists`, `la columna «${x}» ya no existe`);
      case "pastilla": return t(`the “${x}” chip is not in your view`, `la pastilla «${x}» no está en su vista`);
      case "idioma": return t(`the “${x}” filter was saved in the other language`, `el filtro de «${x}» se guardó en el otro idioma`);
      case "oculta": return t(`“${x}” is a hidden column: show it in ⚙ Columns for it to apply`, `«${x}» es una columna oculta: muéstrela en ⚙ Columnas para que se aplique`);
    }
  });
  return partes.length ? t("Not applied: ", "No se aplicó: ") + partes.join("; ") + "." : "";
}

/** Lo que dice el mensaje de un rechazo, en los dos idiomas. */
export function textoDelRechazoDeFiltro(motivo: MotivoDeRechazoDeFiltro, t: (en: string, es: string) => string): string {
  switch (motivo) {
    case "sin-nombre": return t("Write a name first.", "Escriba primero un nombre.");
    case "lleno": return t(`You already have ${MAX_FILTROS_GUARDADOS} saved filters. Delete one to save another.`, `Ya tiene ${MAX_FILTROS_GUARDADOS} filtros guardados. Borre uno para guardar otro.`);
    case "repetido": return t("Another saved filter already has that name.", "Ya hay otro filtro guardado con ese nombre.");
    case "no-existe": return t("That saved filter is gone. Reload.", "Ese filtro guardado ya no está. Recargue.");
    case "no-cabe": return t("It does not fit: delete a saved filter or a column template to make room.", "No cabe: borre un filtro guardado o una plantilla de columnas para hacer sitio.");
  }
}

/** La red del navegador (y el sitio del demo, que no tiene base): una llave por PERSONA, no por rol. */
export const claveDeFiltrosEnElNavegador = (userId: string): string => `rtg_filtros_ordenes_${userId}`;

/** Los filtros guardados en este navegador para esta persona, saneados. Un JSON roto no es ningún filtro. */
export function filtrosDelNavegador(leer: (clave: string) => string | null, userId: string): FiltroGuardado[] {
  try { return filtrosGuardadosValidos(JSON.parse(leer(claveDeFiltrosEnElNavegador(userId)) ?? "null")); } catch { return []; }
}

/** De dónde se leen al entrar (como las columnas, D-330): la base si se pudo leer; si no, el navegador. */
export function filtrosAlEntrar(base: { leida: boolean; filtros: FiltroGuardado[] }, delNavegador: FiltroGuardado[]): FiltroGuardado[] {
  return base.leida ? base.filtros : delNavegador;
}

/** Lo que la página pone para guardar. */
export interface DestinoDeFiltros {
  /** El demo: no hay base, los filtros van solo al navegador. */
  sinBase: boolean;
  /** La red: se escribe SIEMPRE, también con base. */
  guardaEnElNavegador: (lista: FiltroGuardado[]) => void;
  /** Si la fila de la base se pudo leer. Sin leerla no se escribe: la fila va entera y se llevaría lo que hubiera. */
  baseLeida: boolean;
  /** La fila entera tal como quedaría con esta lista. */
  filaCon: (lista: FiltroGuardado[]) => Record<string, unknown>;
  /** Escribe la fila y dice si la base la aceptó. */
  escribe: (lista: FiltroGuardado[]) => Promise<boolean>;
}

/**
 * Guarda la lista donde toque. `guardado`: dónde quedó — `"base"`, `"navegador"` (solo en este navegador: el demo, o la base
 * no contestó, y se dice) o `"no"` (no se guardó en ningún sitio: la pantalla no la enseña). `crece`: la lista nueva ocupa más
 * que la vieja; solo entonces se mira si cabe en la fila — borrar nunca se impide.
 */
export async function persisteFiltros(lista: FiltroGuardado[], crece: boolean, d: DestinoDeFiltros, t: (en: string, es: string) => string): Promise<{ guardado: "base" | "navegador" | "no"; texto: string | null }> {
  if (!d.sinBase && d.baseLeida && crece && !cabeEnLaFila(d.filaCon(lista))) return { guardado: "no", texto: textoDelRechazoDeFiltro("no-cabe", t) };
  let enElNavegador = true;
  try { d.guardaEnElNavegador(lista); } catch { enElNavegador = false; }
  if (d.sinBase) return enElNavegador ? { guardado: "navegador", texto: null } : { guardado: "no", texto: t("This browser would not save it.", "Este navegador no lo guardó.") };
  const soloAqui = t("The server did not answer: kept in this browser only, until the server answers again (then what the server has applies).", "El servidor no contestó: queda solo en este navegador, hasta que el servidor vuelva a contestar (entonces vale lo que tenga el servidor).");
  if (!d.baseLeida) return enElNavegador ? { guardado: "navegador", texto: soloAqui } : { guardado: "no", texto: t("Could not save. Try again.", "No se pudo guardar. Inténtelo otra vez.") };
  if (await d.escribe(lista)) return { guardado: "base", texto: null };
  return enElNavegador ? { guardado: "navegador", texto: soloAqui } : { guardado: "no", texto: t("Could not save. Try again.", "No se pudo guardar. Inténtelo otra vez.") };
}
