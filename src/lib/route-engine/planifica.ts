import {
  aCentesimas, claveDeParada, costeDeRutas, evaluaRuta, PARAMETROS_POR_DEFECTO, restaDesglose, type Contexto,
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
 * Qué compara dos planes, en este orden: (1) menos órdenes fuera, (2) menor coste ponderado. Lo primero no
 * es un peso: ningún ahorro de minutos justifica dejar una orden sin ruta. Y un builder es el último
 * candidato a quedarse fuera porque la construcción coloca a los builders antes que a nadie.
 */

export const VERSION_DEL_MOTOR = "motor-1";

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
    const posibles = o.choferFijado ? choferes.filter((c) => c.id === o.choferFijado) : choferes;
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

/** Qué se compara, en orden: órdenes fuera, coste y, a igual coste, minutos de jornada. Menor es mejor.
 *  «Los builders, los últimos en quedarse fuera» no está aquí sino en la construcción, que los coloca
 *  primero: ningún movimiento de la mejora cambia un builder por un mostrador, así que un criterio para
 *  eso nunca decidiría nada (lo dijo un mutante que sobrevivía). */
type Nota = [number, number, number];
const mejorQue = (a: Nota, b: Nota) => { for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] < b[k]; return false; };

export function planifica(entrada: Entrada, parametros: Parametros = PARAMETROS_POR_DEFECTO): Plan {
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
  const ctx: Contexto = { ordenes: porId, matriz: entrada.matriz, porHora: entrada.porHora, parametros, fijadas };
  for (const c of choferes) estado.rutas.set(c.id, evaluaRuta(c, estado.secuencias.get(c.id)!, ctx));

  const coste = (rutas: ReadonlyMap<string, RutaEvaluada>): Desglose => costeDeRutas(choferes.map((c) => rutas.get(c.id)!), parametros.pesos);
  const costeCon = (chofer: string, ruta: RutaEvaluada): Desglose =>
    costeDeRutas(choferes.map((c) => (c.id === chofer ? ruta : estado.rutas.get(c.id)!)), parametros.pesos);

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
    return choferes;
  };

  type Hueco = { chofer: string; secuencia: ParadaRef[]; ruta: RutaEvaluada; coste: Desglose };

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
      // A igual coste gana la ruta que acaba antes (cargar dos órdenes en la misma visita a la tienda no
      // cambia el manejo, pero sí el día). Y si aun así empatan, se queda la primera que se probó.
      if (!mejor || total.total < mejor.coste.total || (total.total === mejor.coste.total && ruta.fin < mejor.ruta.fin)) {
        mejor = { chofer: c.id, secuencia, ruta, coste: total };
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
  const pendientes: OrdenEntrada[] = [];
  for (const o of ordenes) {
    if (ordenesFijadas.has(o.id)) continue;
    if (choferes.length === 0) descartadas.set(o.id, "sin_chofer_disponible");
    else if (o.choferFijado && !idsDeChofer.has(o.choferFijado)) descartadas.set(o.id, "chofer_fijado_sin_hueco");
    else if (o.recogidaHecha && !o.choferFijado) descartadas.set(o.id, "chofer_fijado_sin_hueco");
    else pendientes.push(o);
  }

  // ---- Construcción: primero la que más perdería si espera ---------------------------------------
  const GRANDE = Number.MAX_SAFE_INTEGER;
  const coloca = (candidatas: OrdenEntrada[]): OrdenEntrada[] => {
    let quedan = [...candidatas];
    for (;;) {
      let elegida: { o: OrdenEntrada; hueco: Hueco; arrepentimiento: number } | null = null;
      for (const o of quedan) {
        const huecos = permitidos(o).map((c) => mejorHuecoEn(o, c, estado.secuencias.get(c.id)!)).filter((h): h is Hueco => !!h)
          .sort((a, b) => a.coste.total - b.coste.total);
        if (!huecos.length) continue;
        const arrepentimiento = huecos.length > 1 ? huecos[1].coste.total - huecos[0].coste.total : GRANDE;
        const gana = !elegida
          || (!!o.builder !== !!elegida.o.builder ? !!o.builder : arrepentimiento > elegida.arrepentimiento);
        if (gana) elegida = { o, hueco: huecos[0], arrepentimiento };
      }
      if (!elegida) return quedan;
      aplica(elegida.hueco);
      quedan = quedan.filter((x) => x.id !== elegida!.o.id);
    }
  };
  let fuera = coloca(pendientes);

  // ---- Mejora: mover el par entero ----------------------------------------------------------------
  const nota = (): Nota => [
    fuera.length, coste(estado.rutas).total,
    choferes.reduce((s, c) => s + estado.rutas.get(c.id)!.duracionMin, 0),
  ];
  const movibles = () => ordenes.filter((o) => !ordenesFijadas.has(o.id) && choferDe(o.id) !== null);
  let movimientos = 0;
  let convergio = true;

  const copia = (): Estado => ({ secuencias: new Map(estado.secuencias), rutas: new Map(estado.rutas) });
  const restaura = (e: Estado) => { estado.secuencias = e.secuencias; estado.rutas = e.rutas; };

  for (let mejoro = true; mejoro; ) {
    mejoro = false;

    // Recolocar: sacar una orden y volver a meterla donde mejor quede, en su ruta o en otra.
    for (const o of movibles()) {
      if (!convergio) break;
      const antes = copia(), notaAntes = nota();
      quita(o.id, choferDe(o.id)!);
      const huecos = permitidos(o).map((c) => mejorHuecoEn(o, c, estado.secuencias.get(c.id)!)).filter((h): h is Hueco => !!h)
        .sort((a, b) => a.coste.total - b.coste.total);
      if (huecos.length) aplica(huecos[0]);
      const mejora = huecos.length > 0 && mejorQue(nota(), notaAntes);
      if (mejora && movimientos < parametros.maxMovimientos) { movimientos++; mejoro = true; }
      else { restaura(antes); if (mejora) convergio = false; }
    }

    // Intercambiar dos órdenes entre dos choferes. Las partes de una orden partida no entran: van juntas.
    const lista = movibles().filter((o) => !o.choferFijado && !partido.grupoDe.has(o.id) && !o.recogidaHecha);
    for (let a = 0; a < lista.length && convergio; a++) {
      for (let b = a + 1; b < lista.length && convergio; b++) {
        const ca = choferDe(lista[a].id), cb = choferDe(lista[b].id);
        if (!ca || !cb || ca === cb) continue;
        const antes = copia(), notaAntes = nota();
        quita(lista[a].id, ca); quita(lista[b].id, cb);
        const ha = mejorHuecoEn(lista[a], choferes.find((c) => c.id === cb)!, estado.secuencias.get(cb)!);
        if (ha) aplica(ha);
        const hb = ha ? mejorHuecoEn(lista[b], choferes.find((c) => c.id === ca)!, estado.secuencias.get(ca)!) : null;
        if (hb) aplica(hb);
        const mejora = !!ha && !!hb && mejorQue(nota(), notaAntes);
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
    if (!convergio) break;
  }

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
    ...[...descartadas].map(([orden, motivo]) => ({ orden, motivo })),
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
      if (!mias.has(otro.id) || ordenesFijadas.has(o.id)) { alternativas.push({ chofer: otro.id, diferencia: null, motivo: "no_permitido" }); continue; }
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
