import { palletsDeLaOrden } from "./pallets";

/**
 * La ruta de un chofer como UNA SOLA LISTA de paradas (D-443): recogidas (P) y entregas (D) intercaladas, sin viajes.
 *
 * El dueño, 2026-09-28, en su especificación del motor: «Elimina el concepto de cargas (truckloads) separadas […] todas las
 * órdenes del conductor van en una sola lista continua, que es un solo viaje del camión con muchas paradas y etapas. El
 * camión puede recoger, entregar una parte, volver a recoger en otra tienda y seguir entregando, todo dentro de la misma
 * ruta, siempre que nunca lleve más pallets de los que le caben.» Preguntado si se quitaban los viajes del Gestor: «SI
 * ELIMINA VIAJES».
 *
 * Aquí vive, sin pantalla ni base:
 *   · **qué lista sale de lo guardado** (`listaDelChofer`): la entrega de cada orden va en su puesto (`route_seq`); su
 *     recogida, donde diga `pickup_seq` (migración 154, en la MISMA escala que `route_seq`) o, si no lo dice, donde la
 *     regla de siempre la pone (ver `listaDelChofer`);
 *   · **la cuenta de pallets parada a parada** (`cuentaDePallets`): a bordo antes ± la parada = a bordo después, y lo que
 *     queda libre, con el aviso EN LA PARADA donde se pasa de la capacidad y la marca si al volver a la base no da 0;
 *   · **mover una parada** (`mueveEnLaLista`) sin romper nunca «la recogida antes que su entrega»;
 *   · **qué se escribe** (`escrituraDeLaLista`): el puesto de cada entrega y la posición de cada recogida.
 *
 * Todo en CENTÉSIMAS enteras, como el motor (`route-engine`): 0.1 + 0.2 da 0.3, y 8.75 + 3.00 da 11.75, no 11.749999.
 */

export interface OrdenDeLaLista {
  id: string;
  store?: string | null;
  actual_pallets?: number | null;
  est_pallets?: number | null;
  route_seq?: number | null;
  /** Dónde va su recogida, en la escala de `route_seq` (migración 154). `undefined`: la base no tiene la columna. */
  pickup_seq?: number | string | null;
  /** HISTÓRICO: el viaje que se escribía hasta D-443. Ya no se escribe (se deja en `null` al guardar); solo se lee para
   *  ordenar una ruta que se guardó con viajes y nadie ha vuelto a tocar. */
  load_no?: number | null;
}

export type ParadaDeLaLista =
  | { tipo: "P"; ordenes: string[]; tienda: string | null }
  | { tipo: "D"; orden: string };

const normaliza = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
/** La tienda donde se recoge una orden, como clave. Dos órdenes sin tienda no se juntan: no se sabe que salgan del mismo sitio. */
export const claveDeTienda = (o: { id: string; store?: string | null }) => normaliza(o.store) || `sin-tienda:${o.id}`;

const centesimas = (n: number) => Math.round(n * 100);
const numero = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Las entregas en el orden de la lista: primero las que tienen puesto (`route_seq`), después las que no, en el orden en que
 * llegan. Una ruta que se guardó con viajes (`load_no` 2, 3…) y nadie ha vuelto a tocar numeraba el puesto DENTRO de cada
 * viaje (publicar, hasta D-443): por eso el viaje viejo ordena antes que el puesto. Es solo lectura de lo histórico: en
 * cuanto se toca la ruta se guarda seguida y sin viaje.
 */
export function entregasEnOrden<T extends OrdenDeLaLista>(ordenes: readonly T[]): T[] {
  return ordenes
    .map((o, i) => ({ o, i }))
    .sort((a, b) => {
      const sa = a.o.route_seq, sb = b.o.route_seq;
      if ((sa == null) !== (sb == null)) return sa == null ? 1 : -1;
      if (sa == null || sb == null) return a.i - b.i;
      const la = a.o.load_no && a.o.load_no > 1 ? a.o.load_no : 1, lb = b.o.load_no && b.o.load_no > 1 ? b.o.load_no : 1;
      return la - lb || sa - sb || a.i - b.i;
    })
    .map((x) => x.o);
}

/** ¿La base trae la columna `pickup_seq` (migración 154)? Se mira en lo leído: `select *` la trae, aunque valga `null`. */
export function tienePosicionDeRecogida(filas: readonly object[]): boolean {
  return filas.some((f) => Object.prototype.hasOwnProperty.call(f, "pickup_seq"));
}

/**
 * La lista del chofer, de sus órdenes pendientes.
 *
 * - **Entregas**: en el orden de `entregasEnOrden`.
 * - **Recogida con posición guardada** (`pickup_seq`, 154): va justo antes de la primera entrega cuyo puesto es mayor que
 *   esa posición. Si lo guardado la dejara DESPUÉS de su propia entrega (alguien movió la entrega por otro camino), se
 *   adelanta justo delante de ella: una entrega nunca va antes que su recogida.
 * - **Recogida sin posición guardada** (sin la 154, o una orden que aún no se guardó con ella) — LA REGLA DE SIEMPRE, SIN
 *   VIAJES: las órdenes se cargan en bloques, en el orden de sus entregas y tanto como quepa en el camión (el mismo corte
 *   que hacía `splitIntoTrips`), y cada bloque se recoge —una parada por tienda— justo antes de la primera entrega del
 *   bloque. Una ruta que cabe entera en el camión son todas las recogidas al principio. Una ruta que no cabe recarga a
 *   media ruta cuando el camión se vacía, que es lo que hacían los viajes, pero ya en la misma lista. Un viaje histórico
 *   (`load_no`) también corta el bloque: la ruta vieja se sigue leyendo como se cargó.
 * - **Recogidas seguidas en la misma tienda son UNA parada**, con todas sus órdenes («P1·P2»).
 */
export function listaDelChofer(ordenes: readonly OrdenDeLaLista[], capacidad: number): ParadaDeLaLista[] {
  const entregas = entregasEnOrden(ordenes);
  const tope = centesimas(capacidad > 0 ? capacidad : Number.POSITIVE_INFINITY);
  const guardada = (o: OrdenDeLaLista) => (o.route_seq != null ? numero(o.pickup_seq) : null);
  // Los bloques de las que NO tienen posición guardada: qué órdenes se recogen antes de la entrega de cuál.
  const bloqueAntesDe = new Map<string, OrdenDeLaLista[]>();
  let bloque: OrdenDeLaLista[] = [], carga = 0, viajeViejo = 0;
  for (const o of entregas) {
    if (guardada(o) != null) continue;
    const n = centesimas(palletsDeLaOrden(o));
    const viejo = o.load_no && o.load_no > 1 ? o.load_no : 1;
    if (bloque.length && (carga + n > tope || viejo !== viajeViejo)) { bloque = []; carga = 0; }
    if (!bloque.length) { bloqueAntesDe.set(o.id, bloque); viajeViejo = viejo; }
    bloque.push(o);
    carga += n;
  }
  const conPosicion = entregas.filter((o) => guardada(o) != null).sort((a, b) => guardada(a)! - guardada(b)!);
  const recogida = (o: OrdenDeLaLista): ParadaDeLaLista => ({ tipo: "P", ordenes: [o.id], tienda: (o.store ?? "").trim() || null });

  const sueltas: ParadaDeLaLista[] = [];
  const recogidas = new Set<string>();
  let k = 0;
  for (const o of entregas) {
    const puesto = o.route_seq ?? Number.POSITIVE_INFINITY;
    while (k < conPosicion.length && guardada(conPosicion[k])! < puesto) {
      const x = conPosicion[k++];
      if (!recogidas.has(x.id)) { recogidas.add(x.id); sueltas.push(recogida(x)); }
    }
    if (guardada(o) != null && !recogidas.has(o.id)) { recogidas.add(o.id); sueltas.push(recogida(o)); }
    const suyo = bloqueAntesDe.get(o.id);
    if (suyo) {
      // Una parada por tienda, en el orden en que aparece la primera orden de cada una.
      const porTienda = new Map<string, OrdenDeLaLista[]>();
      for (const x of suyo) porTienda.set(claveDeTienda(x), [...(porTienda.get(claveDeTienda(x)) ?? []), x]);
      for (const grupo of porTienda.values()) {
        for (const x of grupo) recogidas.add(x.id);
        sueltas.push({ tipo: "P", ordenes: grupo.map((x) => x.id), tienda: (grupo[0].store ?? "").trim() || null });
      }
    }
    sueltas.push({ tipo: "D", orden: o.id });
  }
  return juntaRecogidas(sueltas, new Map(ordenes.map((o) => [o.id, o])));
}

/** Recogidas SEGUIDAS en la misma tienda son una sola parada física. */
function juntaRecogidas(paradas: readonly ParadaDeLaLista[], porId: ReadonlyMap<string, { id: string; store?: string | null }>): ParadaDeLaLista[] {
  const out: ParadaDeLaLista[] = [];
  const clave = (p: ParadaDeLaLista & { tipo: "P" }) => { const o = porId.get(p.ordenes[0]); return o ? claveDeTienda(o) : `sin-tienda:${p.ordenes[0]}`; };
  for (const p of paradas) {
    const ultima = out[out.length - 1];
    if (p.tipo === "P" && ultima?.tipo === "P" && clave(ultima) === clave(p)) out[out.length - 1] = { ...ultima, ordenes: [...ultima.ordenes, ...p.ordenes] };
    else out.push(p.tipo === "P" ? { ...p, ordenes: [...p.ordenes] } : p);
  }
  return out;
}

/** El número de cada orden: el orden en que se RECOGE (P1, P2…), como en un plan del motor. `Dk` es la entrega de `Pk`. */
export function numeraLaLista(paradas: readonly ParadaDeLaLista[]): Map<string, number> {
  const n = new Map<string, number>();
  for (const p of paradas) if (p.tipo === "P") for (const id of p.ordenes) if (!n.has(id)) n.set(id, n.size + 1);
  // Una entrega sin recogida en la lista (no debería pasar) sigue numerada, detrás.
  for (const p of paradas) if (p.tipo === "D" && !n.has(p.orden)) n.set(p.orden, n.size + 1);
  return n;
}

/** La etiqueta de una parada: «P1·P2» o «D3». */
export function etiquetaDeLaParada(p: ParadaDeLaLista, numeros: ReadonlyMap<string, number>): string {
  return p.tipo === "P" ? p.ordenes.map((id) => `P${numeros.get(id) ?? "?"}`).join("·") : `D${numeros.get(p.orden) ?? "?"}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// La cuenta de pallets.

/** Una fila de la cuenta, en pallets (ya redondeados a la centésima). `cambio`: + en una recogida, − en una entrega. */
export interface FilaDeCuenta {
  antes: number;
  cambio: number;
  despues: number;
  /** Lo que queda libre en el camión tras la parada. Negativo si se pasa. */
  disponible: number;
  /** Cuánto se pasa de la capacidad tras la parada (0 si no se pasa). */
  exceso: number;
  /** Alguna orden de la parada no tiene pallets: la cuenta se queda corta, y se dice. */
  sinConteo: boolean;
}

export interface CuentaDeLaLista {
  /** La salida de la base: 0 a bordo. */
  salida: FilaDeCuenta;
  paradas: FilaDeCuenta[];
  /** El regreso a la base: lo que quede a bordo. Tiene que ser 0. */
  regreso: FilaDeCuenta;
  totales: {
    paradas: number;
    /** Lo que se carga en el día: la suma de las recogidas. */
    palletsMovidos: number;
    /** Lo más cargado que va el camión. */
    cargaMaxima: number;
    /** En cuántas paradas se pasa de la capacidad. */
    paradasConExceso: number;
    /** Al volver a la base no da 0: la cuenta no cuadra (una entrega sin su recogida, o al revés). */
    finalNoCero: boolean;
  };
}

/**
 * La cuenta, parada a parada: `cambios` es lo que cada parada suma (+) o resta (−), en pallets; `null` = sin conteo (suma 0
 * y se avisa). Nunca bloquea: si en una parada se pasa de `capacidad`, lo dice ESA fila (`exceso`); la capacidad `null`
 * (no se sabe) no marca nada.
 */
export function cuentaDePallets(cambios: readonly (number | null)[], capacidad: number | null): CuentaDeLaLista {
  const cap = capacidad != null && capacidad > 0 ? centesimas(capacidad) : null;
  const fila = (antesC: number, cambioC: number, sinConteo: boolean): FilaDeCuenta => {
    const despuesC = antesC + cambioC;
    return {
      antes: antesC / 100, cambio: cambioC / 100, despues: despuesC / 100,
      disponible: cap == null ? 0 : (cap - despuesC) / 100,
      exceso: cap != null && despuesC > cap ? (despuesC - cap) / 100 : 0,
      sinConteo,
    };
  };
  let aBordo = 0, maxima = 0, movidos = 0;
  const salida = fila(0, 0, false);
  const paradas = cambios.map((c) => {
    const cc = c == null ? 0 : centesimas(c);
    const f = fila(aBordo, cc, c == null);
    aBordo += cc;
    if (cc > 0) movidos += cc;
    if (aBordo > maxima) maxima = aBordo;
    return f;
  });
  const regreso = fila(aBordo, 0, false);
  return {
    salida, paradas, regreso,
    totales: {
      paradas: paradas.length, palletsMovidos: movidos / 100, cargaMaxima: maxima / 100,
      paradasConExceso: paradas.filter((f) => f.exceso > 0).length, finalNoCero: aBordo !== 0,
    },
  };
}

/** Lo que suma o resta cada parada de la lista, de los pallets de sus órdenes (contados, o si no estimados). */
export function cambiosDeLaLista(paradas: readonly ParadaDeLaLista[], ordenes: readonly { id: string; actual_pallets?: number | null; est_pallets?: number | null }[]): (number | null)[] {
  const porId = new Map(ordenes.map((o) => [o.id, o]));
  const sinConteo = (id: string) => { const o = porId.get(id); return !o || (o.actual_pallets == null && o.est_pallets == null); };
  const de = (id: string) => centesimas(palletsDeLaOrden(porId.get(id) ?? {}));
  return paradas.map((p) => {
    if (p.tipo === "D") return sinConteo(p.orden) ? null : -de(p.orden) / 100;
    if (p.ordenes.every(sinConteo)) return null;
    return p.ordenes.reduce((s, id) => s + de(id), 0) / 100;
  });
}

const dos = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

/** «8.75 + 3.00 = 11.75 · −1.75 libres»: la cuenta de una fila tal como se lee, con dos decimales como la hoja del dueño. */
export function textoDeLaCuenta(f: FilaDeCuenta, es: boolean): string {
  const signo = f.cambio < 0 ? "−" : "+";
  const libres = es ? "libres" : "free";
  return `${dos(f.antes)} ${signo} ${dos(Math.abs(f.cambio))} = ${dos(f.despues)} · ${f.disponible < 0 ? "−" : ""}${dos(Math.abs(f.disponible))} ${libres}`;
}

/** El aviso de la parada que se pasa: «⚠ se pasa 1.75 de 10». Vacío si no se pasa. */
export function textoDelExceso(f: FilaDeCuenta, capacidad: number | null, es: boolean): string {
  if (!(f.exceso > 0)) return "";
  return es ? `⚠ se pasa ${dos(f.exceso)} de ${capacidad}` : `⚠ over by ${dos(f.exceso)} of ${capacidad}`;
}

export { dos as dosDecimales };

// ---------------------------------------------------------------------------------------------------------------------
// Mover y escribir.

export type MovimientoEnLaLista =
  | { ok: true; paradas: ParadaDeLaLista[] }
  | { ok: false; motivo: "borde" }
  /** Rompería «la recogida antes que su entrega» de `orden`. No se hace, y se dice cuál. */
  | { ok: false; motivo: "precedencia"; orden: string };

/**
 * ↑ / ↓ de la parada `indice` (cualquiera: P o D) un puesto. Cambia con su vecina, salvo que eso deje una entrega antes que
 * su recogida: una P que baja sobre la entrega de una de sus órdenes, o una D que sube sobre su propia recogida. Entonces no
 * se mueve nada y se dice qué orden lo impide. Tras mover, dos recogidas seguidas en la misma tienda pasan a ser una.
 * La capacidad NO bloquea (es un cambio a mano): la cuenta lo avisa en la parada que se pase.
 */
export function mueveEnLaLista(
  paradas: readonly ParadaDeLaLista[], indice: number, dir: -1 | 1, ordenes: readonly { id: string; store?: string | null }[],
): MovimientoEnLaLista {
  const j = indice + dir;
  if (indice < 0 || indice >= paradas.length || j < 0 || j >= paradas.length) return { ok: false, motivo: "borde" };
  const [arriba, abajo] = dir < 0 ? [paradas[j], paradas[indice]] : [paradas[indice], paradas[j]];
  // Tras el cambio, `abajo` queda antes que `arriba`: si `arriba` es la recogida de la entrega `abajo`, se rompe.
  if (arriba.tipo === "P" && abajo.tipo === "D" && arriba.ordenes.includes(abajo.orden)) return { ok: false, motivo: "precedencia", orden: abajo.orden };
  const nuevas = [...paradas];
  nuevas[indice] = paradas[j];
  nuevas[j] = paradas[indice];
  return { ok: true, paradas: juntaRecogidas(nuevas, new Map(ordenes.map((o) => [o.id, o]))) };
}

/**
 * La lista con las ENTREGAS en otro orden (`ids`: el de «📍 Mejor lugar» o el de soltar en «📅 Horario»), sin decidir de
 * nuevo las recogidas: cada recogida se queda pegada a la entrega que la seguía, y va delante de ella allá donde vaya. Una
 * orden nueva en la ruta (sin recogida en la lista) se recoge justo antes de su entrega. Las órdenes que ya no están en
 * `ids` salen de la lista. Si con eso una entrega quedara antes que su recogida, la recogida de ESA orden se adelanta
 * justo delante de su entrega.
 */
export function listaConEntregasEn(
  paradas: readonly ParadaDeLaLista[], ids: readonly string[], ordenes: readonly { id: string; store?: string | null }[],
): ParadaDeLaLista[] {
  const quedan = new Set(ids);
  const antesDe = new Map<string, ParadaDeLaLista[]>();
  let pendientes: ParadaDeLaLista[] = [];
  const recogidaDe = new Set<string>();
  for (const p of paradas) {
    if (p.tipo === "P") {
      const suyas = p.ordenes.filter((id) => quedan.has(id));
      if (suyas.length) { pendientes.push({ ...p, ordenes: suyas }); suyas.forEach((id) => recogidaDe.add(id)); }
    } else if (quedan.has(p.orden)) { antesDe.set(p.orden, pendientes); pendientes = []; }
  }
  const porId = new Map(ordenes.map((o) => [o.id, o]));
  const out: ParadaDeLaLista[] = [];
  for (const id of ids) {
    out.push(...(antesDe.get(id) ?? []));
    if (!recogidaDe.has(id)) out.push({ tipo: "P", ordenes: [id], tienda: (porId.get(id)?.store ?? "").trim() || null });
    out.push({ tipo: "D", orden: id });
  }
  out.push(...pendientes);
  return juntaRecogidas(conPrecedencia(out), porId);
}

/** Una recogida que haya quedado DESPUÉS de su entrega se adelanta, solo esa orden, justo delante de la entrega. */
function conPrecedencia(paradas: readonly ParadaDeLaLista[]): ParadaDeLaLista[] {
  const entregada = new Set<string>();
  const tarde = new Set<string>();
  for (const p of paradas) {
    if (p.tipo === "D") entregada.add(p.orden);
    else for (const id of p.ordenes) if (entregada.has(id)) tarde.add(id);
  }
  if (!tarde.size) return [...paradas];
  const out: ParadaDeLaLista[] = [];
  const tiendaDe = new Map<string, string | null>();
  for (const p of paradas) if (p.tipo === "P") for (const id of p.ordenes) tiendaDe.set(id, p.tienda);
  for (const p of paradas) {
    if (p.tipo === "P") {
      const quedan = p.ordenes.filter((id) => !tarde.has(id));
      if (quedan.length) out.push({ ...p, ordenes: quedan });
    } else {
      if (tarde.has(p.orden)) out.push({ tipo: "P", ordenes: [p.orden], tienda: tiendaDe.get(p.orden) ?? null });
      out.push(p);
    }
  }
  return out;
}

export interface EscrituraDeLaLista {
  /** Las entregas en orden: su `route_seq` es `desde` + su índice (lo escribe `reorderStops`). */
  ids: string[];
  /** La posición de la recogida de cada orden, en la MISMA escala: entre el puesto de la entrega anterior y el de la siguiente. */
  pickupSeqById: Record<string, number>;
  /** El viaje viejo se deja vacío en todas: ya no hay viajes (D-443). */
  loadNoById: Record<string, null>;
}

/**
 * Lo que se guarda de la lista. Las entregas, seguidas desde `desde` (tras lo ya hecho, D-433). Cada recogida, con un
 * número entre el puesto de la entrega que tiene delante y el de la que tiene detrás: con `m` paradas de recogida seguidas
 * delante de la entrega de puesto `k`, la `j`-ésima (desde 0) va en `k − (m − j) / (m + 1)`. Todas las órdenes de una misma
 * parada P llevan el mismo número. Se redondea a la diezmilésima.
 */
export function escrituraDeLaLista(paradas: readonly ParadaDeLaLista[], desde: number): EscrituraDeLaLista {
  const ids: string[] = [];
  const pickupSeqById: Record<string, number> = {};
  const loadNoById: Record<string, null> = {};
  let racha: string[][] = [];
  const cierra = (k: number) => {
    const m = racha.length;
    racha.forEach((grupo, j) => { const v = Math.round((k - (m - j) / (m + 1)) * 10000) / 10000; for (const id of grupo) pickupSeqById[id] = v; });
    racha = [];
  };
  for (const p of paradas) {
    if (p.tipo === "P") { racha.push(p.ordenes); continue; }
    cierra(desde + ids.length);
    ids.push(p.orden);
    loadNoById[p.orden] = null;
  }
  cierra(desde + ids.length);
  return { ids, pickupSeqById, loadNoById };
}

/** ¿Cabe una orden de `pallets` recogida justo delante de la entrega de puesto `puesto`? La carga a bordo en ese punto más
 *  la suya, contra la capacidad, en centésimas (para «📍 Mejor lugar», D-443). */
export function cabeEnElPuesto(paradas: readonly ParadaDeLaLista[], cambios: readonly (number | null)[], puesto: number, pallets: number, capacidad: number): boolean {
  return centesimas(cargaAntesDeLaEntrega(paradas, cambios, puesto)) + centesimas(pallets) <= centesimas(capacidad);
}

/** La carga a bordo justo ANTES de la entrega de puesto `k` (0 = la primera; `k` = total, al final): para «📍 Mejor lugar»,
 *  que mete la orden nueva recogiéndola justo delante de su entrega. */
export function cargaAntesDeLaEntrega(paradas: readonly ParadaDeLaLista[], cambios: readonly (number | null)[], k: number): number {
  let aBordo = 0, d = 0;
  for (let i = 0; i < paradas.length; i++) {
    if (paradas[i].tipo === "D") { if (d === k) return aBordo / 100; d++; }
    aBordo += centesimas(cambios[i] ?? 0);
  }
  return aBordo / 100;
}
