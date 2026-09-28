import {
  MINUTOS_POR_BLOQUE,
  type BalancePor, type ChoferEntrada, type Desglose, type Matriz, type OrdenEntrada, type ParadaEvaluada, type ParadaRef, type Parametros,
  type Pesos, type PlanEvaluado, type RutaEvaluada, type TiemposPorHora, type Violacion,
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

/**
 * Zonas preferidas (D-421): cuánto cuesta que un chofer con zonas lleve UNA entrega de una zona que prefiere otro, en
 * minutos equivalentes (con `manejo` en 1, lo que ese número de minutos de manejo). No es uno de los cinco pesos de la 130:
 * vive aparte para que un `route_weights` guardado sin él siga leyéndose igual, y un plan sin zonas no lo mira nunca. Lo
 * que vale y por qué, medido con los días reales, en la entrada de DECISIONS.md.
 */
export const PESO_DE_ZONA_POR_DEFECTO = 60;

/**
 * El umbral de la zona, en millas (D-423, T-0413). Una entrega que va con un chofer FUERA de su zona vuelve al chofer
 * de su zona si con él el plan hace menos de estas millas de más —aunque el builder o el balance digan otra cosa— y sin
 * que nadie llegue más tarde ni se rompa nada. Si con el de su zona son estas millas o más, la zona es solo el peso de
 * arriba. Vive en `route_weights.zonaMillas`, junto al peso; 0 lo apaga. Por qué 5, medido, en DECISIONS.md.
 */
export const UMBRAL_DE_ZONA_POR_DEFECTO_MI = 5;

/** Una zona se compara sin mayúsculas ni espacios de más: «McAllen», « mcallen» y «MCALLEN» son la misma. */
export const claveDeZona = (s: string | null | undefined): string => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** Las zonas que prefiere ALGÚN chofer. Una entrega de una ciudad que no está aquí no tiene dueño: va por millas, y nadie
 *  paga por llevarla. */
export function zonasReclamadas(choferes: readonly Pick<ChoferEntrada, "zonas">[]): Set<string> {
  const s = new Set<string>();
  for (const c of choferes) for (const z of c.zonas ?? []) if (claveDeZona(z)) s.add(claveDeZona(z));
  return s;
}

/**
 * Cuántas puntas de esta orden hace este chofer en la zona de OTRO (D-421; la recogida, desde D-427). Una orden tiene
 * dos puntas: la ciudad de la tienda donde se recoge (`zonaRecogida`) y la de la entrega (`zona`). Cada una cuenta si
 * tiene ciudad, esa ciudad la prefiere algún chofer, y no es de este. Cuentan por separado: recoger en la zona de otro y
 * entregar en esa misma zona son dos puntas (0, 1 o 2). Con la recogida ya hecha, solo queda la entrega. Y la recogida
 * solo cuenta si la ciudad de la ENTREGA la prefiere algún chofer: una entrega a una ciudad sin dueño va al más eficiente,
 * como pidió el dueño («esas ciudades … se le da a los conductores que sea mejor opcion y mas eficiente»), aunque salga de
 * la tienda de la zona de alguien. Un chofer sin zonas nunca está «fuera».
 *
 * Por qué la recogida (el dueño, 2026-09-27: «no tiene sentido mandar a julio hasta brownsville si ya te dije que ahi
 * esta maximo»): contando solo la entrega, ir a recoger a la tienda de la zona de otro no costaba nada, y el chofer de
 * esa zona pagaba por la entrega aunque la carga saliera de SU tienda. Contando las dos, una orden que sale de la zona
 * de uno y va a la de otro cuesta una punta con cualquiera de los dos, y decide la eficiencia. Por qué por separado y no
 * una vez por ciudad, medido en DECISIONS.md: una vez por ciudad hacía que a un chofer de fuera le saliera más barata
 * una entrega DENTRO de esa zona que una que sale de ella.
 */
export function puntasFueraDeZona(c: Pick<ChoferEntrada, "zonas">, o: Pick<OrdenEntrada, "zona" | "zonaRecogida" | "recogidaHecha">, reclamadas: ReadonlySet<string>): number {
  if (!c.zonas?.length) return 0;
  let fuera = 0;
  // La recogida solo cuenta si la ENTREGA tiene dueño: una entrega a una ciudad sin dueño va por eficiencia pura (D-421).
  const recogida = o.recogidaHecha || !reclamadas.has(claveDeZona(o.zona)) ? null : o.zonaRecogida;
  for (const punta of [o.zona, recogida]) {
    const z = claveDeZona(punta);
    if (z && reclamadas.has(z) && !c.zonas.some((x) => claveDeZona(x) === z)) fuera++;
  }
  return fuera;
}

/** ¿Hace este chofer alguna punta de esta orden fuera de su zona? (`puntasFueraDeZona` > 0.) */
export function fueraDeSuZona(c: Pick<ChoferEntrada, "zonas">, o: Pick<OrdenEntrada, "zona" | "zonaRecogida" | "recogidaHecha">, reclamadas: ReadonlySet<string>): boolean {
  return puntasFueraDeZona(c, o, reclamadas) > 0;
}

export const PARAMETROS_POR_DEFECTO: Parametros = {
  pesos: PESOS_POR_DEFECTO,
  topeTardeAnchaMin: 60,
  recargaMinimaMin: 20,
  maxMovimientos: 2000,
  // Opciones de reparto (D-415): lo de siempre. Balance por minutos, y un chofer puede quedarse sin nada.
  balancePor: "tiempo",
  usarTodos: false,
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
    + 100 * enMilesimas(pesos.balance) * d.balanceMin
    + 100 * enMilesimas(pesos.zona ?? PESO_DE_ZONA_POR_DEFECTO) * (d.fueraDeZona ?? 0);
}

export function restaDesglose(a: Desglose, b: Desglose): Desglose {
  return {
    builder: a.builder - b.builder,
    manejoMin: a.manejoMin - b.manejoMin,
    millas: deCentesimas(aCentesimas(a.millas) - aCentesimas(b.millas)),
    tardeMin: a.tardeMin - b.tardeMin,
    balanceMin: a.balanceMin - b.balanceMin,
    // Solo si alguno de los dos lo trae: sin zonas, la diferencia es la de antes, sin la clave.
    ...(a.fueraDeZona !== undefined || b.fueraDeZona !== undefined ? { fueraDeZona: (a.fueraDeZona ?? 0) - (b.fueraDeZona ?? 0) } : {}),
    total: a.total - b.total,
  };
}

/** `zonasReclamadas`: las de TODOS los choferes del plan (`zonasReclamadas()`). Sin ella, ninguna entrega está fuera de zona. */
type Contexto = { ordenes: ReadonlyMap<string, OrdenEntrada>; matriz: Matriz; porHora?: TiemposPorHora; parametros: Parametros; fijadas?: ReadonlySet<string>; zonasReclamadas?: ReadonlySet<string> };

/** La media hora en la que cae un minuto del día: 480 (08:00) → 16. */
export const bloqueDe = (minuto: number): number => Math.floor(minuto / MINUTOS_POR_BLOQUE);

const claveDeParada = (p: ParadaRef) => `${p.tipo}:${p.orden}`;

/** Ir de `a` a `b` saliendo en el minuto `salida`. De un sitio a sí mismo, cero. Si hay un tiempo con
 *  tráfico para esa media hora, manda; si no, el de la matriz base. Un tramo que no trae ninguna de las
 *  dos es `null`, no cero. */
function tramo(ctx: Pick<Contexto, "matriz" | "porHora">, a: string, b: string, salida: number): { min: number; centiMi: number } | null {
  if (a === b) return { min: 0, centiMi: 0 };
  const t = ctx.porHora?.[a]?.[b]?.[bloqueDe(salida)] ?? ctx.matriz[a]?.[b];
  if (!t || !Number.isFinite(t.minutos) || !Number.isFinite(t.millas)) return null;
  return { min: Math.round(t.minutos), centiMi: aCentesimas(t.millas) };
}

export function evaluaRuta(chofer: ChoferEntrada, paradas: readonly ParadaRef[], ctx: Contexto): RutaEvaluada {
  const { ordenes, parametros } = ctx;
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
  let manejo = 0, centiMi = 0, tarde = 0, builder = 0, fueraDeZona = 0;
  const conZonas = !!chofer.zonas?.length;
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

    const t = tramo(ctx, sitio, punto, reloj);
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
      if (conZonas && ctx.zonasReclamadas) fueraDeZona += puntasFueraDeZona(chofer, o, ctx.zonasReclamadas);
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
    const t = tramo(ctx, sitio, chofer.base, reloj);
    if (!t) viola("sin_tiempo_de_viaje", undefined, `${sitio} → ${chofer.base}`);
    manejo += t?.min ?? 0;
    centiMi += t?.centiMi ?? 0;
    fin = reloj + (t?.min ?? 0);
  }
  if (fin > chofer.salida) viola("fuera_de_turno", undefined, `${fin - chofer.salida} min`);

  return {
    chofer: chofer.id, paradas: evaluadas, inicio: chofer.entrada, fin,
    duracionMin: evaluadas.length > 0 ? fin - chofer.entrada : 0,
    manejoMin: manejo, millas: deCentesimas(centiMi), tardeMin: tarde, builderMin: builder,
    ...(conZonas ? { fueraDeZona } : {}),
    violaciones,
  };
}

/**
 * Con `balancePor: "ordenes"`, cuánto pesa UNA entrega de diferencia entre dos choferes, en minutos de diferencia.
 * Hace falta un cambio de unidad para que el mismo peso `balance` de Ajustes sirva en los dos modos: sin él, una
 * orden de diferencia pesaría lo que un minuto y repartir por órdenes no repartiría nada. 30 es del orden de lo que
 * dura una entrega con su tramo en un día de la app (servicio de 10-20 min más el manejo hasta ella); es un valor de
 * arranque, y lo que se afina es el peso.
 */
export const MINUTOS_POR_ORDEN_EN_BALANCE = 30;

/** Cuántas entregas hace una ruta. Cada carga de una orden partida cuenta: es un viaje con su entrega. */
const entregasDe = (r: RutaEvaluada): number => r.paradas.filter((p) => p.tipo === "D").length;

/** El coste de un conjunto de rutas ya evaluadas. El balance mira a TODOS los choferes: uno sin paradas
 *  cuenta como cero minutos (o cero entregas), que es justo lo que «repartir» quiere corregir. */
export function costeDeRutas(rutas: readonly RutaEvaluada[], pesos: Pesos, balancePor: BalancePor = "tiempo"): Desglose {
  let builder = 0, manejoMin = 0, centiMi = 0, tardeMin = 0, max = 0, min = Infinity;
  // Las entregas fuera de zona, solo si alguna ruta las cuenta (algún chofer con zonas): sin eso, el desglose de antes.
  let fueraDeZona: number | undefined;
  for (const r of rutas) {
    if (r.fueraDeZona !== undefined) fueraDeZona = (fueraDeZona ?? 0) + r.fueraDeZona;
    builder += r.builderMin; manejoMin += r.manejoMin; centiMi += aCentesimas(r.millas); tardeMin += r.tardeMin;
    const carga = balancePor === "ordenes" ? entregasDe(r) * MINUTOS_POR_ORDEN_EN_BALANCE : r.duracionMin;
    max = Math.max(max, carga); min = Math.min(min, carga);
  }
  const d = { builder, manejoMin, millas: deCentesimas(centiMi), tardeMin, balanceMin: rutas.length > 1 ? max - min : 0, ...(fueraDeZona !== undefined ? { fueraDeZona } : {}) };
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
  porHora?: TiemposPorHora;
  parametros?: Parametros;
  fijadas?: ReadonlySet<string>;
}): PlanEvaluado {
  const parametros = args.parametros ?? PARAMETROS_POR_DEFECTO;
  const ctx: Contexto = { ordenes: new Map(args.ordenes.map((o) => [o.id, o])), matriz: args.matriz, porHora: args.porHora, parametros, fijadas: args.fijadas, zonasReclamadas: zonasReclamadas(args.choferes) };
  const rutas = args.choferes.map((c) => evaluaRuta(c, args.secuencias[c.id] ?? [], ctx));
  return { rutas, coste: costeDeRutas(rutas, parametros.pesos, parametros.balancePor), violaciones: rutas.flatMap((r) => r.violaciones) };
}

export { claveDeParada };
export type { Contexto };
