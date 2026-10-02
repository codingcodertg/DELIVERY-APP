import { ordenSinRecoger, type ParadaDeLaLista } from "./lista-unica";
import { claveDePunto } from "./route-times/claves";
import { FACTOR_DE_RODEO, MILLAS_POR_HORA_ESTIMADAS, millasEnLineaRecta } from "./route-times/proveedores";
import { RELOAD_MIN } from "./trip-timing";

/**
 * «🧭 Optimizar» UNA ruta (D-456, rehecho en D-461). El dueño, 2026-10-01: «When doing routes manually it assigned to him
 * but it doesn't optimize have the optimize option for every route when selecting a driver and optimize it». Y al día
 * siguiente, con el primer Optimizar en la calle: «sigamos trabajando en el alrgoritmo de optimizar ruta porque sigue muy mal
 * ineficente».
 *
 * El primero (D-456) decidía el orden con el vecino más cercano y un pulido, midiendo EN LÍNEA RECTA, sin mirar las ventanas
 * de entrega ni lo que se tarda de verdad, y saliendo de «la base» que la pantalla le daba (la tienda de recogida más repetida
 * de la ruta, no la del chofer). Medido sobre 37 rutas reales (DECISIONS.md, D-461): en 20 no daba el mejor orden y en 13
 * dejaba la ruta peor de como estaba — por la base, que era otra en 11; por no mirar las ventanas (14 entregas tarde donde el
 * mejor orden deja 3); y porque la búsqueda se atascaba.
 *
 * Ahora:
 *   · reordena SOLO las paradas de esa lista (las mismas, ni una más ni una menos), y una entrega nunca queda antes que su
 *     recogida;
 *   · qué es «mejor», en este orden y sin pesos: (1) que el camión no se pase de su capacidad; (2) que ninguna entrega llegue
 *     después de cerrar su ventana —las ventanas ESTRECHAS mandan sobre las demás—; (3) el menor tiempo de la jornada, de que
 *     sale de la base a que vuelve a ella: manejo, cargas, descargas y esperas; (4) a igual tiempo, menos millas;
 *   · el tiempo es el de las CALLES (`tiempos`: la misma matriz que usa «Armar rutas»); el tramo que falte se estima en línea
 *     recta y se dice (`medida`);
 *   · las horas se ponen como las pone el motor de «Armar rutas» (`route-engine/evalua.ts`): cargar en una tienda dura lo
 *     MAYOR entre la recarga mínima y la suma de lo que se recoge en esa visita, así que recoger en la misma tienda de una
 *     vez sale más barato que volver, y solo se vuelve si la capacidad o una ventana lo piden;
 *   · la búsqueda es EXACTA —el mejor orden que existe, comprobado— mientras la ruta sea lo bastante pequeña para
 *     terminarla (`exacta`: siempre hasta 8 órdenes, y las rutas reales hasta 12), y si no, lo mejor que encuentra una
 *     búsqueda local con varios arranques y sacudidas. Determinista: sin azar ni reloj, se corta por CUENTA.
 *
 * Nunca devuelve algo peor que lo que hay: si no encuentra nada mejor, lo dice y no toca nada. Una parada sin punto en el
 * mapa (una entrega sin pin, una tienda sin coordenadas en Ajustes) no suma camino: se queda en la lista, donde las reglas la
 * dejen, y se cuenta en `sinPunto`.
 */

export interface PuntoEnElMapa { lat: number; lng: number }

/** Un tramo por calles. */
export interface TramoDeRuta { minutos: number; millas: number }

/** Los tiempos REALES entre los puntos de la ruta, por la clave de cada punto (`claveDePunto`: lat,lng a 5 decimales):
 *  `tiempos[a][b]` = ir de `a` a `b`. Es la forma de la matriz del motor (`route-engine`). */
export type TiemposDeLaRuta = Readonly<Record<string, Readonly<Record<string, TramoDeRuta>>>>;

/** La ventana de una entrega, en minutos desde la medianoche. `estrecha`: de las que no se llega tarde nunca (Ajustes). */
export interface VentanaDeEntrega { abre: number; cierra: number; estrecha: boolean }

export interface EntradaDeOptimizar {
  paradas: readonly ParadaDeLaLista[];
  /** El punto de cada parada, en el mismo orden; `null` si no se sabe. */
  puntos: readonly (PuntoEnElMapa | null)[];
  /** Lo que cada parada suma (+) o resta (−) en pallets (`cambiosDeLaLista`); `null` = sin conteo, cuenta 0. */
  cambios: readonly (number | null)[];
  /** De dónde sale y a dónde vuelve el camión. Sin base, el recorrido es abierto: de la primera parada a la última. */
  base: PuntoEnElMapa | null;
  /** `null` o 0: no se sabe; no se mira. */
  capacidad: number | null;
  /** La ventana de cada ENTREGA, en el mismo orden que `paradas` (`null`: sin ventana, o es una recogida). Sin la lista, ninguna. */
  ventanas?: readonly (VentanaDeEntrega | null)[];
  /** Minutos de servicio de cada parada: descargar en una entrega, cargar esa orden en una recogida. Sin la lista, 0. */
  servicios?: readonly (number | null)[];
  /** A qué hora sale de la base, en minutos desde la medianoche. Por defecto, las 08:00. */
  salidaMin?: number;
  /** Lo mínimo que dura una visita a una tienda para cargar. Por defecto, `RELOAD_MIN` (el mismo 20 del motor). */
  recargaMinimaMin?: number;
  /** Los tiempos por calles. Sin ellos (o donde falte un tramo), se estima en línea recta: `FACTOR_DE_RODEO` y
   *  `MILLAS_POR_HORA_ESTIMADAS`, lo mismo que el último escalón del motor (`proveedorEstimado`). */
  tiempos?: TiemposDeLaRuta | null;
  /** Hasta cuántas etiquetas puede crear la búsqueda exacta antes de rendirse. Por defecto, `TOPE_DE_LA_EXACTA`. */
  topeDeLaExacta?: number;
  /** Para las pruebas y para medir: sin búsqueda local. La exacta parte de la lista tal como está, y todo lo que mejore lo
   *  encuentra ella sola. */
  sinBusquedaLocal?: boolean;
}

/** Lo que mide una lista en un orden dado. */
export interface MedidaDeLaLista {
  /** Millas del recorrido, a la décima: base → paradas → base (o de la primera a la última, sin base). */
  millas: number;
  /** Minutos de la jornada: desde que sale hasta que vuelve, con manejo, cargas, descargas y esperas. */
  minutos: number;
  /** De ellos, al volante. */
  manejoMin: number;
  /** Pallets por encima de la capacidad, sumados parada a parada. */
  exceso: number;
  /** Las entregas que llegan después de cerrar su ventana, en el orden de la lista. */
  tarde: { orden: string; minutos: number; estrecha: boolean }[];
}

export interface ResultadoDeOptimizar {
  /** La lista en el orden nuevo (la misma si no hubo nada mejor). */
  paradas: ParadaDeLaLista[];
  /** ¿Cambió el orden? Si no, no hay nada que guardar. */
  cambio: boolean;
  antes: MedidaDeLaLista;
  despues: MedidaDeLaLista;
  /** Lo mismo que `antes.millas` / `despues.millas` y `antes.exceso` / `despues.exceso` (los nombres de D-456). */
  millasAntes: number;
  millasDespues: number;
  excesoAntes: number;
  excesoDespues: number;
  /** Paradas sin punto en el mapa: no cuentan en el recorrido. */
  sinPunto: number;
  /** Con qué se midieron los tramos: «real», todos por calles; «estimada», ninguno (línea recta); «mixta», de las dos. */
  medida: "real" | "mixta" | "estimada";
  /** `true`: es el mejor orden que EXISTE (la búsqueda exacta terminó). `false`: lo mejor que encontró la búsqueda local. */
  exacta: boolean;
  /** Cuánto trabajó: listas medidas por la búsqueda local y etiquetas creadas por la exacta. Para medir el límite. */
  trabajo: { medidas: number; etiquetas: number };
}

/** A qué hora sale el camión si nadie dice otra cosa: las 08:00, como la medida del Gestor (`DAY_START_MIN`). */
export const SALIDA_POR_DEFECTO_MIN = 8 * 60;
/**
 * Hasta cuántas etiquetas crea la búsqueda exacta antes de rendirse y dejarle la ruta a la búsqueda local. Medido en Chrome
 * (DECISIONS.md, D-461): con este tope, 36 de las 37 rutas reales salen exactas y la pulsación más lenta es de 358 ms; la
 * peor de todas —una ruta inventada de 10 órdenes, donde la exacta se rinde y siguen las sacudidas—, 796 ms.
 */
export const TOPE_DE_LA_EXACTA = 600_000;
/** Con más paradas que estas ni se intenta la exacta: no la terminaría dentro del tope, y lo gastado en intentarlo se
 *  le quita a la búsqueda local. (Los visitados van en un entero de bits: el máximo posible serían 30.) */
export const MAX_PARADAS_DE_LA_EXACTA = 26;
/** Cuánto mide la búsqueda local como mucho, en paradas medidas (cada lista que prueba cuenta las paradas que tiene). Se corta
 *  por cuenta, nunca por reloj: la misma lista da el mismo orden en una máquina lenta y en una rápida. */
export const TOPE_DE_PASOS = 30_000_000;
/** Lo mínimo que tienen que bajar las millas, a igual tiempo, para que un cambio de orden valga la pena: una décima. */
export const MARGEN_MI = 0.1;

// ---------------------------------------------------------------------------------------------------------------------
// El problema, en números: todo entero (minutos, centésimas de milla y de pallet), como el motor.

interface Problema {
  m: number;
  esP: boolean[];
  /** Para una entrega, el índice de su recogida en la lista; −1 si no tiene (o es una recogida). */
  antes: Int32Array;
  /** El lugar de cada parada en la matriz; −1 sin punto. */
  sitio: Int32Array;
  /** Para una recogida, su visita: la tienda (y el lugar). Dos recogidas seguidas con la misma son una sola visita. −1: va sola. */
  visita: Int32Array;
  visitas: number;
  cambio: Int32Array;
  servicio: Int32Array;
  abre: Float64Array;
  cierra: Float64Array;
  estrecha: boolean[];
  lugares: number;
  base: number;
  min: Int32Array;
  cmi: Int32Array;
  cap: number | null;
  salida: number;
  recarga: number;
  /** Cuántos tramos entre lugares distintos salieron de la matriz, y cuántos hubo que estimar. */
  reales: number;
  estimados: number;
}

/** [exceso (centésimas), tarde en ventanas estrechas (min), tarde en las demás (min), jornada (min), centésimas de milla]. */
type Nota = [number, number, number, number, number];

const centesimas = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100);
const entero = (n: number | null | undefined) => (n != null && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

function problemaDe(e: EntradaDeOptimizar): Problema {
  const m = e.paradas.length;
  const claves: string[] = [];
  const puntoDe: PuntoEnElMapa[] = [];
  const lugarDe = (p: PuntoEnElMapa | null | undefined): number => {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return -1;
    const k = claveDePunto(p);
    let i = claves.indexOf(k);
    if (i < 0) { i = claves.length; claves.push(k); puntoDe.push(p); }
    return i;
  };
  const base = lugarDe(e.base);
  const sitio = new Int32Array(m), visita = new Int32Array(m).fill(-1), antes = new Int32Array(m).fill(-1);
  const cambio = new Int32Array(m), servicio = new Int32Array(m);
  const abre = new Float64Array(m).fill(-Infinity), cierra = new Float64Array(m).fill(Infinity);
  const esP: boolean[] = [], estrecha: boolean[] = [];
  const recogidaDe = new Map<string, number>();
  const visitaDe = new Map<string, number>();
  e.paradas.forEach((p, i) => {
    esP.push(p.tipo === "P");
    estrecha.push(false);
    sitio[i] = lugarDe(e.puntos[i]);
    cambio[i] = centesimas(e.cambios[i] ?? 0);
    servicio[i] = entero(e.servicios?.[i]);
    if (p.tipo === "P") {
      for (const id of p.ordenes) recogidaDe.set(id, i);
      const tienda = (p.tienda ?? "").trim().toLowerCase();
      if (tienda) {
        const k = `${tienda}|${sitio[i]}`;
        if (!visitaDe.has(k)) visitaDe.set(k, visitaDe.size);
        visita[i] = visitaDe.get(k)!;
      }
    }
  });
  e.paradas.forEach((p, i) => {
    if (p.tipo !== "D") return;
    antes[i] = recogidaDe.get(p.orden) ?? -1;
    const v = e.ventanas?.[i];
    if (v && Number.isFinite(v.abre) && Number.isFinite(v.cierra)) { abre[i] = Math.round(v.abre); cierra[i] = Math.round(v.cierra); estrecha[i] = !!v.estrecha; }
  });
  const L = claves.length;
  const min = new Int32Array(L * L), cmi = new Int32Array(L * L);
  let reales = 0, estimados = 0;
  for (let a = 0; a < L; a++) {
    for (let b = 0; b < L; b++) {
      if (a === b) continue;
      const t = e.tiempos?.[claves[a]]?.[claves[b]];
      if (t && Number.isFinite(t.minutos) && Number.isFinite(t.millas)) {
        min[a * L + b] = Math.max(0, Math.round(t.minutos)); cmi[a * L + b] = Math.max(0, centesimas(t.millas)); reales++;
      } else {
        // El último escalón del motor (`proveedorEstimado`): la línea recta alargada por el rodeo, a la velocidad media.
        const millas = Math.round(millasEnLineaRecta(puntoDe[a], puntoDe[b]) * FACTOR_DE_RODEO * 100) / 100;
        min[a * L + b] = Math.round((millas / MILLAS_POR_HORA_ESTIMADAS) * 60); cmi[a * L + b] = centesimas(millas); estimados++;
      }
    }
  }
  return {
    m, esP, antes, sitio, visita, visitas: visitaDe.size, cambio, servicio, abre, cierra, estrecha, lugares: L, base, min, cmi,
    cap: e.capacidad != null && e.capacidad > 0 ? centesimas(e.capacidad) : null,
    salida: Math.round(e.salidaMin ?? SALIDA_POR_DEFECTO_MIN), recarga: Math.max(0, Math.round(e.recargaMinimaMin ?? RELOAD_MIN)),
    reales, estimados,
  };
}

/**
 * La ÚNICA cuenta que pone horas, millas, retrasos y exceso a un orden de la lista. Es la del motor (`evaluaRuta`), paso a
 * paso: sale de la base a su hora; en una entrega espera si llega antes de que abra la ventana y llega tarde si pasa de su
 * cierre; las recogidas seguidas en la misma tienda son UNA visita, que dura lo mayor entre la recarga mínima y la suma de
 * lo que se carga; y al final vuelve a la base. Lo que añade para el Gestor: una parada sin punto no mueve el camión, y sin
 * base el recorrido empieza en la primera parada y acaba en la última. Escribe la nota en `nota` y devuelve los minutos al volante.
 */
function mide(pr: Problema, orden: ArrayLike<number>, n: number, nota: Nota, tarde?: (i: number, minutos: number) => void): number {
  const { lugares: L, cap } = pr;
  let reloj = pr.salida, sitio = pr.base, carga = 0, exceso = 0, tE = 0, tA = 0, cmi = 0, manejo = 0;
  for (let k = 0; k < n; ) {
    const i = orden[k];
    const s = pr.sitio[i];
    if (s >= 0) {
      if (sitio >= 0 && sitio !== s) { const t = pr.min[sitio * L + s]; reloj += t; manejo += t; cmi += pr.cmi[sitio * L + s]; }
      sitio = s;
    }
    if (pr.esP[i]) {
      const v = pr.visita[i];
      let suma = 0;
      do {
        const q = orden[k];
        suma += pr.servicio[q];
        carga += pr.cambio[q];
        if (cap != null && carga > cap) exceso += carga - cap;
        k++;
      } while (v >= 0 && k < n && pr.esP[orden[k]] && pr.visita[orden[k]] === v);
      reloj += suma > pr.recarga ? suma : pr.recarga;
    } else {
      const inicio = reloj < pr.abre[i] ? pr.abre[i] : reloj;
      const retraso = inicio - pr.cierra[i];
      if (retraso > 0) { if (pr.estrecha[i]) tE += retraso; else tA += retraso; if (tarde) tarde(i, retraso); }
      reloj = inicio + pr.servicio[i];
      carga += pr.cambio[i];
      if (cap != null && carga > cap) exceso += carga - cap;
      k++;
    }
  }
  if (pr.base >= 0 && sitio >= 0 && sitio !== pr.base) { const t = pr.min[sitio * L + pr.base]; reloj += t; manejo += t; cmi += pr.cmi[sitio * L + pr.base]; }
  nota[0] = exceso; nota[1] = tE; nota[2] = tA; nota[3] = reloj - pr.salida; nota[4] = cmi;
  return manejo;
}

/** ¿`a` es mejor que `b`? En orden: exceso, tarde en ventana estrecha, tarde en las demás, minutos, millas. */
const mejorNota = (a: Nota, b: Nota): boolean => {
  for (let k = 0; k < 5; k++) if (a[k] !== b[k]) return a[k] < b[k];
  return false;
};
type Criterio = (a: Nota, b: Nota) => boolean;
/**
 * La vara BLANDA de las sacudidas: el retraso cuesta minutos (el doble en una ventana estrecha) en vez de mandar sobre todo.
 * Solo para ATRAVESAR: con la vara de verdad, juntar dos visitas a una tienda que ahorra una hora de camino no se acepta si
 * de paso deja una entrega 8 minutos tarde, aunque dos movimientos después ese retraso se quite. Con ella se decide qué
 * orden intermedio se acepta para seguir buscando; lo que se da por mejor es siempre con la de verdad (`mejorNota`).
 */
const valorBlando = (n: Nota): number => n[0] * 1e7 + 2 * n[1] + n[2] + n[3] + n[4] * 1e-7;
const mejorBlanda: Criterio = (a, b) => valorBlando(a) < valorBlando(b);
/** ¿Una entrega nunca va antes que su recogida? */
function respeta(pr: Problema, orden: ArrayLike<number>, n: number, pos: Int32Array): boolean {
  for (let k = 0; k < n; k++) pos[orden[k]] = k;
  for (let k = 0; k < n; k++) { const a = pr.antes[orden[k]]; if (a >= 0 && pos[a] > k) return false; }
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// La búsqueda local: de un orden, a otro mejor moviendo cosas, hasta que nada lo mejore. Varios arranques.

interface Cuenta { medidas: number; pasos: number; tope: number }
type Hallado = { orden: number[]; nota: Nota };

/**
 * Bajar: de un orden, a otro mejor moviendo cosas, hasta que ningún movimiento lo mejore. Los movimientos, del más barato al
 * más caro: (1) una orden entera —su recogida y su entrega— a sus mejores puestos; (2) un bloque de paradas seguidas a otro
 * sitio, tal cual o al revés (con largo 1, una parada sola); (3) dos paradas que cambian de sitio, o un trozo que se da la
 * vuelta. En cuanto un movimiento mejora, se hace y se sigue desde ahí (no se busca el mejor de todos: con 36 paradas, mirar
 * todos los vecinos antes de dar un paso gastaba el presupuesto entero en veinte pasos).
 */
function buscaLocal(pr: Problema, partida: readonly number[], cuenta: Cuenta, mejorQue: Criterio = mejorNota, largoMax = 8): Hallado {
  const m = pr.m;
  const pos = new Int32Array(m);
  const orden = Int32Array.from(partida);
  const nota: Nota = [0, 0, 0, 0, 0];
  mide(pr, orden, m, nota);
  const prueba = new Int32Array(m), mejor = new Int32Array(m), resto = new Int32Array(m);
  const np: Nota = [0, 0, 0, 0, 0], nm: Nota = [0, 0, 0, 0, 0];
  /** Mide `prueba` si respeta la precedencia. ¿Mejora lo que hay? */
  const mejora = (): boolean => {
    if (!respeta(pr, prueba, m, pos)) return false;
    cuenta.medidas++; cuenta.pasos += m;
    mide(pr, prueba, m, np);
    return mejorQue(np, nota);
  };
  const toma = (de: Int32Array, n: Nota) => { orden.set(de); for (let k = 0; k < 5; k++) nota[k] = n[k]; };
  const pares: [number, number][] = [];
  for (let i = 0; i < m; i++) if (pr.antes[i] >= 0) pares.push([pr.antes[i], i]);
  const LARGO = Math.min(m - 1, largoMax);

  for (let movio = true; movio && cuenta.pasos < cuenta.tope; ) {
    movio = false;
    // 1 · Recolocar una orden entera: su recogida y su entrega, cada una en su MEJOR puesto (aquí sí el mejor de todos).
    for (const [p, d] of pares) {
      let r = 0;
      for (let k = 0; k < m; k++) if (orden[k] !== p && orden[k] !== d) resto[r++] = orden[k];
      let hay = false;
      for (let i = 0; i <= r; i++) {
        for (let j = i; j <= r; j++) {
          let w = 0;
          for (let x = 0; x <= r; x++) {
            if (x === i) prueba[w++] = p;
            if (x === j) prueba[w++] = d;
            if (x < r) prueba[w++] = resto[x];
          }
          if (!respeta(pr, prueba, m, pos)) continue;
          cuenta.medidas++; cuenta.pasos += m;
          mide(pr, prueba, m, np);
          if (mejorQue(np, hay ? nm : nota)) { hay = true; mejor.set(prueba); for (let k = 0; k < 5; k++) nm[k] = np[k]; }
        }
      }
      if (hay) { toma(mejor, nm); movio = true; }
    }
    // 2 · Mover un bloque de paradas seguidas a otro sitio, tal cual o al revés.
    for (let largo = 1; largo <= LARGO; largo++) {
      for (let i = 0; i + largo <= m; i++) {
        for (let j = 0; j + largo <= m; j++) {
          if (j === i) continue;
          for (let alReves = 0; alReves < (largo > 1 ? 2 : 1); alReves++) {
            // `prueba`: el orden sin el bloque, con el bloque metido en el puesto `j` de lo que queda.
            let w = 0;
            for (let r = 0; r < m; r++) {
              if (w === j) { for (let b = 0; b < largo; b++) prueba[w++] = orden[alReves ? i + largo - 1 - b : i + b]; }
              if (r >= i && r < i + largo) continue;
              prueba[w++] = orden[r];
            }
            if (w === j) for (let b = 0; b < largo; b++) prueba[w++] = orden[alReves ? i + largo - 1 - b : i + b];
            if (mejora()) { toma(prueba, np); movio = true; }
          }
        }
      }
    }
    // 3 · Cambiar dos paradas de sitio, y dar la vuelta a un trozo.
    for (let i = 0; i < m; i++) {
      for (let j = i + 1; j < m; j++) {
        prueba.set(orden);
        prueba[i] = orden[j]; prueba[j] = orden[i];
        if (mejora()) { toma(prueba, np); movio = true; continue; }
        if (j - i < 2) continue;
        prueba.set(orden);
        for (let k = i; k <= j; k++) prueba[k] = orden[i + j - k];
        if (mejora()) { toma(prueba, np); movio = true; }
      }
    }
  }
  return { orden: Array.from(orden), nota };
}

/** El vecino más cercano EN TIEMPO que se pueda: una recogida que quepa, o una entrega ya recogida. Si nada cabe, la más cercana. */
function vecinoMasCercano(pr: Problema): number[] {
  const { m, lugares: L, cap } = pr;
  const orden: number[] = [];
  const hecha = new Uint8Array(m);
  let carga = 0, aqui = pr.base;
  while (orden.length < m) {
    let elegida = -1, cuanto = Infinity, cabe = false;
    for (let i = 0; i < m; i++) {
      if (hecha[i] || (pr.antes[i] >= 0 && !hecha[pr.antes[i]])) continue;
      const entra = cap == null || carga + pr.cambio[i] <= cap;
      const lejos = pr.sitio[i] >= 0 && aqui >= 0 && aqui !== pr.sitio[i] ? pr.min[aqui * L + pr.sitio[i]] : 0;
      if (elegida < 0 || (entra && !cabe) || (entra === cabe && lejos < cuanto)) { elegida = i; cuanto = lejos; cabe = entra; }
    }
    orden.push(elegida);
    hecha[elegida] = 1;
    carga += pr.cambio[elegida];
    if (pr.sitio[elegida] >= 0) aqui = pr.sitio[elegida];
  }
  return orden;
}

/**
 * Inserción más barata de órdenes enteras: cada una entra, con su recogida y su entrega, donde menos empeora la lista.
 * `puestas`: las que ya están, en su orden; no se mueven.
 *
 * (Se probó a medir solo los puestos que menos camino añaden —contado deprisa— para dar muchas más sacudidas en una ruta
 * grande. Salía PEOR: con ventanas, el mejor puesto de una orden casi nunca es el de menos rodeo. Medido en D-461.)
 */
function insercionMasBarata(pr: Problema, turno: readonly number[], puestas: readonly number[], cuenta: Cuenta, mejorQue: Criterio = mejorNota): number[] {
  const m = pr.m;
  let orden: number[] = [...puestas];
  const puesta = new Uint8Array(m);
  for (const x of puestas) puesta[x] = 1;
  const pos = new Int32Array(m);
  const prueba = new Int32Array(m), mejor = new Int32Array(m);
  const np: Nota = [0, 0, 0, 0, 0], nm: Nota = [0, 0, 0, 0, 0];
  /** `grupo`: una parada suelta, o [recogida, entrega]. Todos los puestos (la entrega, siempre detrás de la recogida). */
  const mete = (grupo: number[]) => {
    const n = orden.length, par = grupo.length > 1;
    let hay = false;
    for (let i = 0; i <= n; i++) {
      for (let j = i; j <= (par ? n : i); j++) {
        let w = 0;
        for (let r = 0; r <= n; r++) {
          if (r === i) prueba[w++] = grupo[0];
          if (par && r === j) prueba[w++] = grupo[1];
          if (r < n) prueba[w++] = orden[r];
        }
        // Un par entra siempre en regla (la recogida delante); una parada suelta puede tener a su pareja ya puesta.
        if (!par && !respetaParcial(pr, prueba, w, pos)) continue;
        cuenta.medidas++; cuenta.pasos += w;
        mide(pr, prueba, w, np);
        if (!hay || mejorQue(np, nm)) { hay = true; mejor.set(prueba); for (let k = 0; k < 5; k++) nm[k] = np[k]; }
      }
    }
    orden = hay ? Array.from(mejor.subarray(0, n + grupo.length)) : [...orden, ...grupo];
    for (const x of grupo) puesta[x] = 1;
  };
  for (const i of turno) {
    if (puesta[i]) continue;
    if (pr.esP[i]) {
      // La recogida entra con la primera de sus entregas; las demás (una parada P de varias órdenes), después, sueltas.
      let d = -1;
      for (const x of turno) if (pr.antes[x] === i && !puesta[x]) { d = x; break; }
      mete(d >= 0 ? [i, d] : [i]);
    } else if (pr.antes[i] >= 0 && !puesta[pr.antes[i]]) mete([pr.antes[i], i]);
    else mete([i]);
  }
  return orden;
}
/** La precedencia en una lista a MEDIAS: una entrega cuya recogida aún no entró no rompe nada. */
function respetaParcial(pr: Problema, orden: ArrayLike<number>, n: number, pos: Int32Array): boolean {
  pos.fill(-1);
  for (let k = 0; k < n; k++) pos[orden[k]] = k;
  for (let k = 0; k < n; k++) { const a = pr.antes[orden[k]]; if (a >= 0 && pos[a] > k) return false; }
  return true;
}

/**
 * Los ARRANQUES: de tres partidas —lo que hay; el vecino más cercano; y la inserción más barata, metiendo primero las órdenes
 * cuya ventana cierra antes—, bajar hasta que nada lo mejore. Es rápido y casi siempre da ya el mejor orden; lo que venga
 * después (la exacta, o las sacudidas) parte de aquí. (Hubo otras dos inserciones —en el orden de la lista, y lo más lejano
 * primero—: medidas sobre las 37 rutas reales y 60 inventadas, no cambiaban nada, y se quitaron.)
 *
 * En una ruta GRANDE (la que la exacta ni intenta) bajar cuesta mucho más y lo que rinde son las sacudidas: aquí se baja
 * solo desde lo que hay y desde el vecino más cercano, con bloques cortos, y sin pasar de una parte del presupuesto.
 */
function arranques(pr: Problema, actual: readonly number[], cuenta: Cuenta): Hallado {
  const m = pr.m;
  const grande = m > MAX_PARADAS_DE_LA_EXACTA;
  const largo = grande ? 3 : 8;
  cuenta.tope = grande ? TOPE_DE_PASOS * PARTE_DE_LOS_ARRANQUES : TOPE_DE_PASOS;
  let mejor: Hallado = buscaLocal(pr, actual, cuenta, mejorNota, largo);
  const prueba = (partida: readonly number[]) => {
    if (cuenta.pasos >= cuenta.tope) return;
    const r = buscaLocal(pr, partida, cuenta, mejorNota, largo);
    if (mejorNota(r.nota, mejor.nota)) mejor = r;
  };
  prueba(vecinoMasCercano(pr));
  if (!grande) {
    const cierraLaOrden = (i: number): number => {
      if (!pr.esP[i]) return pr.cierra[i];
      let c = Infinity;
      for (let x = 0; x < m; x++) if (pr.antes[x] === i && pr.cierra[x] < c) c = pr.cierra[x];
      return c;
    };
    prueba(insercionMasBarata(pr, Array.from({ length: m }, (_, i) => i).sort((a, b) => cierraLaOrden(a) - cierraLaOrden(b) || a - b), [], cuenta));
  }
  cuenta.tope = TOPE_DE_PASOS;
  return mejor;
}
/** En una ruta grande, la parte del presupuesto que pueden gastar los arranques. El resto es de las sacudidas. */
const PARTE_DE_LOS_ARRANQUES = 0.25;

/** Cuántas sacudidas se dan como mucho (antes suele cortar el presupuesto), y cuántas órdenes se sacan como mucho en cada una. */
const SACUDIDAS = 6000, MAX_FUERA = 6;

/**
 * Las SACUDIDAS, para la ruta que la búsqueda exacta no puede terminar: sacar unas órdenes enteras —al azar, o una y las que
 * más se le parecen (recogen y entregan cerca)— y volver a meterlas una a una donde mejor quepan. Lo que sale se acepta si no
 * empeora más que un margen que se va cerrando, y cada mejora de verdad se pule bajando. Es lo que desarma un orden que solo
 * se arregla moviendo varias órdenes a la vez, que es donde la bajada sola se queda atascada.
 *
 * El azar es un generador FIJO (el congruencial de «Numerical Recipes»), sin `Math.random`: la misma lista da siempre el
 * mismo orden. Y se corta por cuenta (`SACUDIDAS`, `TOPE_DE_PASOS`), nunca por reloj.
 */
function sacudidas(pr: Problema, partida: Hallado, cuenta: Cuenta): Hallado {
  const m = pr.m, L = pr.lugares;
  const grupos: number[][] = [];
  for (let i = 0; i < m; i++) {
    if (pr.esP[i]) { const g = [i]; for (let x = 0; x < m; x++) if (pr.antes[x] === i) g.push(x); grupos.push(g); }
    else if (pr.antes[i] < 0) grupos.push([i]);
  }
  const G = grupos.length;
  if (G < 3) return partida;
  let semilla = 20261002;
  const azar = (n: number): number => { semilla = (Math.imul(semilla, 1664525) + 1013904223) >>> 0; return semilla % n; };
  const entre = (a: number, b: number): number => (a >= 0 && b >= 0 && a !== b ? Math.min(pr.min[a * L + b], pr.min[b * L + a]) : 0);
  /** Lo que se parecen dos órdenes: lo cerca que quedan sus recogidas y sus entregas. Menos es más parecido. */
  const parecido = (a: number, b: number): number =>
    entre(pr.sitio[grupos[a][0]], pr.sitio[grupos[b][0]]) + entre(pr.sitio[grupos[a][grupos[a].length - 1]], pr.sitio[grupos[b][grupos[b].length - 1]]);

  let actual = partida.orden;
  const notaActual: Nota = [...partida.nota];
  let mejor = partida;
  const nc: Nota = [0, 0, 0, 0, 0];
  const sacada = new Uint8Array(m);
  const margen = Math.max(10, 0.12 * partida.nota[3]);
  for (let vuelta = 0; vuelta < SACUDIDAS && cuenta.pasos < cuenta.tope; vuelta++) {
    const cuantas = 1 + azar(Math.min(G - 1, MAX_FUERA));
    const primera = azar(G);
    const fuera = [primera];
    if (vuelta % 2 === 0) { while (fuera.length < cuantas) { const g = azar(G); if (!fuera.includes(g)) fuera.push(g); } }
    else {
      const otras = grupos.map((_, g) => g).filter((g) => g !== primera).sort((a, b) => parecido(primera, a) - parecido(primera, b) || a - b);
      for (let k = 0; fuera.length < cuantas; k++) fuera.push(otras[k]);
    }
    sacada.fill(0);
    for (const g of fuera) for (const x of grupos[g]) sacada[x] = 1;
    // Vuelven en un turno barajado, a su mejor sitio: una vez con la vara de verdad y otra con la blanda.
    for (let k = fuera.length - 1; k > 0; k--) { const j = azar(k + 1); const t = fuera[k]; fuera[k] = fuera[j]; fuera[j] = t; }
    const candidata = insercionMasBarata(pr, fuera.flatMap((g) => grupos[g]), actual.filter((x) => !sacada[x]), cuenta, vuelta % 4 < 2 ? mejorNota : mejorBlanda);
    mide(pr, candidata, m, nc);
    if (mejorNota(nc, mejor.nota)) {
      // Una mejora de verdad: se pule bajando, y de ahí se sigue.
      mejor = buscaLocal(pr, candidata, cuenta);
      actual = mejor.orden;
      for (let k = 0; k < 5; k++) notaActual[k] = mejor.nota[k];
    } else if (valorBlando(nc) <= valorBlando(notaActual) + margen * (1 - vuelta / SACUDIDAS)) {
      actual = candidata;
      for (let k = 0; k < 5; k++) notaActual[k] = nc[k];
    }
  }
  return mejor;
}

// ---------------------------------------------------------------------------------------------------------------------
// La búsqueda exacta: programación dinámica sobre «qué paradas van hechas, dónde está el camión y en qué visita».

interface Etiqueta { pen: number; u: number; v: number; cmi: number; padre: Etiqueta | null; k: number }
const PESO_EXCESO = 1e10, PESO_ESTRECHA = 1e5;

/**
 * El mejor orden que EXISTE, o `null` si no hay ninguno mejor que `cota` (la nota de lo mejor que ya se tiene).
 *
 * Estado: las paradas hechas (un entero de bits), el lugar donde está el camión y, si lo último fue una recogida, en qué
 * tienda (para que la siguiente recogida allí sea la misma visita). De cada estado se guardan las ETIQUETAS que ninguna otra
 * domina: (penalización, `u`, `v`, millas), donde la hora es `max(u, v)` — `u` es cuándo acaba la visita con la recarga
 * mínima y `v` con lo cargado hasta ahora; fuera de una visita, `u = v`. Una etiqueta con todo menor o igual que otra llega
 * antes o igual a todo lo que venga después, y nunca más tarde a una ventana: la otra sobra. Por eso es exacta.
 *
 * Y se poda con `cota`: una etiqueta que ya penaliza más, o que ni con lo mínimo que le queda (cada lugar pendiente, por su
 * tramo de entrada más corto; cada carga y descarga pendiente; la vuelta) puede acabar antes, no llega a nada mejor.
 *
 * Se rinde (`completa: false`) al pasar de `tope` etiquetas: se corta por cuenta, no por reloj.
 */
function exacta(pr: Problema, cota: Nota, tope: number): { completa: boolean; orden: number[] | null; etiquetas: number } {
  const { m, lugares: L, cap, recarga } = pr;
  if (m > MAX_PARADAS_DE_LA_EXACTA) return { completa: false, orden: null, etiquetas: 0 };
  const V = pr.visitas + 1, NC = (L + 1) * V;
  const penCota = cota[0] * PESO_EXCESO + cota[1] * PESO_ESTRECHA + cota[2], tCota = cota[3], cmiCota = cota[4];
  let capa = new Map<number, Etiqueta[]>();
  capa.set((pr.base + 1) * V, [{ pen: 0, u: pr.salida, v: pr.salida, cmi: 0, padre: null, k: -1 }]);
  let creadas = 1;
  const servDeVisita = new Int32Array(pr.visitas), hayEnVisita = new Uint8Array(pr.visitas), enR = new Uint8Array(L), lugaresR = new Int32Array(L);
  // Para el árbol: lo que cuesta unir dos lugares en el sentido más barato, y lo que le falta a cada uno para entrar en él.
  const union = new Int32Array(L * L), falta = new Float64Array(L), dentro = new Uint8Array(L);
  for (let a = 0; a < L; a++) for (let b = 0; b < L; b++) union[a * L + b] = Math.min(pr.min[a * L + b], pr.min[b * L + a]);

  for (let nivel = 0; nivel < m; nivel++) {
    const siguiente = new Map<number, Etiqueta[]>();
    for (const [clave, etiquetas] of capa) {
      const clase = clave % NC, hechas = (clave - clase) / NC;
      const sitio = Math.floor(clase / V) - 1, visita = (clase % V) - 1;
      // Lo de este estado, una vez: la carga a bordo, y lo mínimo que queda por delante.
      let carga = 0, servicioQueQueda = 0, nR = 0;
      servDeVisita.fill(0); hayEnVisita.fill(0); enR.fill(0);
      for (let i = 0; i < m; i++) {
        if ((hechas >> i) & 1) { carga += pr.cambio[i]; continue; }
        if (!pr.esP[i]) servicioQueQueda += pr.servicio[i];
        else if (pr.visita[i] < 0) servicioQueQueda += Math.max(recarga, pr.servicio[i]);
        else { servDeVisita[pr.visita[i]] += pr.servicio[i]; hayEnVisita[pr.visita[i]] = 1; }
        const s = pr.sitio[i];
        if (s >= 0 && !enR[s]) { enR[s] = 1; lugaresR[nR++] = s; }
      }
      // Cada tienda pendiente, al menos una visita más; la de la visita en curso se cuenta por etiqueta (puede salir gratis).
      let enEstaVisita = 0;
      for (let x = 0; x < pr.visitas; x++) {
        if (!hayEnVisita[x]) continue;
        if (x === visita) enEstaVisita = servDeVisita[x]; else servicioQueQueda += Math.max(recarga, servDeVisita[x]);
      }
      // El camino que queda, como mínimo, contado de dos maneras —las dos se quedan cortas, vale la mayor—: por las ENTRADAS
      // (a cada lugar pendiente hay que llegar una vez, por su tramo más corto, y al final volver a la base) y por las
      // SALIDAS (de cada lugar pendiente, y de donde está el camión, hay que salir una vez: a otro pendiente o a la base).
      let viajeQueQueda = 0, millasQueQuedan = 0;
      if (sitio >= 0) {
        let tEnt = 0, cEnt = 0, tSal = 0, cSal = 0, tMayor = 0, cMayor = 0;
        for (let a = 0; a < nR; a++) {
          const l = lugaresR[a];
          if (l === sitio) continue;
          let tMin = pr.min[sitio * L + l], cMin = pr.cmi[sitio * L + l];
          for (let b = 0; b < nR; b++) {
            const x = lugaresR[b];
            if (x === l) continue;
            if (pr.min[x * L + l] < tMin) tMin = pr.min[x * L + l];
            if (pr.cmi[x * L + l] < cMin) cMin = pr.cmi[x * L + l];
          }
          tEnt += tMin; cEnt += cMin;
        }
        if (pr.base >= 0) {
          let tMin = nR ? Infinity : pr.min[sitio * L + pr.base], cMin = nR ? Infinity : pr.cmi[sitio * L + pr.base];
          for (let a = 0; a < nR; a++) {
            const l = lugaresR[a];
            if (pr.min[l * L + pr.base] < tMin) tMin = pr.min[l * L + pr.base];
            if (pr.cmi[l * L + pr.base] < cMin) cMin = pr.cmi[l * L + pr.base];
          }
          tEnt += tMin; cEnt += cMin;
        }
        for (let a = enR[sitio] ? 0 : -1; a < nR; a++) {
          const l = a < 0 ? sitio : lugaresR[a];
          // De la base no hace falta salir: puede ser lo último. (Sin base, el último lugar tampoco: se quita el mayor.)
          if (l === pr.base) continue;
          let tMin = pr.base >= 0 ? pr.min[l * L + pr.base] : Infinity, cMin = pr.base >= 0 ? pr.cmi[l * L + pr.base] : Infinity;
          for (let b = 0; b < nR; b++) {
            const x = lugaresR[b];
            if (x === l) continue;
            if (pr.min[l * L + x] < tMin) tMin = pr.min[l * L + x];
            if (pr.cmi[l * L + x] < cMin) cMin = pr.cmi[l * L + x];
          }
          if (tMin === Infinity) continue;
          tSal += tMin; cSal += cMin;
          if (tMin > tMayor) tMayor = tMin;
          if (cMin > cMayor) cMayor = cMin;
        }
        if (pr.base < 0) { tSal -= tMayor; cSal -= cMayor; }
        viajeQueQueda = tEnt > tSal ? tEnt : tSal; millasQueQuedan = cEnt > cSal ? cEnt : cSal;
        // Y de una tercera: el ÁRBOL más corto que une los lugares pendientes (cualquier camino que pase por todos mide al
        // menos eso), más llegar a ellos desde donde está el camión y volver a la base desde alguno. Es la que ve que dos
        // grupos de paradas lejanos entre sí obligan a cruzar de uno a otro, aunque cada parada tenga otra al lado.
        if (nR > 0) {
          let arbol = 0;
          for (let a = 0; a < nR; a++) { dentro[a] = 0; falta[a] = a === 0 ? 0 : Infinity; }
          for (let paso = 0; paso < nR; paso++) {
            let cual = -1;
            for (let a = 0; a < nR; a++) if (!dentro[a] && (cual < 0 || falta[a] < falta[cual])) cual = a;
            dentro[cual] = 1; arbol += falta[cual];
            const l = lugaresR[cual];
            for (let a = 0; a < nR; a++) if (!dentro[a] && union[l * L + lugaresR[a]] < falta[a]) falta[a] = union[l * L + lugaresR[a]];
          }
          if (!enR[sitio]) {
            let tMin = Infinity;
            for (let a = 0; a < nR; a++) if (pr.min[sitio * L + lugaresR[a]] < tMin) tMin = pr.min[sitio * L + lugaresR[a]];
            arbol += tMin;
          }
          if (pr.base >= 0 && !enR[pr.base]) {
            let tMin = Infinity;
            for (let a = 0; a < nR; a++) if (pr.min[lugaresR[a] * L + pr.base] < tMin) tMin = pr.min[lugaresR[a] * L + pr.base];
            arbol += tMin;
          }
          if (arbol > viajeQueQueda) viajeQueQueda = arbol;
        }
      }
      const quedan = servicioQueQueda + viajeQueQueda;

      for (const et of etiquetas) {
        const ahora = et.u > et.v ? et.u : et.v;
        // ¿Puede acabar mejor que lo que ya se tiene? Con lo de esta visita sumado a lo cargado.
        const conLaVisita = enEstaVisita ? Math.max(et.u, et.v + enEstaVisita) : ahora;
        if (et.pen > penCota) continue;
        if (et.pen === penCota) {
          const minimo = conLaVisita + quedan - pr.salida;
          if (minimo > tCota || (minimo === tCota && et.cmi + millasQueQuedan >= cmiCota)) continue;
        }
        for (let k = 0; k < m; k++) {
          if ((hechas >> k) & 1) continue;
          const a = pr.antes[k];
          if (a >= 0 && !((hechas >> a) & 1)) continue;
          const s = pr.sitio[k];
          let pen = et.pen, u: number, v: number, cmi = et.cmi, nuevaVisita = -1;
          const nuevoSitio = s >= 0 ? s : sitio;
          if (pr.esP[k] && visita >= 0 && pr.visita[k] === visita) {
            // La misma visita a la tienda: no se mueve; solo se carga más.
            u = et.u; v = et.v + pr.servicio[k]; nuevaVisita = visita;
          } else {
            let t = ahora;
            if (s >= 0 && sitio >= 0 && sitio !== s) { t += pr.min[sitio * L + s]; cmi += pr.cmi[sitio * L + s]; }
            if (pr.esP[k]) { u = t + recarga; v = t + pr.servicio[k]; nuevaVisita = pr.visita[k]; }
            else {
              const inicio = t < pr.abre[k] ? pr.abre[k] : t;
              const retraso = inicio - pr.cierra[k];
              if (retraso > 0) pen += pr.estrecha[k] ? retraso * PESO_ESTRECHA : retraso;
              u = v = inicio + pr.servicio[k];
            }
          }
          const cargaTras = carga + pr.cambio[k];
          if (cap != null && cargaTras > cap) pen += (cargaTras - cap) * PESO_EXCESO;
          if (pen > penCota) continue;
          // Una recogida suelta (sin tienda) acaba su visita ahí mismo: fuera de una visita, `u = v`.
          if (pr.esP[k] && nuevaVisita < 0) u = v = u > v ? u : v;
          const destino = (hechas | (1 << k)) * NC + (nuevoSitio + 1) * V + (nuevaVisita + 1);
          const lista = siguiente.get(destino);
          if (!lista) { siguiente.set(destino, [{ pen, u, v, cmi, padre: et, k }]); creadas++; continue; }
          let dominada = false;
          for (let x = 0; x < lista.length; x++) {
            const o = lista[x];
            if (o.pen <= pen && o.u <= u && o.v <= v && o.cmi <= cmi) { dominada = true; break; }
          }
          if (dominada) continue;
          let w = 0;
          for (let x = 0; x < lista.length; x++) {
            const o = lista[x];
            if (!(pen <= o.pen && u <= o.u && v <= o.v && cmi <= o.cmi)) lista[w++] = o;
          }
          lista.length = w;
          lista.push({ pen, u, v, cmi, padre: et, k });
          creadas++;
        }
        if (creadas > tope) return { completa: false, orden: null, etiquetas: creadas };
      }
    }
    capa = siguiente;
  }
  // El final: la vuelta a la base, y la mejor de todas las que llegaron.
  let mejor: Etiqueta | null = null, mejorPen = penCota, mejorT = tCota, mejorCmi = cmiCota;
  for (const [clave, etiquetas] of capa) {
    const sitio = Math.floor((clave % NC) / V) - 1;
    const vuelve = pr.base >= 0 && sitio >= 0 && sitio !== pr.base;
    for (const et of etiquetas) {
      const t = (et.u > et.v ? et.u : et.v) + (vuelve ? pr.min[sitio * L + pr.base] : 0) - pr.salida;
      const cmi = et.cmi + (vuelve ? pr.cmi[sitio * L + pr.base] : 0);
      if (et.pen < mejorPen || (et.pen === mejorPen && (t < mejorT || (t === mejorT && cmi < mejorCmi)))) { mejor = et; mejorPen = et.pen; mejorT = t; mejorCmi = cmi; }
    }
  }
  if (!mejor) return { completa: true, orden: null, etiquetas: creadas };
  const orden: number[] = [];
  for (let et: Etiqueta | null = mejor; et && et.k >= 0; et = et.padre) orden.push(et.k);
  return { completa: true, orden: orden.reverse(), etiquetas: creadas };
}

/**
 * Dentro de un mismo sitio, el orden de la lista de partida: las recogidas seguidas de una tienda y las entregas seguidas en
 * un punto salen como estaban entre sí, siempre que eso no cambie NADA de la nota. A igual resultado, lo que ya había.
 */
function comoEstaban(pr: Problema, orden: number[]): number[] {
  const m = pr.m;
  const nota: Nota = [0, 0, 0, 0, 0], np: Nota = [0, 0, 0, 0, 0];
  mide(pr, orden, m, nota);
  const prueba = [...orden];
  const pos = new Int32Array(m);
  const mismoGrupo = (a: number, b: number) => (pr.esP[a] && pr.esP[b] ? pr.visita[a] >= 0 && pr.visita[a] === pr.visita[b] : !pr.esP[a] && !pr.esP[b] && pr.sitio[a] >= 0 && pr.sitio[a] === pr.sitio[b]);
  for (let i = 0; i < m; ) {
    let j = i + 1;
    while (j < m && mismoGrupo(prueba[i], prueba[j])) j++;
    if (j - i > 1) {
      const trozo = prueba.slice(i, j);
      const ordenado = [...trozo].sort((a, b) => a - b);
      for (let k = i; k < j; k++) prueba[k] = ordenado[k - i];
      mide(pr, prueba, m, np);
      if (!respeta(pr, prueba, m, pos) || np.some((x, k) => x !== nota[k])) for (let k = i; k < j; k++) prueba[k] = trozo[k - i];
    }
    i = j;
  }
  return prueba;
}

function medidaDe(pr: Problema, e: EntradaDeOptimizar, orden: readonly number[]): { nota: Nota; medida: MedidaDeLaLista } {
  const nota: Nota = [0, 0, 0, 0, 0];
  const tarde: MedidaDeLaLista["tarde"] = [];
  const manejoMin = mide(pr, orden, orden.length, nota, (i, minutos) => {
    const p = e.paradas[i];
    if (p.tipo === "D") tarde.push({ orden: p.orden, minutos, estrecha: pr.estrecha[i] });
  });
  return { nota, medida: { millas: Math.round(nota[4] / 10) / 10, minutos: nota[3], manejoMin, exceso: nota[0] / 100, tarde } };
}

/**
 * Los minutos que el camión pasa PARADO en cada parada de la lista, en ese orden, contados como los cuenta el optimizador (y
 * el motor): en una entrega, su descarga; en la primera recogida de una visita a una tienda, lo mayor entre la recarga
 * mínima y la suma de lo que se carga en esa visita —las recogidas seguidas en la misma tienda—; en las demás recogidas de
 * esa visita, cero. Lo usa la medida de la tarjeta (`mideLaRuta`) para que sus horas y las del optimizador sean las mismas:
 * desde D-444 cada recogida es su fila, y contar la recarga mínima por FILA cargaba 100 minutos por recoger cinco cajas en la
 * misma tienda.
 */
export function minutosEnCadaParada(paradas: readonly ParadaDeLaLista[], servicios: readonly (number | null)[], recargaMinimaMin: number = RELOAD_MIN): number[] {
  const tienda = (p: ParadaDeLaLista) => (p.tipo === "P" ? (p.tienda ?? "").trim().toLowerCase() : "");
  const out = paradas.map(() => 0);
  for (let k = 0; k < paradas.length; ) {
    const p = paradas[k];
    if (p.tipo === "D") { out[k] = entero(servicios[k]); k++; continue; }
    let suma = entero(servicios[k]), j = k + 1;
    while (tienda(p) && j < paradas.length && paradas[j].tipo === "P" && tienda(paradas[j]) === tienda(p)) suma += entero(servicios[j++]);
    out[k] = Math.max(recargaMinimaMin, suma);
    k = j;
  }
  return out;
}

/** Lo que mide la lista TAL COMO ESTÁ, con la misma cuenta que usa el optimizador. Para enseñarlo, y para las pruebas. */
export function mideLaLista(e: EntradaDeOptimizar): MedidaDeLaLista {
  return medidaDe(problemaDe(e), e, e.paradas.map((_, i) => i)).medida;
}

export function optimizaLaLista(e: EntradaDeOptimizar): ResultadoDeOptimizar {
  const pr = problemaDe(e);
  const m = pr.m;
  const actual = e.paradas.map((_, i) => i);
  const antes = medidaDe(pr, e, actual);
  const sinPunto = e.puntos.filter((p) => !p).length + Math.max(0, m - e.puntos.length);
  const medida: ResultadoDeOptimizar["medida"] = pr.estimados === 0 ? "real" : pr.reales === 0 ? "estimada" : "mixta";
  const sinCambio = (exactaYa: boolean, trabajo = { medidas: 0, etiquetas: 0 }): ResultadoDeOptimizar => ({
    paradas: [...e.paradas], cambio: false, antes: antes.medida, despues: antes.medida,
    millasAntes: antes.medida.millas, millasDespues: antes.medida.millas, excesoAntes: antes.medida.exceso, excesoDespues: antes.medida.exceso,
    sinPunto, medida, exacta: exactaYa, trabajo,
  });
  // Con menos de tres paradas no hay orden que elegir; y una lista que ya rompe la precedencia no se toca aquí.
  if (m < 3) return sinCambio(true);
  if (ordenSinRecoger(e.paradas) != null) return sinCambio(false);

  // Primero los arranques, que dan una buena lista y la cota; después la exacta, que la confirma o la mejora. Y si la exacta
  // no termina (la ruta es grande), las sacudidas: la búsqueda local a fondo.
  const cuenta: Cuenta = { medidas: 0, pasos: 0, tope: TOPE_DE_PASOS };
  let local: Hallado = e.sinBusquedaLocal ? { orden: actual, nota: antes.nota } : arranques(pr, actual, cuenta);
  const ex = exacta(pr, local.nota, e.topeDeLaExacta ?? TOPE_DE_LA_EXACTA);
  if (!ex.completa && !e.sinBusquedaLocal) local = sacudidas(pr, local, cuenta);
  let elegida = local.orden, nota = local.nota;
  if (ex.orden) { elegida = ex.orden; nota = medidaDe(pr, e, elegida).nota; }
  const trabajo = { medidas: cuenta.medidas, etiquetas: ex.etiquetas };

  // ¿Vale la pena? Menos exceso o menos retraso, siempre; si no, al menos un minuto, o a igual tiempo una décima de milla.
  const a = antes.nota;
  const gana = nota[0] !== a[0] ? nota[0] < a[0] : nota[1] !== a[1] ? nota[1] < a[1] : nota[2] !== a[2] ? nota[2] < a[2]
    : nota[3] !== a[3] ? nota[3] < a[3] : nota[4] <= a[4] - centesimas(MARGEN_MI);
  if (!gana) return sinCambio(ex.completa, trabajo);
  elegida = comoEstaban(pr, elegida);
  const despues = medidaDe(pr, e, elegida);
  return {
    paradas: elegida.map((i) => e.paradas[i]), cambio: true, antes: antes.medida, despues: despues.medida,
    millasAntes: antes.medida.millas, millasDespues: despues.medida.millas, excesoAntes: antes.medida.exceso, excesoDespues: despues.medida.exceso,
    sinPunto, medida, exacta: ex.completa, trabajo,
  };
}
