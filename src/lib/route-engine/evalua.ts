import type {
  ChoferEntrada, Desglose, Matriz, OrdenEntrada, ParadaEvaluada, ParadaRef, Parametros, Pesos, PlanEvaluado,
  RutaEvaluada, Violacion,
} from "./types";

/**
 * Evaluar un plan: la ÚNICA función que pone horas, cargas y coste a una secuencia de paradas (D-314).
 *
 * La usan tres cosas que tienen que dar el mismo número: el motor para decidir, la pantalla cuando el
 * despachador mueve una parada a mano, y la comparación cuando se puntúa la hoja manual. Si dos de ellas
 * discrepan, es un bug, no una diferencia de criterio.
 *
 * **Nunca rechaza una secuencia: la mide y dice qué incumple.** La ruta de la hoja del despachador puede
 * cargar 11 pallets en un camión de 10, y lo que se quiere es verlo, no un error.
 */

/** Valores de arranque. Los de verdad vienen de Ajustes; estos reproducen el orden del dueño —builder
 *  temprano > ruta corta > ventana ancha > balance— y los fijan las pruebas de `pesos`. */
export const PESOS_POR_DEFECTO: Pesos = { builder: 2, manejo: 1, millas: 0.5, tarde: 0.75, balance: 0.1 };

export const PARAMETROS_POR_DEFECTO: Parametros = {
  pesos: PESOS_POR_DEFECTO,
  topeTardeAnchaMin: 60,
  recargaMinimaMin: 20,
  maxMovimientos: 2000,
};

/** Pallets → centésimas enteras. 0.15 + 0.25 + 0.6 tiene que dar 1 justo, no 0.9999999999999999. */
export const aCentesimas = (n: number): number => Math.round((Number.isFinite(n) ? n : 0) * 100);
const deCentesimas = (c: number): number => c / 100;
/** Un peso, en milésimas enteras: el coste total se compara como entero y no baila por un decimal. */
const enMilesimas = (w: number): number => Math.round((Number.isFinite(w) ? w : 0) * 1000);

export const DESGLOSE_CERO: Desglose = { builder: 0, manejoMin: 0, millas: 0, tardeMin: 0, balanceMin: 0, total: 0 };

/**
 * La suma ponderada, entera. Las millas entran en centésimas y todo lo demás se multiplica por 100 para
 * estar en la misma escala: el total no significa nada por sí solo, solo sirve para comparar dos planes.
 */
export function costeTotal(d: Omit<Desglose, "total">, pesos: Pesos): number {
  return 100 * enMilesimas(pesos.builder) * d.builder
    + 100 * enMilesimas(pesos.manejo) * d.manejoMin
    + enMilesimas(pesos.millas) * aCentesimas(d.millas)
    + 100 * enMilesimas(pesos.tarde) * d.tardeMin
    + 100 * enMilesimas(pesos.balance) * d.balanceMin;
}

export function restaDesglose(a: Desglose, b: Desglose): Desglose {
  return {
    builder: a.builder - b.builder,
    manejoMin: a.manejoMin - b.manejoMin,
    millas: deCentesimas(aCentesimas(a.millas) - aCentesimas(b.millas)),
    tardeMin: a.tardeMin - b.tardeMin,
    balanceMin: a.balanceMin - b.balanceMin,
    total: a.total - b.total,
  };
}

type Contexto = { ordenes: ReadonlyMap<string, OrdenEntrada>; matriz: Matriz; parametros: Parametros; fijadas?: ReadonlySet<string> };

const claveDeParada = (p: ParadaRef) => `${p.tipo}:${p.orden}`;

/** Ir de `a` a `b`. De un sitio a sí mismo, cero; un tramo que la matriz no trae es `null`, no cero. */
function tramo(matriz: Matriz, a: string, b: string): { min: number; centiMi: number } | null {
  if (a === b) return { min: 0, centiMi: 0 };
  const t = matriz[a]?.[b];
  if (!t || !Number.isFinite(t.minutos) || !Number.isFinite(t.millas)) return null;
  return { min: Math.round(t.minutos), centiMi: aCentesimas(t.millas) };
}

export function evaluaRuta(chofer: ChoferEntrada, paradas: readonly ParadaRef[], ctx: Contexto): RutaEvaluada {
  const { ordenes, matriz, parametros } = ctx;
  const violaciones: Violacion[] = [];
  const viola = (tipo: Violacion["tipo"], orden?: string, detalle?: string) => violaciones.push({ tipo, chofer: chofer.id, orden, detalle });

  const capacidad = aCentesimas(chofer.capacidad);
  const recogidas = new Set<string>();
  const entregadas = new Set<string>();
  // Lo que ya va en el camión al empezar: órdenes recogidas antes, de las que aquí solo queda la entrega.
  let carga = 0;
  for (const p of paradas) {
    const o = ordenes.get(p.orden);
    if (o?.recogidaHecha && p.tipo === "D") { carga += aCentesimas(o.pallets); recogidas.add(o.id); }
  }
  if (carga > capacidad) viola("capacidad", undefined, "al salir");

  let reloj = chofer.entrada;
  let sitio = chofer.base;
  let manejo = 0, centiMi = 0, tarde = 0, builder = 0;
  let visita = 0;
  let etiquetaSiguiente = 1;
  const numeroDe = new Map<string, number>();
  const evaluadas: ParadaEvaluada[] = [];

  for (let k = 0; k < paradas.length; k++) {
    const p = paradas[k];
    const o = ordenes.get(p.orden);
    if (!o) continue;
    const punto = p.tipo === "P" ? o.origen : o.destino;
    if (!punto) { viola("sin_tiempo_de_viaje", o.id, "sin punto"); continue; }
    if (o.choferFijado && o.choferFijado !== chofer.id) viola("chofer_distinto_del_fijado", o.id);

    const t = tramo(matriz, sitio, punto);
    if (!t) viola("sin_tiempo_de_viaje", o.id, `${sitio} → ${punto}`);
    const tramoMin = t?.min ?? 0;
    manejo += tramoMin;
    centiMi += t?.centiMi ?? 0;
    const llegada = reloj + tramoMin;

    // Paradas seguidas del mismo tipo en el mismo sitio son una sola visita física.
    const anterior = evaluadas[evaluadas.length - 1];
    const mismaVisita = !!anterior && anterior.punto === punto && anterior.tipo === p.tipo;
    if (!mismaVisita) visita++;

    let espera = 0, inicio = llegada, servicio = 0, tardeAqui = 0;
    if (p.tipo === "P") {
      // La carga de una visita a la tienda dura lo MAYOR entre el mínimo de recarga y la suma de lo que
      // se recoge ahí. Se apunta entera en la primera parada de la visita; las demás, cero.
      if (!mismaVisita) {
        let suma = 0;
        for (let j = k; j < paradas.length; j++) {
          const oj = ordenes.get(paradas[j].orden);
          if (paradas[j].tipo !== "P" || !oj || oj.origen !== punto) break;
          suma += Math.max(0, Math.round(oj.servicioRecogidaMin));
        }
        servicio = Math.max(parametros.recargaMinimaMin, suma);
      }
      if (recogidas.has(o.id)) viola("precedencia", o.id, "recogida dos veces");
      recogidas.add(o.id);
      carga += aCentesimas(o.pallets);
      if (carga > capacidad) viola("capacidad", o.id, `${deCentesimas(carga)} de ${chofer.capacidad}`);
      if (!numeroDe.has(o.id)) numeroDe.set(o.id, etiquetaSiguiente++);
    } else {
      if (!recogidas.has(o.id)) viola("precedencia", o.id, "se entrega antes de recogerla");
      if (o.ventana) {
        const [abre, cierra] = o.ventana;
        if (llegada < abre) { espera = abre - llegada; inicio = abre; }
        tardeAqui = Math.max(0, inicio - cierra);
        if (tardeAqui > 0 && o.estrecha) viola("ventana_estrecha", o.id, `${tardeAqui} min`);
        else if (tardeAqui > parametros.topeTardeAnchaMin) viola("retraso_sobre_el_tope", o.id, `${tardeAqui} min`);
      }
      servicio = Math.max(0, Math.round(o.servicioEntregaMin));
      tarde += tardeAqui;
      if (o.builder) builder += inicio - chofer.entrada;
      carga -= aCentesimas(o.pallets);
      entregadas.add(o.id);
      // Una orden recogida antes de hoy no tuvo su P aquí: se numera al entregarla.
      if (!numeroDe.has(o.id)) numeroDe.set(o.id, etiquetaSiguiente++);
    }

    const salida = inicio + servicio;
    evaluadas.push({
      orden: o.id, tipo: p.tipo, punto, etiqueta: `${p.tipo}${numeroDe.get(o.id)}`, visita,
      tramoMin, tramoMillas: deCentesimas(t?.centiMi ?? 0), llegada, esperaMin: espera, inicioServicio: inicio,
      servicioMin: servicio, salida, tardeMin: tardeAqui, cargaAlSalir: deCentesimas(carga),
      fijada: ctx.fijadas?.has(claveDeParada(p)) ?? false,
    });
    reloj = salida;
    sitio = punto;
  }

  // Lo que se recogió tiene que entregarse en esta misma ruta: el par no se reparte entre dos camiones.
  for (const id of recogidas) if (!entregadas.has(id)) viola("precedencia", id, "se recoge y no se entrega");

  let fin = reloj;
  if (evaluadas.length > 0 && chofer.vuelveABase) {
    const t = tramo(matriz, sitio, chofer.base);
    if (!t) viola("sin_tiempo_de_viaje", undefined, `${sitio} → ${chofer.base}`);
    manejo += t?.min ?? 0;
    centiMi += t?.centiMi ?? 0;
    fin = reloj + (t?.min ?? 0);
  }
  if (fin > chofer.salida) viola("fuera_de_turno", undefined, `${fin - chofer.salida} min`);

  return {
    chofer: chofer.id, paradas: evaluadas, inicio: chofer.entrada, fin,
    duracionMin: evaluadas.length > 0 ? fin - chofer.entrada : 0,
    manejoMin: manejo, millas: deCentesimas(centiMi), tardeMin: tarde, builderMin: builder, violaciones,
  };
}

/** El coste de un conjunto de rutas ya evaluadas. El balance mira a TODOS los choferes: uno sin paradas
 *  cuenta como cero minutos, que es justo lo que «repartir» quiere corregir. */
export function costeDeRutas(rutas: readonly RutaEvaluada[], pesos: Pesos): Desglose {
  let builder = 0, manejoMin = 0, centiMi = 0, tardeMin = 0, max = 0, min = Infinity;
  for (const r of rutas) {
    builder += r.builderMin; manejoMin += r.manejoMin; centiMi += aCentesimas(r.millas); tardeMin += r.tardeMin;
    max = Math.max(max, r.duracionMin); min = Math.min(min, r.duracionMin);
  }
  const d = { builder, manejoMin, millas: deCentesimas(centiMi), tardeMin, balanceMin: rutas.length > 1 ? max - min : 0 };
  return { ...d, total: costeTotal(d, pesos) };
}

/**
 * Evalúa un plan entero: una secuencia por chofer. Es la puerta para la pantalla y para la hoja manual.
 * Los choferes sin secuencia salen con una ruta vacía, para que el balance sea el de verdad.
 */
export function evaluaPlan(args: {
  secuencias: Readonly<Record<string, readonly ParadaRef[]>>;
  ordenes: readonly OrdenEntrada[];
  choferes: readonly ChoferEntrada[];
  matriz: Matriz;
  parametros?: Parametros;
  fijadas?: ReadonlySet<string>;
}): PlanEvaluado {
  const parametros = args.parametros ?? PARAMETROS_POR_DEFECTO;
  const ctx: Contexto = { ordenes: new Map(args.ordenes.map((o) => [o.id, o])), matriz: args.matriz, parametros, fijadas: args.fijadas };
  const rutas = args.choferes.map((c) => evaluaRuta(c, args.secuencias[c.id] ?? [], ctx));
  return { rutas, coste: costeDeRutas(rutas, parametros.pesos), violaciones: rutas.flatMap((r) => r.violaciones) };
}

export { claveDeParada };
export type { Contexto };
