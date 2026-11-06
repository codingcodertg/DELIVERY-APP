/**
 * La llegada PREVISTA de cada parada y la REAL (D-671, migración 194). Roberto Rodriguez Jr (admin), 2026-10-24, con la
 * tabla de paradas del Gestor: «Need a column of "Actual" to know when they delivered vs when was their ETA».
 *
 * El Gestor mide la ruta en el navegador y solo de lo que falta (`listaDe` → `pendientesDelDia`): una parada hecha ya no
 * tiene llegada calculada. Por eso se apunta la llegada que el Gestor mide para cada parada el día de su ruta
 * (`delivery_eta_plans`, una fila por orden, día y parada), y la tabla enseña esa como «ETA» de lo hecho, con la hora
 * real al lado, en «Actual», y cuánto se desvió.
 *
 * ---- D-NEXT (2026-11-06, migración 260): la prevista es la del PLAN VIGENTE, no la primera del día ----
 * Hasta aquí «la primera gana»: la hora que se midió la primera vez se quedaba para siempre, aunque la ruta se
 * reordenara, se le añadieran paradas o se midiera a media mañana. Medido en la ruta de Ernesto del 5 de noviembre (la
 * imagen que tenía el dueño): la base salía 08:53 y la parada 1 decía «prevista 08:50»; las paradas 3-4 «13:33» y la 5
 * «12:39»; la parada 6 «08:50» en mitad de la tarde. En `delivery_eta_plans` se ve por qué: diez horas se apuntaron a
 * las 08:28, todas de UN plan que subía bien (recoger en Edinburg 08:50 —la 1 y la 6 juntas, en la misma visita—,
 * entregar 09:32, McAllen 10:13 … Alamo 12:39), y las de las paradas 3-4 a las 11:14, cuando esas órdenes se crearon y
 * se añadieron. Después la ruta se reordenó (la última vez a las 12:13) y las horas del plan de las 08:28 se quedaron
 * pegadas a paradas que ya iban en otro puesto. Horas de dos planes, enseñadas en el orden de un tercero: ni suben en
 * el orden de la ruta ni el «±min» contra la real quiere decir nada.
 *
 * Regla: cada ruta tiene una CLAVE DE PLAN (`claveDelPlan`: de dónde sale, dónde acaba y sus paradas en el orden de la
 * lista). Mientras la clave no cambie, la prevista de una parada pendiente no se toca —que pase el tiempo o que el
 * chofer vaya haciendo paradas no la mueve: ése es el retraso que «Actual» enseña—. Cuando el plan cambia (se añade,
 * se quita o se mueve una parada, o cambia la salida o el fin), TODAS las pendientes de esa ruta se vuelven a apuntar
 * con la medida de ese momento: una sola pasada, que sube en el orden de la ruta. Lo ya hecho se queda con la prevista
 * del plan con el que se hizo. La primera del día no se pierde: queda en `first_eta`.
 *
 * Sin la 260 (la base aún sin `plan_key`), todo sigue como con la 194: la primera gana.
 *
 * Puro, sin navegador: lo prueba `eta-del-plan.test.ts`.
 */

export type TipoDeParada = "P" | "D";
export interface FilaDeEta { delivery_id: string; plan_date: string; kind: TipoDeParada; eta: string }
/** Lo guardado de una parada: su prevista vigente, de qué plan es y la primera que se apuntó ese día. */
export interface EtaGuardada { eta: string; plan_key: string | null; first_eta: string | null }
/** Una parada que aún no estaba apuntada. */
export interface FilaNuevaDeEta extends FilaDeEta { plan_key: string; first_eta: string }
/** Una parada pendiente cuyo plan cambió: su prevista se rehace. `first_eta` NO va: la primera del día se conserva. */
export interface FilaRehechaDeEta extends FilaDeEta { plan_key: string; plan_at: string }

/** La clave de una parada en el mapa de llegadas guardadas. */
export const claveDeEta = (id: string, tipo: TipoDeParada): string => `${tipo}:${id}`;

const HORA = /^[0-2]\d:[0-5]\d$/;

/** Las paradas de una medida (`routeEtas[ruta]`) como (orden, tipo, hora). Una recogida de varias órdenes da su hora a
 *  cada una. Solo horas válidas. */
function paradasDeLaMedida(etas: Readonly<Record<string, string>>): { id: string; tipo: TipoDeParada; eta: string }[] {
  const out: { id: string; tipo: TipoDeParada; eta: string }[] = [];
  for (const [clave, eta] of Object.entries(etas)) {
    if (!HORA.test(eta)) continue;
    const tipo: TipoDeParada = clave.startsWith("P:") ? "P" : "D";
    for (const id of tipo === "P" ? clave.slice(2).split(",").filter(Boolean) : [clave]) out.push({ id, tipo, eta });
  }
  return out;
}

/**
 * Las filas que hay que apuntar de lo que se acaba de medir (`routeEtas`: por ruta, la llegada de cada parada; una
 * recogida va como `P:id1,id2`, una entrega por el id de su orden). Solo lo que aún no está apuntado (`ya`), y solo con
 * una hora válida. Una recogida de varias órdenes apunta su hora a cada una. Es la regla de la 194 («la primera gana»),
 * la que sigue valiendo mientras la base no tenga la 260.
 */
export function filasNuevasDeEtas(medidas: Readonly<Record<string, Readonly<Record<string, string>>>>, fecha: string, ya: { has(clave: string): boolean }): FilaDeEta[] {
  const out = new Map<string, FilaDeEta>();
  for (const etas of Object.values(medidas)) {
    for (const p of paradasDeLaMedida(etas)) {
      const k = claveDeEta(p.id, p.tipo);
      if (ya.has(k) || out.has(k)) continue;
      out.set(k, { delivery_id: p.id, plan_date: fecha, kind: p.tipo, eta: p.eta });
    }
  }
  return [...out.values()];
}

/** Lo leído de la base, como mapa por parada. */
export function mapaDeEtas(filas: readonly Pick<FilaDeEta, "delivery_id" | "kind" | "eta">[]): Map<string, string> {
  return new Map(filas.map((f) => [claveDeEta(f.delivery_id, f.kind), f.eta]));
}

/** Lo leído de la base con la 260, como mapa por parada. Una fila de antes de la 260 no trae plan ni primera. */
export function mapaDeEtasGuardadas(filas: readonly (Pick<FilaDeEta, "delivery_id" | "kind" | "eta"> & { plan_key?: string | null; first_eta?: string | null })[]): Map<string, EtaGuardada> {
  return new Map(filas.map((f) => [claveDeEta(f.delivery_id, f.kind), { eta: f.eta, plan_key: f.plan_key ?? null, first_eta: f.first_eta ?? null }]));
}

/**
 * La clave del PLAN de una ruta (D-NEXT): el día, la ruta, de dónde sale y dónde acaba (`extremos`) y sus paradas en el
 * orden de la LISTA —cada recogida y cada entrega por su orden—. No entra nada que cambie solo porque el día avance: ni
 * la hora, ni qué está hecho, ni el orden en que el chofer las hace. Dos pantallas que miran la misma ruta dan la misma
 * clave. Corta (16 hex) para guardarla en cada fila.
 */
export function claveDelPlan(fecha: string, ruta: string, extremos: string, lista: readonly ({ tipo: "P"; ordenes: readonly string[] } | { tipo: "D"; orden: string })[]): string {
  const texto = [fecha, ruta, extremos, ...lista.flatMap((p) => (p.tipo === "P" ? p.ordenes.map((o) => `P${o}`) : [`D${p.orden}`]))].join("|");
  // FNV-1a de 32 bits, dos veces con distinta semilla: no es criptografía, es para saber si el plan es otro.
  const fnv = (semilla: number) => {
    let h = semilla >>> 0;
    for (let i = 0; i < texto.length; i++) { h ^= texto.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, "0");
  };
  return fnv(0x811c9dc5) + fnv(0x9e3779b9);
}

/**
 * Lo que hay que escribir de lo que se acaba de medir, con la regla de D-NEXT. `medidas`: por ruta, sus llegadas
 * (`routeEtas[ruta]`: solo trae lo PENDIENTE) y la clave de su plan de ahora.
 *   · `nuevas`: paradas sin apuntar. Se insertan (sin pisar: otro pudo apuntarlas antes).
 *   · `rehechas`: paradas ya apuntadas con OTRO plan (o sin plan: una fila de antes de la 260). Su prevista pasa a ser la
 *     de ahora. Con el mismo plan no se tocan, diga lo que diga la medida de ahora.
 * `ahoraISO` es la hora en que se rehace (`plan_at`).
 */
export function cambiosDeEtas(
  medidas: Readonly<Record<string, { etas: Readonly<Record<string, string>>; plan: string }>>, fecha: string,
  ya: ReadonlyMap<string, EtaGuardada>, ahoraISO: string,
): { nuevas: FilaNuevaDeEta[]; rehechas: FilaRehechaDeEta[] } {
  const nuevas = new Map<string, FilaNuevaDeEta>(), rehechas = new Map<string, FilaRehechaDeEta>();
  for (const { etas, plan } of Object.values(medidas)) {
    for (const p of paradasDeLaMedida(etas)) {
      const k = claveDeEta(p.id, p.tipo);
      if (nuevas.has(k) || rehechas.has(k)) continue;
      const guardada = ya.get(k);
      const fila = { delivery_id: p.id, plan_date: fecha, kind: p.tipo, eta: p.eta, plan_key: plan };
      if (!guardada) nuevas.set(k, { ...fila, first_eta: p.eta });
      else if (guardada.plan_key !== plan) rehechas.set(k, { ...fila, plan_at: ahoraISO });
    }
  }
  return { nuevas: [...nuevas.values()], rehechas: [...rehechas.values()] };
}

const minutos = (hora: string): number | null => (HORA.test(hora) ? Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5)) : null);

/** Cuánto se desvió la real de la prevista, en minutos (positivo = más tarde). Null sin una de las dos. */
export function desvio(prevista: string | null | undefined, real: string | null | undefined): number | null {
  const a = minutos(prevista ?? ""), b = minutos(real ?? "");
  return a === null || b === null ? null : b - a;
}

/** Hasta cuántos minutos tarde sigue siendo «a tiempo» (verde); hasta `TARDE_MIN`, ámbar; más, rojo. */
export const A_TIEMPO_MIN = 10;
export const TARDE_MIN = 30;

/** Cómo se dice el desvío: «−5 min» / «+12 min» y su tono. «a tiempo» si es exacto. */
export function textoDelDesvio(min: number | null, es: boolean): { texto: string; tono: "verde" | "ambar" | "rojo" } | null {
  if (min === null) return null;
  const tono = min <= A_TIEMPO_MIN ? "verde" : min <= TARDE_MIN ? "ambar" : "rojo";
  if (min === 0) return { texto: es ? "a tiempo" : "on time", tono };
  return { texto: `${min > 0 ? "+" : "−"}${Math.abs(min)} min`, tono };
}

/** Dos horas reales a menos de esto no dicen quién fue antes (la oficina marca varias paradas en el mismo minuto). */
const MISMO_TOQUE_MIN = 3;

/**
 * Las paradas HECHAS que se hicieron FUERA DEL ORDEN de la lista (D-NEXT): delante de ellas, en la lista, queda una
 * parada sin hacer, o una que se hizo claramente después. De ésas no se enseña el «±min» contra la prevista —la
 * prevista era para hacerla en su puesto: «prevista 14:52, real 08:55, −357 min» no es que llegara seis horas antes de
 * tiempo, es que se hizo antes que las de delante—; la celda dice «fuera de orden».
 *
 * `filas`: las de la tabla, en su orden; `real` en minutos del día (null si no está hecha o no tiene hora).
 */
export function hechasFueraDeOrden(filas: readonly { clave: string; hecha: boolean; real: number | null }[]): Set<string> {
  const fuera = new Set<string>();
  let hayPendienteDelante = false, masTardeDelante = -Infinity;
  for (const f of filas) {
    if (!f.hecha) { hayPendienteDelante = true; continue; }
    if (f.real == null) continue;
    if (hayPendienteDelante || masTardeDelante > f.real + MISMO_TOQUE_MIN) fuera.add(f.clave);
    masTardeDelante = Math.max(masTardeDelante, f.real);
  }
  return fuera;
}
