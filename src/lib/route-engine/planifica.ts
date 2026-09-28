import {
  aCentesimas, claveDeParada, claveDeZona, costeDeRutas, evaluaRuta, fueraDeSuZona, PARAMETROS_POR_DEFECTO, PESO_DE_ZONA_POR_DEFECTO, restaDesglose,
  UMBRAL_DE_ZONA_POR_DEFECTO_MI, zonasReclamadas, type Contexto,
} from "./evalua";
import type {
  Alternativa, ChoferEntrada, Desglose, Entrada, Explicacion, MotivoSinAsignar, OrdenEntrada, ParadaRef, Parametros,
  Plan, RutaEvaluada, SinAsignar, TipoDeViolacion,
} from "./types";

/**
 * Planificar el día: repartir las órdenes entre los choferes y ordenar sus paradas (D-314).
 *
 * Inserción más barata de PARES con arrepentimiento, y después búsqueda local moviendo siempre el par
 * entero. Determinista: sin azar, con los empates resueltos por una clave estable (la que entró primero,
 * va primero) y cortando por número de movimientos, nunca por reloj.
 *
 * Qué compara dos planes, en este orden: (1) menos órdenes fuera, (2) con «usar todos los choferes», menos
 * choferes sin nada, (3) menor coste ponderado, (4) menos minutos de jornada. Lo primero no es un peso: ningún ahorro de minutos justifica
 * dejar una orden sin ruta. QUÉ orden se queda fuera cuando no cabe todo lo deciden la construcción, que coloca
 * por prioridad (crítica, alta, normal, baja) y dentro de cada una a los builders antes que a nadie, y «ceder el
 * sitio» en la mejora. Y dentro de una ruta, a igual coste, las críticas y altas van antes (D-415, como OptimoRoute).
 */

/** `motor-5` (D-NEXT, T-0413): la zona, antes que el builder y el balance — una entrega fuera de su zona vuelve al chofer
 *  de su zona si con él son menos de `zonaMillas` millas de más, nadie llega más tarde y no se rompe nada
 *  (`vuelveASuZona`). Sin zonas, lo mismo que `motor-4`, byte a byte (la misma huella).
 *  `motor-4` (D-421): zonas preferidas por chofer — preferencia, no regla: llevar una entrega de la zona de otro chofer
 *  cuesta el peso `zona`, y nunca deja una orden fuera. Sin zonas, planifica exactamente lo mismo que `motor-3` (y que
 *  `motor-1`: la misma huella). `motor-3` (D-418): requisitos del camión — una orden solo va con un chofer que tenga lo que pide. `motor-2` (D-415):
 *  prioridad por orden y opciones de reparto. Sin requisitos, con todo en normal y las opciones sin tocar, planifica
 *  exactamente lo mismo que `motor-1` — lo fija una prueba con un plan grabado. */
export const VERSION_DEL_MOTOR = "motor-5";

/** El puesto de una prioridad: lo de número más bajo se coloca antes. Sin prioridad, o una que no existe, normal. */
const RANGO: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };
const rangoDe = (o: OrdenEntrada): number => RANGO[o.prioridad ?? "normal"] ?? RANGO.normal;
/** Cuánto empuja cada prioridad a ir antes en su ruta, a igual coste. Normal y baja, nada: su orden es el de siempre. */
const ADELANTO: Record<string, number> = { critical: 2, high: 1 };

/** Requisitos del camión (D-418, OptimoRoute `skills`): lo que pide la orden y el camión de ese chofer no tiene. Vacío =
 *  puede llevarla. Se compara sin mayúsculas ni espacios de más. Una orden que no pide nada va con cualquiera. */
const claveDeRequisito = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const NADA: readonly string[] = [];
export function faltanEnElCamion(c: ChoferEntrada, o: OrdenEntrada): readonly string[] {
  if (!o.requisitos?.length) return NADA;
  const tiene = new Set((c.habilidades ?? []).map(claveDeRequisito));
  return o.requisitos.filter((r) => !tiene.has(claveDeRequisito(r)));
}

/** Compara dos textos; el que falta va DETRÁS. Campo a campo y no pegándolos en una sola clave: pegados,
 *  «sin fecha va detrás» dependía de qué carácter hiciera de separador, y lo cazó un mutante. */
const textoOAlFinal = (a: string | null | undefined, b: string | null | undefined): number =>
  (!a && !b ? 0 : !a ? 1 : !b ? -1 : a < b ? -1 : a > b ? 1 : 0);
/** El desempate estable: fecha y hora de entrada («la que entró primero va primero»), código, id. */
const porClave = (a: OrdenEntrada, b: OrdenEntrada) =>
  textoOAlFinal(a.entrada, b.entrada) || textoOAlFinal(a.codigo, b.codigo) || textoOAlFinal(a.id, b.id);
const porChofer = (a: ChoferEntrada, b: ChoferEntrada) => (a.nombre < b.nombre ? -1 : a.nombre > b.nombre ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const LETRAS = "abcdefghijklmnopqrstuvwxyz";

/**
 * Una orden mayor que el camión se parte en cargas del mismo chofer (a, b…), como las cargas partidas que
 * ya existen en la app. Cada parte llena un camión salvo la última, que lleva el resto. Los minutos de
 * servicio se reparten en proporción a los pallets.
 */
export function parteOrdenesGrandes(ordenes: readonly OrdenEntrada[], choferes: readonly ChoferEntrada[]): { ordenes: OrdenEntrada[]; partes: Record<string, string[]>; grupoDe: Map<string, string> } {
  const salida: OrdenEntrada[] = [];
  const partes: Record<string, string[]> = {};
  const grupoDe = new Map<string, string>();
  for (const o of ordenes) {
    // Con requisitos, el tope es el camión MÁS GRANDE DE LOS QUE LO TIENEN: partir por uno que no puede llevarla dejaría
    // cargas que no caben en ninguno de los que sí.
    const posibles = o.choferFijado ? choferes.filter((c) => c.id === o.choferFijado) : choferes.filter((c) => !faltanEnElCamion(c, o).length);
    const tope = Math.max(0, ...posibles.map((c) => aCentesimas(c.capacidad)));
    const total = aCentesimas(o.pallets);
    // Lo ya recogido va entero en un camión: partirlo ahora sería negar lo que ya pasó.
    if (o.recogidaHecha || tope <= 0 || total <= tope) { salida.push(o); continue; }
    const n = Math.ceil(total / tope);
    partes[o.id] = [];
    for (let k = 0; k < n; k++) {
      const trozo = k < n - 1 ? tope : total - tope * (n - 1);
      const id = `${o.id}#${k < LETRAS.length ? LETRAS[k] : k + 1}`;
      partes[o.id].push(id);
      grupoDe.set(id, o.id);
      salida.push({
        ...o, id, pallets: trozo / 100,
        servicioRecogidaMin: Math.round((o.servicioRecogidaMin * trozo) / total),
        servicioEntregaMin: Math.round((o.servicioEntregaMin * trozo) / total),
      });
    }
  }
  return { ordenes: salida, partes, grupoDe };
}

type Estado = { secuencias: Map<string, ParadaRef[]>; rutas: Map<string, RutaEvaluada> };

/** Qué se compara, en orden: órdenes fuera, choferes sin nada (solo con «usar todos»; si no, cero),
 *  coste y, a igual coste, minutos de jornada. Menor es mejor.
 *  «Los builders, los últimos en quedarse fuera» no está aquí sino en la construcción, que los coloca
 *  primero: ningún movimiento de la mejora cambia un builder por un mostrador, así que un criterio para
 *  eso nunca decidiría nada (lo dijo un mutante que sobrevivía). */
type Nota = [number, number, number, number];
const mejorQue = (a: Nota, b: Nota) => { for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] < b[k]; return false; };

/**
 * Con «usar todos los choferes», se planifica con la opción y sin ella, y se queda la de menos órdenes fuera; a
 * igualdad, la de la opción. Así la opción **nunca** deja fuera una orden que sin ella tenía ruta: mover trabajo a un
 * chofer vacío cambia lo que la mejora prueba después, y a veces cierra un hueco que otra orden necesitaba (una
 * búsqueda sobre 3.000 días inventados encontró al menos 10 así; es el día 1794 de las pruebas). Cuesta planificar dos
 * veces, solo con la opción puesta.
 */
export function planifica(entrada: Entrada, parametros: Parametros = PARAMETROS_POR_DEFECTO): Plan {
  const plan = planificaConOpciones(entrada, parametros);
  // Zonas preferidas (D-421): «Preferencia, no regla», dijo el dueño. El peso ya hace que una entrega vaya a otro chofer
  // cuando el suyo no puede; pero repartir por zonas cambia lo que la construcción coloca primero y lo que la mejora prueba
  // después, y eso podría cerrar un hueco que otra orden necesitaba (como con «usar todos», arriba). Así que, con zonas, se
  // planifica también sin ellas y se queda la de menos órdenes fuera; a igualdad, la de las zonas. Nunca queda una orden
  // fuera por la zona. Sin zonas —ningún chofer las tiene, o ninguna entrega es de una—, una sola vez: el plan de siempre.
  // Si con zonas no queda nada fuera, sin ellas no puede quedar menos: no hace falta la segunda vuelta.
  if (!plan.sinAsignar.length || !zonasQueDeciden(entrada, parametros)) return plan;
  const sinZonas = planificaConOpciones(entrada, { ...parametros, pesos: { ...parametros.pesos, zona: 0 } });
  return sinZonas.sinAsignar.length < plan.sinAsignar.length ? sinZonas : plan;
}

/** ¿Deciden algo las zonas en este día? Hace falta un peso, algún chofer con zonas y alguna entrega de una de ellas. */
function zonasQueDeciden(entrada: Entrada, parametros: Parametros): boolean {
  if ((parametros.pesos.zona ?? PESO_DE_ZONA_POR_DEFECTO) <= 0) return false;
  const reclamadas = zonasReclamadas(entrada.choferes);
  return reclamadas.size > 0 && entrada.ordenes.some((o) => reclamadas.has(claveDeZona(o.zona)));
}

function planificaConOpciones(entrada: Entrada, parametros: Parametros): Plan {
  if (!parametros.usarTodos) return planificaUnaVez(entrada, parametros);
  const con = planificaUnaVez(entrada, parametros);
  const sin = planificaUnaVez(entrada, { ...parametros, usarTodos: false });
  return sin.sinAsignar.length < con.sinAsignar.length ? sin : con;
}

function planificaUnaVez(entrada: Entrada, parametros: Parametros): Plan {
  const choferes = [...entrada.choferes].sort(porChofer);
  const partido = parteOrdenesGrandes([...entrada.ordenes].sort(porClave), choferes);
  const ordenes = partido.ordenes;
  const porId = new Map(ordenes.map((o) => [o.id, o]));
  const idsDeChofer = new Set(choferes.map((c) => c.id));

  const fijadas = new Set<string>();
  const ordenesFijadas = new Set<string>();
  const estado: Estado = { secuencias: new Map(), rutas: new Map() };
  for (const c of choferes) {
    const fija = (entrada.secuenciaFijada?.[c.id] ?? []).filter((p) => porId.has(p.orden));
    for (const p of fija) { fijadas.add(claveDeParada(p)); ordenesFijadas.add(p.orden); }
    estado.secuencias.set(c.id, [...fija]);
  }
  const ctx: Contexto = { ordenes: porId, matriz: entrada.matriz, porHora: entrada.porHora, parametros, fijadas, zonasReclamadas: zonasReclamadas(choferes) };
  for (const c of choferes) estado.rutas.set(c.id, evaluaRuta(c, estado.secuencias.get(c.id)!, ctx));

  // Un solo sitio que pone pesos y modo de balance: el coste del plan y el de probar un hueco no pueden medir distinto.
  const costeDe = (rutas: readonly RutaEvaluada[]): Desglose => costeDeRutas(rutas, parametros.pesos, parametros.balancePor);
  const coste = (rutas: ReadonlyMap<string, RutaEvaluada>): Desglose => costeDe(choferes.map((c) => rutas.get(c.id)!));
  const costeCon = (chofer: string, ruta: RutaEvaluada): Desglose =>
    costeDe(choferes.map((c) => (c.id === chofer ? ruta : estado.rutas.get(c.id)!)));

  /** Lo que mide «las críticas y altas, antes»: su hora de entrega, pesada por su prioridad. Menor es mejor. Con
   *  todo en normal vale cero, y entonces no decide nada. No es un término del coste: solo desempata. */
  const adelanto = (ruta: RutaEvaluada): number => {
    let s = 0;
    for (const p of ruta.paradas) if (p.tipo === "D") s += (ADELANTO[porId.get(p.orden)?.prioridad ?? ""] ?? 0) * p.inicioServicio;
    return s;
  };

  const choferDe = (id: string): string | null => {
    for (const [c, sec] of estado.secuencias) if (sec.some((p) => p.orden === id)) return c;
    return null;
  };

  /** Con qué choferes puede ir una orden: el que fijó una persona, o el de sus hermanas si es una parte. */
  const permitidos = (o: OrdenEntrada): ChoferEntrada[] => {
    if (o.choferFijado) return choferes.filter((c) => c.id === o.choferFijado);
    const grupo = partido.grupoDe.get(o.id);
    if (grupo) {
      for (const hermana of partido.partes[grupo]) {
        if (hermana === o.id) continue;
        const c = choferDe(hermana);
        if (c) return choferes.filter((x) => x.id === c);
      }
    }
    // Requisitos del camión (D-418): solo los que lo tienen todo. El chofer que fijó una persona (arriba) se respeta
    // aunque no lo tenga: el motor no deshace lo que decidió alguien.
    if (!o.requisitos?.length) return choferes;
    return choferes.filter((c) => !faltanEnElCamion(c, o).length);
  };

  type Hueco = { chofer: string; secuencia: ParadaRef[]; ruta: RutaEvaluada; coste: Desglose; adelanto: number };

  /** El mejor sitio para una orden en la ruta de un chofer: todas las posiciones de su P y de su D. */
  const mejorHuecoEn = (o: OrdenEntrada, c: ChoferEntrada, base: readonly ParadaRef[], rechazo?: { tipo?: TipoDeViolacion; n: number }): Hueco | null => {
    const toleradas = evaluaRuta(c, base, ctx).violaciones.length;
    let mejor: Hueco | null = null;
    const prueba = (secuencia: ParadaRef[]) => {
      const ruta = evaluaRuta(c, secuencia, ctx);
      if (ruta.violaciones.length > toleradas) {
        if (rechazo && ruta.violaciones.length - toleradas < rechazo.n) { rechazo.n = ruta.violaciones.length - toleradas; rechazo.tipo = ruta.violaciones[ruta.violaciones.length - 1].tipo; }
        return;
      }
      const total = costeCon(c.id, ruta);
      // A igual coste, las críticas y altas antes (D-415); luego gana la ruta que acaba antes (cargar dos órdenes
      // en la misma visita a la tienda no cambia el manejo, pero sí el día). Y si aun así empatan, se queda la
      // primera que se probó. Una ventana nunca se rompe por esto: una secuencia que la rompe ni llega aquí.
      const a = adelanto(ruta);
      if (!mejor || total.total < mejor.coste.total
        || (total.total === mejor.coste.total && (a < mejor.adelanto || (a === mejor.adelanto && ruta.fin < mejor.ruta.fin)))) {
        mejor = { chofer: c.id, secuencia, ruta, coste: total, adelanto: a };
      }
    };
    // Se prueba DE ATRÁS HACIA DELANTE: así, entre huecos que empatan en todo, gana el más tardío, y una
    // orden nueva no adelanta a las que ya estaban. Como se insertan por orden de entrada, «la que entró
    // primero va primero» sale de aquí.
    const n = base.length;
    if (o.recogidaHecha) {
      for (let j = n; j >= 0; j--) prueba([...base.slice(0, j), { orden: o.id, tipo: "D" }, ...base.slice(j)]);
    } else {
      for (let i = n; i >= 0; i--) {
        for (let j = n; j >= i; j--) {
          prueba([...base.slice(0, i), { orden: o.id, tipo: "P" }, ...base.slice(i, j), { orden: o.id, tipo: "D" }, ...base.slice(j)]);
        }
      }
    }
    return mejor;
  };

  const aplica = (h: Hueco) => { estado.secuencias.set(h.chofer, h.secuencia); estado.rutas.set(h.chofer, h.ruta); };
  const quita = (id: string, c: string) => {
    const sec = estado.secuencias.get(c)!.filter((p) => p.orden !== id);
    estado.secuencias.set(c, sec);
    estado.rutas.set(c, evaluaRuta(choferes.find((x) => x.id === c)!, sec, ctx));
  };

  // ---- Lo que no se puede ni intentar -------------------------------------------------------------
  const descartadas = new Map<string, MotivoSinAsignar>();
  /** Con `falta_requisito`: lo que le falta al chofer que menos le falta (el primero por nombre, a igualdad). */
  const faltanDe = new Map<string, readonly string[]>();
  const loQueMenosFalta = (o: OrdenEntrada): readonly string[] =>
    choferes.map((c) => faltanEnElCamion(c, o)).reduce((a, b) => (b.length < a.length ? b : a));
  const pendientes: OrdenEntrada[] = [];
  for (const o of ordenes) {
    if (ordenesFijadas.has(o.id)) continue;
    if (choferes.length === 0) descartadas.set(o.id, "sin_chofer_disponible");
    else if (o.choferFijado && !idsDeChofer.has(o.choferFijado)) descartadas.set(o.id, "chofer_fijado_sin_hueco");
    else if (o.recogidaHecha && !o.choferFijado) descartadas.set(o.id, "chofer_fijado_sin_hueco");
    else if (!permitidos(o).length) { descartadas.set(o.id, "falta_requisito"); faltanDe.set(o.id, loQueMenosFalta(o)); }
    else pendientes.push(o);
  }

  // ---- Construcción: primero la que más perdería si espera ---------------------------------------
  const GRANDE = Number.MAX_SAFE_INTEGER;
  /** De los mejores huecos de cada chofer (ya ordenados por coste), el que usa la MEJORA al recolocar. Con «usar
   *  todos los choferes», el más barato de los choferes que aún no llevan nada, si alguno puede; si no, el más
   *  barato. La construcción no lo usa: construye como siempre, y así reparte lo mismo que sin la opción; la
   *  mejora solo mueve a un chofer vacío lo que no deja nada fuera (la nota compara primero lo que queda fuera). */
  const vacio = (chofer: string) => estado.secuencias.get(chofer)!.length === 0;
  const eligeHueco = (huecos: readonly Hueco[]): Hueco =>
    (parametros.usarTodos ? huecos.find((h) => vacio(h.chofer)) : undefined) ?? huecos[0];

  const coloca = (candidatas: OrdenEntrada[]): OrdenEntrada[] => {
    let quedan = [...candidatas];
    for (;;) {
      let elegida: { o: OrdenEntrada; hueco: Hueco; arrepentimiento: number } | null = null;
      for (const o of quedan) {
        const huecos = permitidos(o).map((c) => mejorHuecoEn(o, c, estado.secuencias.get(c.id)!)).filter((h): h is Hueco => !!h)
          .sort((a, b) => a.coste.total - b.coste.total);
        if (!huecos.length) continue;
        const arrepentimiento = huecos.length > 1 ? huecos[1].coste.total - huecos[0].coste.total : GRANDE;
        // Primero la de más prioridad: coge sitio antes, así que si no cabe todo, lo que queda fuera es lo de menos.
        // Dentro de la misma prioridad, el builder; y entre iguales, la que más perdería si espera.
        const gana = !elegida
          || (rangoDe(o) !== rangoDe(elegida.o) ? rangoDe(o) < rangoDe(elegida.o)
            : !!o.builder !== !!elegida.o.builder ? !!o.builder : arrepentimiento > elegida.arrepentimiento);
        if (gana) elegida = { o, hueco: huecos[0], arrepentimiento };
      }
      if (!elegida) return quedan;
      aplica(elegida.hueco);
      quedan = quedan.filter((x) => x.id !== elegida!.o.id);
    }
  };
  let fuera = coloca(pendientes);

  /**
   * La zona, antes que el builder y el balance (D-NEXT, T-0413). El dueño, 2026-09-27: «maximo siempre tiene prioridad en
   * brownsville y nunca mandes a otro conductor por una ruta que sea inefeciente». Con el peso solo, un builder que llega
   * 37 min antes (×2) y el balance le ganaban a la zona aunque el chofer de la zona hiciera la entrega con +0 millas
   * (#135 del 2026-09-07, medido): ningún peso lo arregla sin volver la zona una regla también cuando es ineficiente.
   *
   * Así que, ya mejorado el plan, cada entrega que va FUERA de su zona se prueba con los choferes de su zona (su mejor
   * hueco, sin violaciones nuevas): si con alguno el plan entero hace MENOS de `zonaMillas` millas de más y no suma ni un
   * minuto tarde, va con él —con el más barato de esos, por el coste de siempre—, digan lo que digan el builder y el
   * balance. Si con todos son `zonaMillas` o más, se queda donde la dejó el coste: ahí la zona es solo su peso, y manda
   * la eficiencia. Nunca deja una orden fuera (solo mueve lo que ya tiene ruta) ni deja vacío a un chofer con «usar
   * todos». Termina: cada cambio baja en uno las entregas fuera de zona, y ninguno sube otra.
   *
   * Va DESPUÉS de la mejora y no dentro de su comparación a propósito: dentro, «menos de N millas de más» no es un orden
   * entre planes (A gana a B por zona, B a C por coste, C a A por millas) y la búsqueda podría dar vueltas.
   */
  function vuelveASuZona(): number {
    const umbral = parametros.pesos.zonaMillas ?? UMBRAL_DE_ZONA_POR_DEFECTO_MI;
    const reclamadas = ctx.zonasReclamadas!;
    if (!(umbral > 0) || (parametros.pesos.zona ?? PESO_DE_ZONA_POR_DEFECTO) <= 0) return 0;
    const tope = Math.round(umbral * 100);
    let vueltas = 0;
    for (const o of movibles()) {
      if (movimientos >= parametros.maxMovimientos) { convergio = false; return vueltas; }
      const c = choferDe(o.id)!;
      if (!fueraDeSuZona(choferes.find((x) => x.id === c)!, o, reclamadas)) continue;
      const suyos = permitidos(o).filter((x) => x.id !== c && x.zonas?.some((z) => claveDeZona(z) === claveDeZona(o.zona)));
      if (!suyos.length) continue;
      if (parametros.usarTodos && estado.secuencias.get(c)!.every((p) => p.orden === o.id)) continue;
      const antes = copia(), costeAntes = coste(estado.rutas);
      quita(o.id, c);
      const huecos = suyos.map((x) => mejorHuecoEn(o, x, estado.secuencias.get(x.id)!)).filter((h): h is Hueco => !!h)
        .filter((h) => aCentesimas(h.coste.millas) - aCentesimas(costeAntes.millas) < tope && h.coste.tardeMin <= costeAntes.tardeMin)
        .sort((a, b) => a.coste.total - b.coste.total);
      if (!huecos.length) { restaura(antes); continue; }
      aplica(huecos[0]);
      movimientos++; vueltas++;
    }
    return vueltas;
  }

  // ---- Mejora: mover el par entero ----------------------------------------------------------------
  const nota = (): Nota => [
    fuera.length,
    parametros.usarTodos ? choferes.filter((c) => vacio(c.id)).length : 0,
    coste(estado.rutas).total,
    // «Las críticas antes» NO está aquí: lo decide el hueco al insertar (`mejorHuecoEn`), y la mejora mete cada orden
    // en su mejor hueco. Estuvo, y un mutante que lo quitaba sobrevivía: no decidía nada.
    choferes.reduce((s, c) => s + estado.rutas.get(c.id)!.duracionMin, 0),
  ];
  const movibles = () => ordenes.filter((o) => !ordenesFijadas.has(o.id) && choferDe(o.id) !== null);
  let movimientos = 0;
  let convergio = true;

  const copia = (): Estado => ({ secuencias: new Map(estado.secuencias), rutas: new Map(estado.rutas) });
  const restaura = (e: Estado) => { estado.secuencias = e.secuencias; estado.rutas = e.rutas; };

  /** Las entregas fuera de zona del plan de ahora. Sin zonas, siempre 0. */
  const fueraDeZonaAhora = (): number => coste(estado.rutas).fueraDeZona ?? 0;

  /** La búsqueda local. Con `protegeZona` (la vuelta de después de `vuelveASuZona`), recolocar e intercambiar no aceptan
   *  un cambio que suba las entregas fuera de zona: la mejora sigue afinando el plan, pero no deshace lo que la zona ganó.
   *  Lo que queda fuera sí puede entrar fuera de zona: nunca queda una orden sin ruta por la zona. */
  const mejoraElPlan = (protegeZona: boolean) => {
    for (let mejoro = true; mejoro; ) {
      mejoro = false;

      // Recolocar: sacar una orden y volver a meterla donde mejor quede, en su ruta o en otra.
      for (const o of movibles()) {
        if (!convergio) break;
        const antes = copia(), notaAntes = nota(), zonaAntes = protegeZona ? fueraDeZonaAhora() : 0;
        quita(o.id, choferDe(o.id)!);
        const huecos = permitidos(o).map((c) => mejorHuecoEn(o, c, estado.secuencias.get(c.id)!)).filter((h): h is Hueco => !!h)
          .sort((a, b) => a.coste.total - b.coste.total);
        if (huecos.length) aplica(eligeHueco(huecos));
        const mejora = huecos.length > 0 && mejorQue(nota(), notaAntes) && (!protegeZona || fueraDeZonaAhora() <= zonaAntes);
        if (mejora && movimientos < parametros.maxMovimientos) { movimientos++; mejoro = true; }
        else { restaura(antes); if (mejora) convergio = false; }
      }

      // Intercambiar dos órdenes entre dos choferes. Las partes de una orden partida no entran: van juntas.
      const lista = movibles().filter((o) => !o.choferFijado && !partido.grupoDe.has(o.id) && !o.recogidaHecha);
      for (let a = 0; a < lista.length && convergio; a++) {
        for (let b = a + 1; b < lista.length && convergio; b++) {
          const ca = choferDe(lista[a].id), cb = choferDe(lista[b].id);
          if (!ca || !cb || ca === cb) continue;
          // Requisitos del camión (D-418): el intercambio mete cada una en el camión de la otra sin pasar por `permitidos`;
          // si alguno de los dos no tiene lo que pide la que le llega, no se intenta. Lo cazó la prueba de los 300 días.
          if (faltanEnElCamion(choferes.find((c) => c.id === cb)!, lista[a]).length || faltanEnElCamion(choferes.find((c) => c.id === ca)!, lista[b]).length) continue;
          const antes = copia(), notaAntes = nota(), zonaAntes = protegeZona ? fueraDeZonaAhora() : 0;
          quita(lista[a].id, ca); quita(lista[b].id, cb);
          const ha = mejorHuecoEn(lista[a], choferes.find((c) => c.id === cb)!, estado.secuencias.get(cb)!);
          if (ha) aplica(ha);
          const hb = ha ? mejorHuecoEn(lista[b], choferes.find((c) => c.id === ca)!, estado.secuencias.get(ca)!) : null;
          if (hb) aplica(hb);
          const mejora = !!ha && !!hb && mejorQue(nota(), notaAntes) && (!protegeZona || fueraDeZonaAhora() <= zonaAntes);
          if (mejora && movimientos < parametros.maxMovimientos) { movimientos++; mejoro = true; }
          else { restaura(antes); if (mejora) convergio = false; }
        }
      }

      // Y lo que quedó fuera se vuelve a intentar: un hueco puede haberse abierto al mover lo demás.
      if (fuera.length) {
        const antes = fuera.length;
        fuera = coloca(fuera);
        if (fuera.length < antes) { movimientos++; mejoro = true; }
      }

      // Ceder el sitio (D-415, como OptimoRoute): una de fuera entra quitando una de MENOS prioridad, que pasa a fuera
      // (y la vuelta siguiente la reintenta en otro sitio). La construcción ya coloca primero lo de más prioridad, pero
      // la mejora reordena las rutas y puede abrir un hueco que ya ocupó una de menos: una búsqueda sobre 400 días
      // inventados encontró 2 así. Con todo en normal nunca hay una de menos prioridad, y esto no hace nada.
      for (const o of [...fuera].sort((a, b) => rangoDe(a) - rangoDe(b))) {
        if (!convergio) break;
        // Cede la de menos prioridad y, entre iguales, la que entró la última. Sin excepciones, a propósito: una orden a
        // la que una persona le puso chofer puede ceder (se respeta su chofer, no que vaya hoy), y una carga de una orden
        // partida también, como ya puede quedarse fuera una carga sola cuando no cabe (motor-1 lo hacía). Se buscó: en
        // 1.500 días inventados, excluir las de chofer puesto no cambió ningún plan.
        const candidatas = movibles().filter((q) => rangoDe(q) > rangoDe(o))
          .sort((a, b) => rangoDe(b) - rangoDe(a) || porClave(b, a));
        // Si entra, el cambio siempre es a mejor: sale de fuera una de más prioridad y entra una de menos. No hace falta
        // comparar notas (se comparaba, y un mutante que no lo hacía sobrevivía), y no puede dar vueltas: cada cambio
        // baja lo de fuera en ese orden, que no puede bajar sin fin.
        for (const q of candidatas) {
          const antes = copia();
          quita(q.id, choferDe(q.id)!);
          const huecos = permitidos(o).map((c) => mejorHuecoEn(o, c, estado.secuencias.get(c.id)!)).filter((h): h is Hueco => !!h)
            .sort((a, b) => a.coste.total - b.coste.total);
          if (!huecos.length) { restaura(antes); continue; }
          if (movimientos >= parametros.maxMovimientos) { restaura(antes); convergio = false; break; }
          aplica(huecos[0]);
          fuera = [...fuera.filter((x) => x.id !== o.id), q];
          movimientos++; mejoro = true;
          break;
        }
      }
      if (!convergio) break;
    }
  };

  mejoraElPlan(false);
  // La zona, antes que el builder y el balance (D-NEXT): lo que vuelve a su zona, y otra vuelta de mejora que ya no puede
  // sacarlo. Cada vuelta baja las entregas fuera de zona: se acaba.
  while (convergio && vuelveASuZona() > 0) mejoraElPlan(true);

  // ---- Por qué quedó fuera cada una ---------------------------------------------------------------
  const ORDEN_DE_MOTIVOS: TipoDeViolacion[] = ["capacidad", "ventana_estrecha", "retraso_sobre_el_tope", "fuera_de_turno", "sin_tiempo_de_viaje"];
  const A_MOTIVO: Partial<Record<TipoDeViolacion, MotivoSinAsignar>> = {
    capacidad: "supera_capacidad", ventana_estrecha: "ventana_imposible", retraso_sobre_el_tope: "retraso_sobre_el_tope",
    fuera_de_turno: "fuera_de_turno", sin_tiempo_de_viaje: "sin_punto",
  };
  const motivoDe = (o: OrdenEntrada): MotivoSinAsignar => {
    // Sola, en una ruta vacía: si ni así cabe, el problema es suyo; si cabe, es que no queda sitio.
    const sola: ParadaRef[] = o.recogidaHecha ? [{ orden: o.id, tipo: "D" }] : [{ orden: o.id, tipo: "P" }, { orden: o.id, tipo: "D" }];
    const cuenta = new Map<TipoDeViolacion, number>();
    for (const c of permitidos(o)) {
      const v = evaluaRuta(c, sola, ctx).violaciones;
      if (!v.length) return o.choferFijado ? "chofer_fijado_sin_hueco" : "no_cabe_con_el_resto";
      for (const t of new Set(v.map((x) => x.tipo))) cuenta.set(t, (cuenta.get(t) ?? 0) + 1);
    }
    const tipo = [...ORDEN_DE_MOTIVOS].sort((a, b) => (cuenta.get(b) ?? 0) - (cuenta.get(a) ?? 0))[0];
    return (cuenta.get(tipo) ? A_MOTIVO[tipo] : undefined) ?? (o.choferFijado ? "chofer_fijado_sin_hueco" : "no_cabe_con_el_resto");
  };
  const sinAsignar: SinAsignar[] = [
    ...[...descartadas].map(([orden, motivo]) => ({ orden, motivo, ...(faltanDe.has(orden) ? { faltan: [...faltanDe.get(orden)!] } : {}) })),
    ...fuera.map((o) => ({ orden: o.id, motivo: motivoDe(o) })),
  ].sort((a, b) => porClave(porId.get(a.orden)!, porId.get(b.orden)!));

  // ---- Por qué va cada una con quien va -----------------------------------------------------------
  const final = coste(estado.rutas);
  const explicaciones: Explicacion[] = [];
  for (const o of ordenes) {
    const c = choferDe(o.id);
    if (!c) continue;
    const antes = copia();
    quita(o.id, c);
    const sinElla = coste(estado.rutas);
    const mias = new Set(permitidos(o).map((x) => x.id));
    const alternativas: Alternativa[] = [];
    for (const otro of choferes) {
      if (otro.id === c) continue;
      // Si con ese no puede porque su camión no tiene lo que pide (D-418), se dice eso, y qué le falta. Un chofer fijado
      // por una persona, o una parte que va con sus hermanas, siguen siendo «no permitido».
      const noTiene = o.choferFijado ? NADA : faltanEnElCamion(otro, o);
      if (ordenesFijadas.has(o.id) || (!mias.has(otro.id) && !noTiene.length)) { alternativas.push({ chofer: otro.id, diferencia: null, motivo: "no_permitido" }); continue; }
      if (noTiene.length) { alternativas.push({ chofer: otro.id, diferencia: null, motivo: "falta_requisito", faltan: [...noTiene] }); continue; }
      const rechazo: { tipo?: TipoDeViolacion; n: number } = { n: Infinity };
      const h = mejorHuecoEn(o, otro, estado.secuencias.get(otro.id)!, rechazo);
      alternativas.push(h ? { chofer: otro.id, diferencia: restaDesglose(h.coste, final) } : { chofer: otro.id, diferencia: null, motivo: rechazo.tipo });
    }
    restaura(antes);
    explicaciones.push({ orden: o.id, chofer: c, aporta: restaDesglose(final, sinElla), alternativas });
  }

  const rutas = choferes.map((c) => estado.rutas.get(c.id)!);
  return {
    rutas, coste: final, violaciones: rutas.flatMap((r) => r.violaciones), sinAsignar, explicaciones,
    partes: partido.partes, movimientos, convergio, version: VERSION_DEL_MOTOR,
  };
}
