/**
 * 🔒 Rutas bloqueadas del Gestor de Rutas (D-411): una ruta (un chofer o una ruta temporal) en un DÍA que las
 * herramientas automáticas no tocan. Desde D-437 son dos: «Armar las rutas del día» (el motor, en el servidor) y
 * «📍 Mejor lugar» (con el arrastre al nombre de un chofer, que es Mejor lugar). Hasta D-437 también «Optimizar todas las
 * rutas», su «Optimizar ruta», «Simular», el dibujo automático al elegir un chofer y «✨ Auto-asignar», que se quitaron.
 * Es el `lockType: ROUTES` de OptimoRoute
 * (docs/research-route-optimization.md §1.3). A mano sigue editable: flechas, «Asignar», quitar, mover de viaje.
 *
 * **Dónde vive (D-414): en la base, `public.route_locks` (migración 149), si la tabla está; si no, en ESTE navegador.**
 * Con la tabla, el candado lo ve todo logística y lo respeta también «Planificar el día» (el motor, en el servidor:
 * `rutasBloqueadasDelDia`). Sin ella —la 149 se aplica después de fusionar, o se revierte—, la pantalla sigue como en
 * D-411, con `localStorage`, y lo dice (`fuente: "navegador"`). Todo lo que lee o escribe el candado pasa por este
 * fichero: la pantalla no sabe dónde vive.
 *
 * Por qué no servía nada de lo que ya había (D-411): `settings` la escribe solo el admin, `user_prefs` es de cada
 * persona, `route_plans` son fotos de un plan, y `driver_availability` significa «no disponible».
 *
 * Forma en el navegador: `{ "<fecha>": ["<clave de ruta>", …] }` bajo `rtg_rutas_bloqueadas`. Se olvida lo de hace más
 * de 14 días. En la base, una fila por (día, ruta); se leen las de los últimos 14 días.
 */

export const LLAVE_DE_BLOQUEOS = "rtg_rutas_bloqueadas";
const DIAS_QUE_SE_GUARDAN = 14;

export type Bloqueos = Record<string, string[]>;

interface Almacen { getItem(k: string): string | null; setItem(k: string, v: string): void }

export function leeBloqueos(almacen: Almacen | null | undefined): Bloqueos {
  try {
    const crudo = almacen?.getItem(LLAVE_DE_BLOQUEOS);
    if (!crudo) return {};
    const v = JSON.parse(crudo) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Bloqueos = {};
    for (const [fecha, lista] of Object.entries(v as Record<string, unknown>)) {
      if (Array.isArray(lista)) out[fecha] = lista.filter((x): x is string => typeof x === "string");
    }
    return out;
  } catch {
    return {};
  }
}

export const estaBloqueada = (b: Bloqueos, fecha: string, ruta: string): boolean => (b[fecha] ?? []).includes(ruta);

/** Pone o quita el candado de una ruta en un día. Devuelve una copia; lo de más de 14 días antes de `hoy` se olvida. */
export function alternaBloqueo(b: Bloqueos, fecha: string, ruta: string, hoy: string): Bloqueos {
  const lista = b[fecha] ?? [];
  const nueva = lista.includes(ruta) ? lista.filter((x) => x !== ruta) : [...lista, ruta];
  const limite = new Date(`${hoy}T00:00:00Z`).getTime() - DIAS_QUE_SE_GUARDAN * 86_400_000;
  const out: Bloqueos = {};
  for (const [f, l] of Object.entries({ ...b, [fecha]: nueva })) {
    const t = new Date(`${f}T00:00:00Z`).getTime();
    if (l.length && (!Number.isFinite(t) || t >= limite)) out[f] = l;
  }
  return out;
}

export function guardaBloqueos(almacen: Almacen | null | undefined, b: Bloqueos): void {
  try { almacen?.setItem(LLAVE_DE_BLOQUEOS, JSON.stringify(b)); } catch { /* navegador sin almacén: el candado dura la visita */ }
}

// ---------------------------------------------------------------------------------------------------------------
// El candado compartido: `public.route_locks` (149). Bloquear = insertar la fila; desbloquear = borrarla.
// ---------------------------------------------------------------------------------------------------------------

export const TABLA_DE_CANDADOS = "route_locks";

interface ErrorDeLaBase { code?: string | null; message?: string | null }
type Respuesta<T> = PromiseLike<{ data: T | null; error: ErrorDeLaBase | null }>;
export interface FilaDeCandado { plan_date: string; lane: string; locked_by: string | null; locked_at?: string | null }

/** Lo mínimo del cliente de Supabase que usa esto (el del navegador y el del servidor lo cumplen). */
export interface ClienteDeCandados {
  from(tabla: string): {
    select(columnas: string): { gte(col: string, v: string): Respuesta<FilaDeCandado[]>; eq(col: string, v: string): Respuesta<FilaDeCandado[]> };
    insert(fila: { plan_date: string; lane: string }): Respuesta<unknown>;
    delete(): { eq(col: string, v: string): { eq(col: string, v: string): Respuesta<unknown> } };
  };
}

/**
 * ¿El fallo es que la tabla no existe (la 149 sin aplicar)? PostgREST contesta `PGRST205` («Could not find the table …
 * in the schema cache»); Postgres, `42P01`. Cualquier otro fallo NO es «no hay tabla»: es un fallo, y se dice como tal.
 */
export function faltaLaTabla(e: ErrorDeLaBase | null | undefined): boolean {
  if (!e) return false;
  if (e.code === "PGRST205" || e.code === "42P01") return true;
  const m = String(e.message ?? "");
  return m.includes(TABLA_DE_CANDADOS) && /could not find the table|does not exist/i.test(m);
}

const menosDias = (hoy: string, dias: number) => new Date(Date.parse(`${hoy}T00:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10);
const claveDeQuien = (fecha: string, ruta: string) => `${fecha}|${ruta}`;

/** Filas de la base → la misma forma que el navegador, y quién puso cada candado (`"<fecha>|<ruta>"` → id). */
export function bloqueosDeFilas(filas: readonly FilaDeCandado[]): { bloqueos: Bloqueos; quien: Record<string, string | null> } {
  const bloqueos: Bloqueos = {}, quien: Record<string, string | null> = {};
  for (const f of filas) {
    const fecha = String(f.plan_date).slice(0, 10);
    if (!f.lane) continue;
    const lista = (bloqueos[fecha] ??= []);
    if (!lista.includes(f.lane)) lista.push(f.lane);
    quien[claveDeQuien(fecha, f.lane)] = f.locked_by ?? null;
  }
  return { bloqueos, quien };
}
export const quienBloqueo = (quien: Record<string, string | null>, fecha: string, ruta: string): string | null => quien[claveDeQuien(fecha, ruta)] ?? null;

export type CandadosLeidos =
  | { fuente: "base"; bloqueos: Bloqueos; quien: Record<string, string | null> }
  /** `sin_tabla`: la 149 no está; `error`: la lectura falló por otra cosa. En los dos, la pantalla usa el navegador. */
  | { fuente: "navegador"; motivo: "sin_tabla" | "error"; detalle?: string };

/** Los candados de los últimos 14 días (y los futuros), de la base. */
export async function leeCandadosCompartidos(cliente: ClienteDeCandados, hoy: string): Promise<CandadosLeidos> {
  try {
    const { data, error } = await cliente.from(TABLA_DE_CANDADOS).select("plan_date, lane, locked_by, locked_at").gte("plan_date", menosDias(hoy, DIAS_QUE_SE_GUARDAN));
    if (error) return { fuente: "navegador", motivo: faltaLaTabla(error) ? "sin_tabla" : "error", detalle: error.message ?? undefined };
    return { fuente: "base", ...bloqueosDeFilas(data ?? []) };
  } catch (e) {
    return { fuente: "navegador", motivo: "error", detalle: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Pone (`bloquear: true`) o quita el candado de una ruta en un día, en la base. Poner uno que otra persona acaba de poner
 * choca con la clave (`23505`) y cuenta como hecho: la ruta queda bloqueada, que es lo que se pidió.
 */
export async function ponCandadoCompartido(cliente: ClienteDeCandados, fecha: string, ruta: string, bloquear: boolean): Promise<{ ok: true } | { ok: false; faltaLaTabla: boolean; detalle: string }> {
  try {
    const { error } = bloquear
      ? await cliente.from(TABLA_DE_CANDADOS).insert({ plan_date: fecha, lane: ruta })
      : await cliente.from(TABLA_DE_CANDADOS).delete().eq("plan_date", fecha).eq("lane", ruta);
    if (!error || (bloquear && error.code === "23505")) return { ok: true };
    return { ok: false, faltaLaTabla: faltaLaTabla(error), detalle: error.message ?? String(error.code ?? "error") };
  } catch (e) {
    return { ok: false, faltaLaTabla: false, detalle: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Para el servidor («Planificar el día», «Publicar ruta»): las rutas bloqueadas de UN día. Sin la tabla, `sin_tabla` —el
 * motor planifica como antes de la 149—; con otro fallo, `error`, y quien llama NO debe seguir como si no hubiera candados
 * (movería rutas que alguien bloqueó).
 */
export async function rutasBloqueadasDelDia(cliente: ClienteDeCandados, fecha: string): Promise<{ fuente: "base"; rutas: string[] } | { fuente: "sin_tabla" } | { fuente: "error"; detalle: string }> {
  try {
    const { data, error } = await cliente.from(TABLA_DE_CANDADOS).select("plan_date, lane, locked_by").eq("plan_date", fecha);
    if (error) return faltaLaTabla(error) ? { fuente: "sin_tabla" } : { fuente: "error", detalle: error.message ?? String(error.code ?? "error") };
    return { fuente: "base", rutas: [...new Set((data ?? []).map((f) => f.lane).filter(Boolean))] };
  } catch (e) {
    return { fuente: "error", detalle: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Lo que usa la pantalla: de dónde leer, dónde escribir, y qué decir. La pantalla no elige el almacén.
// ---------------------------------------------------------------------------------------------------------------

export interface EstadoDeCandados {
  bloqueos: Bloqueos;
  quien: Record<string, string | null>;
  /** `base`: compartido (149). `navegador`: solo aquí — `demo` (sin base), `sin_tabla` (la 149 no está) o `error`. */
  fuente: "base" | "navegador";
  motivo: "demo" | "sin_tabla" | "error" | null;
}
export const CANDADOS_SIN_LEER: EstadoDeCandados = { bloqueos: {}, quien: {}, fuente: "navegador", motivo: null };

export interface OpcionesDeCandados {
  /** El demo (`NEXT_PUBLIC_LOCAL_MODE`): no hay base a la que preguntar. */
  sinBase: boolean;
  cliente: () => ClienteDeCandados;
  navegador: Almacen | null | undefined;
  hoy: string;
}

/** Lee los candados de donde toque: la base si tiene la tabla; si no, este navegador, y dice por qué. */
export async function cargaCandados(o: OpcionesDeCandados): Promise<EstadoDeCandados> {
  if (o.sinBase) return { bloqueos: leeBloqueos(o.navegador), quien: {}, fuente: "navegador", motivo: "demo" };
  const r = await leeCandadosCompartidos(o.cliente(), o.hoy);
  if (r.fuente === "base") return { bloqueos: r.bloqueos, quien: r.quien, fuente: "base", motivo: null };
  return { bloqueos: leeBloqueos(o.navegador), quien: {}, fuente: "navegador", motivo: r.motivo };
}

/**
 * Pulsar el candado de una ruta en un día. Con la base: escribe la fila y vuelve a leer (así se ve también lo que puso
 * otra persona); si falla, NO cambia nada y devuelve el error. Si la tabla desapareció (la 149 revertida), pasa al
 * navegador. Sin la base: como en D-411, en `localStorage`.
 */
export async function pulsaCandado(estado: EstadoDeCandados, fecha: string, ruta: string, o: OpcionesDeCandados): Promise<{ estado: EstadoDeCandados; bloqueada: boolean; error: string | null }> {
  const nuevos = alternaBloqueo(estado.bloqueos, fecha, ruta, o.hoy);
  const bloqueada = estaBloqueada(nuevos, fecha, ruta);
  if (estado.fuente === "base") {
    const r = await ponCandadoCompartido(o.cliente(), fecha, ruta, bloqueada);
    if (r.ok) return { estado: await cargaCandados(o), bloqueada, error: null };
    if (!r.faltaLaTabla) return { estado, bloqueada: estaBloqueada(estado.bloqueos, fecha, ruta), error: r.detalle };
    const local = alternaBloqueo(leeBloqueos(o.navegador), fecha, ruta, o.hoy);
    guardaBloqueos(o.navegador, local);
    return { estado: { bloqueos: local, quien: {}, fuente: "navegador", motivo: "sin_tabla" }, bloqueada: estaBloqueada(local, fecha, ruta), error: null };
  }
  guardaBloqueos(o.navegador, nuevos);
  return { estado: { ...estado, bloqueos: nuevos }, bloqueada, error: null };
}

/** Dónde vive el candado, dicho para quien lo pulsa. */
export function dondeViveElCandado(e: Pick<EstadoDeCandados, "fuente" | "motivo">): { en: string; es: string } {
  if (e.fuente === "base") return { en: "Shared: all of logistics sees it, and “Plan the day” respects it.", es: "Compartido: lo ve todo logística, y «Planificar el día» lo respeta." };
  if (e.motivo === "sin_tabla") return { en: "Only in this browser: the database doesn't have the locks table yet (migration 149). Others don't see it.", es: "Solo en este navegador: la base aún no tiene la tabla de candados (migración 149). Los demás no lo ven." };
  if (e.motivo === "error") return { en: "Only in this browser: the shared locks couldn't be read. Others don't see it.", es: "Solo en este navegador: no se pudieron leer los candados compartidos. Los demás no lo ven." };
  return { en: "Only in this browser.", es: "Solo en este navegador." };
}

/**
 * «Publicar ruta» con un candado puesto DESPUÉS de planificar: ¿qué órdenes del plan tocan una ruta bloqueada? Una
 * escritura choca si asigna a una ruta bloqueada, o si mueve (o reordena) una orden que HOY está en una ruta bloqueada.
 * Devuelve las órdenes que chocan, con su ruta; vacío = se puede publicar.
 */
export function chocaConLosCandados(
  escrituras: readonly { id: string; assigned_driver: string }[],
  asignadaHoy: ReadonlyMap<string, string | null>,
  rutasBloqueadas: readonly string[],
): { id: string; ruta: string }[] {
  const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  const bloqueadas = new Set(rutasBloqueadas.map(norm).filter(Boolean));
  const choques: { id: string; ruta: string }[] = [];
  for (const w of escrituras) {
    const hoy = asignadaHoy.get(w.id) ?? null;
    if (bloqueadas.has(norm(w.assigned_driver))) choques.push({ id: w.id, ruta: w.assigned_driver });
    else if (hoy && bloqueadas.has(norm(hoy))) choques.push({ id: w.id, ruta: hoy });
  }
  return choques;
}

/** Lo mínimo para leer a quién está asignada HOY cada orden (solo lectura). */
export interface ClienteDeOrdenes {
  from(tabla: string): { select(columnas: string): { in(col: string, v: string[]): Respuesta<{ id: string; assigned_driver: string | null }[]> } };
}

/**
 * Para «Publicar ruta»: ¿choca el plan con algún candado de su día? Lee los candados y, si hay, a quién está asignada hoy
 * cada orden que el plan escribiría. Solo lee. Sin la tabla, `sin_tabla` (se publica como antes de la 149).
 */
export async function choquesAlPublicar(
  candados: ClienteDeCandados, ordenes: ClienteDeOrdenes, fecha: string, escrituras: readonly { id: string; assigned_driver: string }[],
): Promise<{ fuente: "base"; choques: { id: string; ruta: string }[] } | { fuente: "sin_tabla" } | { fuente: "error"; detalle: string }> {
  const bloqueadas = await rutasBloqueadasDelDia(candados, fecha);
  if (bloqueadas.fuente !== "base") return bloqueadas;
  if (!bloqueadas.rutas.length || !escrituras.length) return { fuente: "base", choques: [] };
  try {
    const { data, error } = await ordenes.from("deliveries").select("id, assigned_driver").in("id", escrituras.map((w) => w.id));
    if (error) return { fuente: "error", detalle: error.message ?? String(error.code ?? "error") };
    return { fuente: "base", choques: chocaConLosCandados(escrituras, new Map((data ?? []).map((d) => [d.id, d.assigned_driver])), bloqueadas.rutas) };
  } catch (e) {
    return { fuente: "error", detalle: e instanceof Error ? e.message : String(e) };
  }
}
