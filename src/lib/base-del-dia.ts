import { ciudadDeEntrega } from "./ciudad-de-entrega";
import { claveDeZona } from "./route-engine";
import type { DriverSettings, NamedLocation, Profile } from "./types";
import { zonasDelChofer } from "./zonas";

/**
 * De qué tienda SALE y en cuál TERMINA cada chofer, un día concreto (migración 166, `driver_day_bases`).
 *
 * El dueño, 2026-10-11 (dictado, literal): «choose the driver strarting position LOGISTIC MANAGER, DEFAULT IS THE ONE HE
 * ALREADY WORKS ON». Y el mismo día: «Need to be able to assign store where driver is starting/ ending at. For example,
 * Julio will start in mcallen 10/12/26 to use other truck since his is in maintenance».
 *
 * Hasta aquí la tienda de la que sale el camión y a la que vuelve era UNA y fija: la de Ajustes → Rutas
 * (`driver_settings.base_store`) o, si no, la del perfil (D-461). Ahora el gerente de logística (o el admin) la cambia para
 * UN día desde el panel «Choferes y rutas» del Gestor. Al día siguiente vuelve a su base, salvo que se cambie también.
 *
 * **Qué manda** (todo lo que usa la salida del chofer pasa por aquí: «Armar rutas», «Asignar a…», «Optimizar», la medida de
 * la tarjeta —millas, horas, llegadas—, el mapa y la vuelta):
 *   · la SALIDA: la elegida para ese día > la base de Ajustes → Rutas > la tienda de su perfil. Sin ninguna, sin base (ruta
 *     abierta y «⚠ sin base», como siempre);
 *   · el FIN: el elegido para ese día > donde sale ese día. Sin elegir nada, su base (sale de ella y vuelve a ella, como
 *     siempre). Si el chofer no vuelve a base (Ajustes, `returns_to_base`), no hay fin: la ruta acaba en su última parada.
 *
 * Por qué el fin sigue a la SALIDA y no a la base cuando no se elige: el caso del dueño es justo ese —Julio sale de McAllen
 * porque allí está el otro camión, y el camión tiene que volver allí—. Con el fin pegado a la base, cambiar la salida dejaría
 * el camión en Pharr sin que nadie lo pidiera. Quien lo quiera en otra tienda, lo elige.
 *
 * Todo puro salvo las dos funciones de la base (`leeBasesDelDia`, `guardaBaseDelDia`), que reciben el cliente inyectado.
 */

export const TABLA_DE_BASES_DEL_DIA = "driver_day_bases";

/** Lo elegido para un chofer un día. `null` = lo de siempre (la salida, su base; el fin, donde sale). */
export interface BaseDelDia { salida: string | null; fin: string | null }

/** Lo elegido para cada chofer de un día, por el ID del chofer (`profiles.id`). Sin entrada, lo de siempre. */
export type BasesDelDia = Readonly<Record<string, BaseDelDia>>;

export type OrigenDeLaSalida = "dia" | "ajustes" | "perfil";
export type OrigenDelFin = "dia" | "salida";

export interface ExtremosDelChofer {
  /** De dónde sale ese día. `null`: sin base (ruta abierta). */
  salida: { tienda: NamedLocation; origen: OrigenDeLaSalida } | null;
  /** Dónde termina ese día. `null`: no vuelve a base, o no tiene salida. */
  fin: { tienda: NamedLocation; origen: OrigenDelFin } | null;
  /** Su base DE SIEMPRE, sin lo del día: la que el selector marca «(su base)». */
  base: { tienda: NamedLocation; origen: "ajustes" | "perfil" } | null;
}

const igual = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/** La tienda de Ajustes con ese nombre (sin mayúsculas ni espacios de más), o `null`. Un nombre que ya no es una tienda no vale. */
export function tiendaPorNombre(tiendas: readonly NamedLocation[], nombre: string | null | undefined): NamedLocation | null {
  if (!(nombre ?? "").trim()) return null;
  return tiendas.find((s) => igual(s.name, nombre)) ?? null;
}

/**
 * QUÉ MANDA, para un chofer y un día: la salida (lo elegido para ese día > Ajustes > perfil), el fin (lo elegido > la salida
 * de ese día; nada si no vuelve) y su base de siempre. Un nombre que no es una tienda de Ajustes se salta, como si no
 * estuviera: una tienda borrada de Ajustes no deja a nadie sin base.
 */
export function extremosDelChofer(a: {
  delDia?: BaseDelDia | null; deAjustes?: string | null; dePerfil?: string | null; vuelve?: boolean; tiendas: readonly NamedLocation[];
}): ExtremosDelChofer {
  const deAjustes = tiendaPorNombre(a.tiendas, a.deAjustes);
  const dePerfil = deAjustes ? null : tiendaPorNombre(a.tiendas, a.dePerfil);
  const base: ExtremosDelChofer["base"] = deAjustes ? { tienda: deAjustes, origen: "ajustes" } : dePerfil ? { tienda: dePerfil, origen: "perfil" } : null;
  const elegida = tiendaPorNombre(a.tiendas, a.delDia?.salida);
  const salida: ExtremosDelChofer["salida"] = elegida ? { tienda: elegida, origen: "dia" } : base;
  if (!salida || a.vuelve === false) return { salida, fin: null, base };
  const finElegido = tiendaPorNombre(a.tiendas, a.delDia?.fin);
  return { salida, fin: finElegido ? { tienda: finElegido, origen: "dia" } : { tienda: salida.tienda, origen: "salida" }, base };
}

/** Lo que el Gestor sabe para decidir los extremos de una ruta: todo por el NOMBRE del chofer (la clave de la ruta). */
export interface FuentesDeLaBase {
  /** Lo elegido para el día que se mira, por nombre (`basesPorNombreDelDia`). */
  delDia: ReadonlyMap<string, BaseDelDia>;
  /** La base de Ajustes → Rutas, por nombre (`basesPorNombre`). */
  deAjustes: ReadonlyMap<string, string>;
  usuarios: readonly Pick<Profile, "full_name" | "store">[];
  /** Los choferes que NO vuelven a base (Ajustes, `returns_to_base` en falso), por nombre. */
  noVuelven?: ReadonlySet<string>;
  tiendas: readonly NamedLocation[];
}

/** Los extremos de la ruta de un chofer en el Gestor, por su nombre. Una ruta temporal (nadie con ese nombre) no tiene. */
export function extremosDeLaRuta(chofer: string, f: FuentesDeLaBase): ExtremosDelChofer {
  const nombre = (chofer ?? "").trim();
  if (!nombre) return { salida: null, fin: null, base: null };
  return extremosDelChofer({
    delDia: f.delDia.get(nombre), deAjustes: f.deAjustes.get(nombre),
    dePerfil: f.usuarios.find((u) => (u.full_name ?? "").trim() === nombre)?.store, vuelve: !f.noVuelven?.has(nombre), tiendas: f.tiendas,
  });
}

/** Lo elegido del día (por id) → por NOMBRE del chofer, que es como el Gestor nombra las rutas. */
export function basesPorNombreDelDia(bases: BasesDelDia, usuarios: readonly Pick<Profile, "id" | "full_name">[]): Map<string, BaseDelDia> {
  const nombreDe = new Map(usuarios.map((u) => [u.id, (u.full_name ?? "").trim()]));
  const m = new Map<string, BaseDelDia>();
  for (const [id, b] of Object.entries(bases)) { const n = nombreDe.get(id); if (n) m.set(n, b); }
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------
// La zona (D-479): sigue a la SALIDA del día.

/**
 * Las zonas de un chofer ESE día. La regla de D-479 (`motor-8`) cobra cara la recogida en la tienda de la zona de OTRO: «cada
 * chofer carga en su tienda». Si ese día sale de otra tienda, su tienda ese día es ESA: la ciudad de su base de siempre se
 * cambia por la de la tienda de la que sale. Sin esto, Julio saliendo de McAllen pagaría por cargar en McAllen (zona de
 * Ernesto) y el motor lo mandaría vacío a Pharr a cargar. Y Pharr, sin Julio, queda sin dueño ese día si nadie más la tiene:
 * nadie paga por ir.
 *
 * Un chofer SIN zonas sigue sin zonas: darle una le haría pagar por las de los demás. Sin cambio de salida, o con la misma
 * ciudad, las de siempre. Se compara como el motor (`claveDeZona`).
 */
export function zonasDelDia(zonas: readonly string[], ciudadDeLaBase: string, ciudadDeLaSalida: string): string[] {
  const deLaSalida = claveDeZona(ciudadDeLaSalida), deLaBase = claveDeZona(ciudadDeLaBase);
  if (!zonas.length || !deLaSalida || deLaSalida === deLaBase) return [...zonas];
  const quedan = zonas.filter((z) => !deLaBase || claveDeZona(z) !== deLaBase);
  return quedan.some((z) => claveDeZona(z) === deLaSalida) ? quedan : [...quedan, ciudadDeLaSalida.trim()];
}

// ---------------------------------------------------------------------------------------------------------------------
// Para el motor («Armar rutas» en el servidor, «Asignar a…» en el Gestor): las filas de Ajustes con lo del día puesto.

const FILA_DE_PARTIDA = { capacity_pallets: null, shift_start: "", shift_end: "", returns_to_base: true, routable: true } as const;

/**
 * Las filas de `driver_settings` tal como valen ESE día: la base es la tienda de la que sale (`base_store`), las zonas siguen
 * a la salida (`zonasDelDia`) y, aparte, dónde termina cada uno que no termina donde sale (`fin`, por id). Sin nada elegido,
 * las mismas filas, sin tocar: el motor planifica byte a byte lo de siempre.
 *
 * Un chofer sin fila de Ajustes al que se le elige una salida entra con los valores de partida de `choferParaElMotor`
 * (turno 08:00–17:30, vuelve a base, rutea): sin esto, elegirle de dónde sale no serviría de nada en «Armar rutas», que
 * sin base lo deja fuera. Uno que no rutea (`routable` en falso) sigue sin rutear: elegir su salida no lo pone a trabajar.
 */
export function ajustesDelDia(
  filas: readonly DriverSettings[], choferes: readonly Pick<Profile, "id">[], bases: BasesDelDia | undefined, tiendas: readonly NamedLocation[],
): { filas: DriverSettings[]; fin: Map<string, string> } {
  const fin = new Map<string, string>();
  const elegidos = Object.keys(bases ?? {});
  if (!elegidos.length) return { filas: [...filas], fin };
  const conocidas = filas.flatMap((f) => zonasDelChofer(f));
  const ciudadDe = (t: NamedLocation | null) => (t ? ciudadDeEntrega(t.address, conocidas) : "");
  const porId = new Map(filas.map((f) => [f.profile_id, f]));
  const out = filas.map((f) => ({ ...f }));
  for (const c of choferes) {
    const b = bases?.[c.id];
    if (!b) continue;
    const salida = tiendaPorNombre(tiendas, b.salida);
    let fila = porId.get(c.id) ? out.find((f) => f.profile_id === c.id)! : null;
    if (!fila) {
      if (!salida) continue;
      fila = { profile_id: c.id, base_store: null, ...FILA_DE_PARTIDA };
      out.push(fila);
    }
    const deSiempre = tiendaPorNombre(tiendas, fila.base_store);
    if (salida) {
      if (fila.preferred_zones?.length) fila.preferred_zones = zonasDelDia(zonasDelChofer(fila), ciudadDe(deSiempre), ciudadDe(salida));
      fila.base_store = salida.name;
    }
    const finElegido = tiendaPorNombre(tiendas, b.fin);
    if (finElegido && !igual(finElegido.name, fila.base_store)) fin.set(c.id, finElegido.name);
  }
  return { filas: out, fin };
}

// ---------------------------------------------------------------------------------------------------------------------
// El selector: qué se ofrece y qué se guarda.

export interface OpcionDeTienda {
  /** Lo que se guarda: el nombre de la tienda, o «» = lo de siempre. */
  valor: string;
  en: string;
  es: string;
  /** Sin punto en el mapa: el motor no puede sacar a nadie de ahí («su tienda base no tiene punto»). */
  apagada: boolean;
}

const sinPunto = (t: NamedLocation) => t.lat == null || t.lng == null;

/**
 * Las opciones de «Sale de»: primero «lo de siempre» (su base, marcada «(su base)»), y después las demás tiendas de Ajustes.
 * Sin base, la primera dice «sin base». Una tienda sin punto en el mapa sale apagada, con su porqué.
 */
export function opcionesDeSalida(tiendas: readonly NamedLocation[], base: NamedLocation | null): OpcionDeTienda[] {
  const primera: OpcionDeTienda = base
    ? { valor: "", en: `${base.name} (their base)`, es: `${base.name} (su base)`, apagada: false }
    : { valor: "", en: "— no base —", es: "— sin base —", apagada: false };
  return [primera, ...tiendas.filter((t) => !base || !igual(t.name, base.name)).map((t) => opcionDeTienda(t))];
}

/**
 * Las de «Termina en»: primero «lo de siempre» (donde sale ese día, «(como la salida)»; si sale de su base, «(su base)»), y
 * después las demás, con la base marcada.
 */
export function opcionesDeFin(tiendas: readonly NamedLocation[], salida: NamedLocation | null, base: NamedLocation | null): OpcionDeTienda[] {
  if (!salida) return [{ valor: "", en: "— no base —", es: "— sin base —", apagada: false }];
  const esLaBase = !!base && igual(salida.name, base.name);
  const primera: OpcionDeTienda = { valor: "", en: `${salida.name} (${esLaBase ? "their base" : "same as start"})`, es: `${salida.name} (${esLaBase ? "su base" : "como la salida"})`, apagada: false };
  return [primera, ...tiendas.filter((t) => !igual(t.name, salida.name)).map((t) => opcionDeTienda(t, !!base && igual(t.name, base.name)))];
}

const opcionDeTienda = (t: NamedLocation, esLaBase = false): OpcionDeTienda => ({
  valor: t.name,
  en: `${t.name}${esLaBase ? " (their base)" : ""}${sinPunto(t) ? " — no map point" : ""}`,
  es: `${t.name}${esLaBase ? " (su base)" : ""}${sinPunto(t) ? " — sin punto en el mapa" : ""}`,
  apagada: sinPunto(t),
});

/**
 * Lo que queda guardado tras cambiar la salida o el fin de un chofer un día, ya limpio: elegir su base como salida es «lo de
 * siempre» (`null`), y elegir como fin la tienda de la que sale ese día, también. Si las dos quedan en «lo de siempre», `null`:
 * se BORRA la fila y ese día vuelve a ser como cualquier otro.
 */
export function baseTrasElCambio(
  actual: BaseDelDia | null | undefined, cambio: Partial<BaseDelDia>, base: NamedLocation | null,
): BaseDelDia | null {
  const salida0 = "salida" in cambio ? cambio.salida ?? null : actual?.salida ?? null;
  const salida = salida0 && !(base && igual(salida0, base.name)) ? salida0.trim() : null;
  const dondeSale = salida ?? base?.name ?? null;
  const fin0 = "fin" in cambio ? cambio.fin ?? null : actual?.fin ?? null;
  const fin = fin0 && !(dondeSale && igual(fin0, dondeSale)) ? fin0.trim() : null;
  return salida || fin ? { salida, fin } : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// La base de datos: `public.driver_day_bases` (166). Sin la tabla, todo como siempre.

interface ErrorDeLaBase { code?: string | null; message?: string | null }
type Respuesta<T> = PromiseLike<{ data: T | null; error: ErrorDeLaBase | null }>;
export interface FilaDeBaseDelDia { plan_date: string; driver_id: string; start_store: string | null; end_store: string | null }

/** Lo mínimo del cliente de Supabase que usa esto (el del navegador y el del servidor lo cumplen). */
export interface ClienteDeBasesDelDia {
  from(tabla: string): {
    select(columnas: string): { eq(col: string, v: string): Respuesta<FilaDeBaseDelDia[]> };
    upsert(fila: FilaDeBaseDelDia, opciones: { onConflict: string }): Respuesta<unknown>;
    delete(): { eq(col: string, v: string): { eq(col: string, v: string): Respuesta<unknown> } };
  };
}

/** ¿El fallo es que la tabla no existe (la 166 sin aplicar)? PostgREST: `PGRST205`; Postgres: `42P01`. Otro fallo es un fallo. */
export function faltaLaTablaDeBases(e: ErrorDeLaBase | null | undefined): boolean {
  if (!e) return false;
  if (e.code === "PGRST205" || e.code === "42P01") return true;
  const m = String(e.message ?? "");
  return m.includes(TABLA_DE_BASES_DEL_DIA) && /could not find the table|does not exist/i.test(m);
}

/** Filas de la base → lo elegido por chofer. Una fila sin nada que diga (o con nombres vacíos) no cuenta. */
export function basesDeFilas(filas: readonly FilaDeBaseDelDia[]): Record<string, BaseDelDia> {
  const out: Record<string, BaseDelDia> = {};
  for (const f of filas) {
    const salida = (f.start_store ?? "").trim() || null, fin = (f.end_store ?? "").trim() || null;
    if (f.driver_id && (salida || fin)) out[f.driver_id] = { salida, fin };
  }
  return out;
}

export type BasesLeidas = { fuente: "base"; bases: Record<string, BaseDelDia> } | { fuente: "sin_tabla" } | { fuente: "error"; detalle: string };

/** Lo elegido para UN día. Cada quien lee lo que su RLS le deja: logística y el resto de Entregas, todo; un chofer, lo suyo. */
export async function leeBasesDelDia(cliente: ClienteDeBasesDelDia, fecha: string): Promise<BasesLeidas> {
  try {
    const { data, error } = await cliente.from(TABLA_DE_BASES_DEL_DIA).select("plan_date, driver_id, start_store, end_store").eq("plan_date", fecha);
    if (error) return faltaLaTablaDeBases(error) ? { fuente: "sin_tabla" } : { fuente: "error", detalle: error.message ?? String(error.code ?? "error") };
    return { fuente: "base", bases: basesDeFilas(data ?? []) };
  } catch (e) {
    return { fuente: "error", detalle: e instanceof Error ? e.message : String(e) };
  }
}

/** Guarda lo elegido para un chofer un día (`baseTrasElCambio` ya limpio): con algo, la fila; con `null`, la borra. */
export async function guardaBaseDelDia(
  cliente: ClienteDeBasesDelDia, fecha: string, choferId: string, nueva: BaseDelDia | null,
): Promise<{ ok: true } | { ok: false; faltaLaTabla: boolean; detalle: string }> {
  try {
    const { error } = nueva
      ? await cliente.from(TABLA_DE_BASES_DEL_DIA).upsert({ plan_date: fecha, driver_id: choferId, start_store: nueva.salida, end_store: nueva.fin }, { onConflict: "plan_date,driver_id" })
      : await cliente.from(TABLA_DE_BASES_DEL_DIA).delete().eq("plan_date", fecha).eq("driver_id", choferId);
    if (!error) return { ok: true };
    return { ok: false, faltaLaTabla: faltaLaTablaDeBases(error), detalle: error.message ?? String(error.code ?? "error") };
  } catch (e) {
    return { ok: false, faltaLaTabla: false, detalle: e instanceof Error ? e.message : String(e) };
  }
}
