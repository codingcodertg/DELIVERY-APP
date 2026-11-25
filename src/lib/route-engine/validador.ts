import type { ChoferEntrada, OrdenEntrada, ParadaRef, Punto } from "./types";
import { aCentesimas } from "./evalua";

/**
 * El validador de una ruta: dado UN chofer y su secuencia de paradas, devuelve TODAS las reglas duras que
 * la secuencia incumple (y los avisos que no la invalidan). Es puro: no toca red, base, reloj ni azar.
 *
 * No rechaza nada ni lanza: mide la secuencia y dice qué incumple, igual que `evalua.ts`. Las pallets se
 * cuentan en centésimas enteras (`aCentesimas`), para que 0.15 + 0.15 + 9.7 dé exactamente 10.
 */

export type ReglaDura = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface Violacion {
  regla: ReglaDura;
  /** Clave estable para pruebas y para contar: ver la lista de claves abajo. */
  clave: string;
  /** Índice (0-based) de la parada de `secuencia` donde se ve el problema; -1 si no es de una parada. */
  indice: number;
  /** Las órdenes implicadas (ids). */
  ordenes: string[];
  /** El sitio, si aplica. */
  lugar?: Punto | null;
  /** Explicación corta en español, con códigos de orden cuando existan (`codigo`), si no el id. */
  detalle: string;
}

/** Algo que NO invalida la ruta pero el motor debe señalar y explicar (regla 3 con excepción, regla 7). */
export interface Aviso { regla: ReglaDura; clave: string; indice: number; ordenes: string[]; lugar?: Punto | null; detalle: string }

export interface EntradaDelValidador {
  chofer: Pick<ChoferEntrada, "nombre" | "capacidad">;
  /** Todas las órdenes que aparecen en la secuencia, y las que deberían aparecer (`esperadas`). */
  ordenes: readonly OrdenEntrada[];
  secuencia: readonly ParadaRef[];
  /** Regla 6: las paradas ya hechas o en curso, en el orden en que quedaron. Deben ser EXACTAMENTE el principio de `secuencia`. */
  hechas?: readonly ParadaRef[];
  /** Regla 7: minuto de llegada a cada parada (mismo largo que `secuencia`), si quien llama ya evaluó la ruta. Sin él, la regla 7 no se revisa. */
  llegadas?: readonly number[] | null;
  /** Regla 8: ids de las órdenes que este chofer tiene asignadas ese día. */
  esperadas?: readonly string[];
  /** Regla 8: ids que el motor ya reportó por nombre como «sin punto en el mapa» (no van en la secuencia a propósito). */
  reportadasSinPunto?: readonly string[];
}

export interface Resultado { valida: boolean; violaciones: Violacion[]; avisos: Aviso[] }

/**
 * Claves (para contar y probar):
 *   regla 1: entrega_sin_recogida, recogida_sin_entrega, parada_repetida, recogida_de_mas
 *   regla 2: carga_antes_de_descarga
 *   regla 3: regreso_a_la_misma_tienda (violación); regreso_inevitable, regreso_por_capacidad,
 *            regreso_por_disponibilidad (avisos)
 *   regla 4: sobre_capacidad, orden_mayor_que_el_camion
 *   regla 5: descarga_de_lo_que_no_va_a_bordo
 *   regla 6: parada_hecha_movida, parada_hecha_ausente
 *   regla 7: fuera_de_ventana_estrecha, llegadas_no_cuadran (violaciones); fuera_de_ventana (aviso)
 *   regla 8: orden_saltada, parada_sin_punto, orden_desconocida
 */

/** Una parada de una orden conocida. `k` es su índice en `secuencia`; `carga` los pallets a bordo al salir. */
interface Parada {
  k: number;
  orden: string;
  tipo: ParadaRef["tipo"];
  o: OrdenEntrada;
  punto: Punto | null;
  carga: number;
}

/** Una visita: un tramo de paradas consecutivas en el mismo punto. `desde` y `hasta` son posiciones en `paradas`. */
interface Visita { punto: Punto; desde: number; hasta: number }

const unicos = (xs: readonly string[]): string[] => [...new Set(xs)];
const hay = (x: unknown): boolean => x !== null && x !== undefined;

/** Centésimas → pallets, con a lo sumo dos decimales (10 → "10", 10.5 → "10.5", 0.15 → "0.15"). */
const fmt = (centesimas: number): string => (centesimas / 100).toFixed(2).replace(/\.?0+$/, "");

export function validaLaRuta(e: EntradaDelValidador): Resultado {
  const violaciones: Violacion[] = [];
  const avisos: Aviso[] = [];
  const cap = aCentesimas(e.chofer.capacidad);
  const crudo = e.secuencia;

  const porId = new Map<string, OrdenEntrada>();
  for (const o of e.ordenes) if (!porId.has(o.id)) porId.set(o.id, o);
  const nombre = (id: string): string => porId.get(id)?.codigo || id;

  const viola = (regla: ReglaDura, clave: string, indice: number, ordenes: string[], detalle: string, lugar?: Punto | null): void => {
    violaciones.push({ regla, clave, indice, ordenes, detalle, ...(lugar !== undefined ? { lugar } : {}) });
  };
  const avisa = (regla: ReglaDura, clave: string, indice: number, ordenes: string[], detalle: string, lugar?: Punto | null): void => {
    avisos.push({ regla, clave, indice, ordenes, detalle, ...(lugar !== undefined ? { lugar } : {}) });
  };

  // Paradas de órdenes conocidas. Una orden que no está en la lista se reporta y se IGNORA en lo demás.
  const paradas: Parada[] = [];
  crudo.forEach((p, k) => {
    const o = porId.get(p.orden);
    if (!o) {
      viola(8, "orden_desconocida", k, [p.orden], `La orden ${p.orden} no está en la lista de órdenes.`);
      return;
    }
    const punto = p.tipo === "P" ? o.origen : o.destino;
    paradas.push({ k, orden: p.orden, tipo: p.tipo, o, punto: punto || null, carga: 0 });
  });
  const ids = unicos(paradas.map((s) => s.orden));

  // Primera posición (en `paradas`) de la recogida y de la entrega de cada orden.
  const posP = new Map<string, number>();
  const posD = new Map<string, number>();
  const conteo = new Map<string, number>();
  paradas.forEach((s, i) => {
    const mapa = s.tipo === "P" ? posP : posD;
    if (!mapa.has(s.orden)) mapa.set(s.orden, i);
    const clave = `${s.tipo}|${s.orden}`;
    const n = (conteo.get(clave) ?? 0) + 1;
    conteo.set(clave, n);
    if (n > 1) viola(1, "parada_repetida", s.k, [s.orden], `${nombre(s.orden)} aparece más de una vez como ${s.tipo === "P" ? "recogida" : "entrega"}.`, s.punto);
  });

  // Regla 8: parada sin punto (cuenta para la carga, pero no inicia ni continúa visita).
  for (const s of paradas) {
    if (s.punto === null) {
      viola(8, "parada_sin_punto", s.k, [s.orden], `La ${s.tipo === "P" ? "recogida" : "entrega"} de ${nombre(s.orden)} no tiene punto en el mapa.`, null);
    }
  }

  // Regla 1: recogida antes que entrega, dentro de esta ruta.
  for (const id of ids) {
    const o = porId.get(id);
    if (!o) continue;
    const pP = posP.get(id);
    const pD = posD.get(id);
    if (pD !== undefined && pP === undefined && o.recogidaHecha !== true) {
      viola(1, "entrega_sin_recogida", paradas[pD].k, [id], `${nombre(id)} tiene entrega en la ruta, pero no tiene recogida ni está hecha.`, paradas[pD].punto);
    }
    if (pP !== undefined && pD === undefined) {
      viola(1, "recogida_sin_entrega", paradas[pP].k, [id], `${nombre(id)} tiene recogida en la ruta, pero no tiene entrega.`, paradas[pP].punto);
    }
    if (o.recogidaHecha === true && pP !== undefined) {
      viola(1, "recogida_de_mas", paradas[pP].k, [id], `${nombre(id)} ya tiene la recogida hecha, y aun así aparece una recogida en la ruta.`, paradas[pP].punto);
    }
  }

  // Regla 5: una entrega antes que la recogida de la misma orden.
  paradas.forEach((s, i) => {
    const pP = posP.get(s.orden);
    if (s.tipo === "D" && pP !== undefined && i < pP) {
      viola(5, "descarga_de_lo_que_no_va_a_bordo", s.k, [s.orden], `Se entrega ${nombre(s.orden)} antes de recogerla.`, s.punto);
    }
  });

  // Carga a bordo, parada por parada, en centésimas. Empieza con lo que ya se recogió (y aún falta entregar).
  let carga = 0;
  const enBordo = new Set<string>();
  for (const o of porId.values()) {
    if (o.recogidaHecha === true && posD.has(o.id)) {
      carga += aCentesimas(o.pallets);
      enBordo.add(o.id);
    }
  }

  // Regla 4: sobre capacidad. Un aviso por tramo seguido por encima; el pico y las órdenes a bordo en ese pico.
  let exceso: { indice: number; pico: number; ordenes: string[] } | null = null;
  const cerrarExceso = (): void => {
    if (!exceso) return;
    viola(4, "sobre_capacidad", exceso.indice, exceso.ordenes, `Pico de ${fmt(exceso.pico)} pallets a bordo, con capacidad de ${fmt(cap)}.`);
    exceso = null;
  };
  const medir = (valor: number, indice: number): void => {
    if (valor > cap) {
      if (!exceso) exceso = { indice, pico: valor, ordenes: [...enBordo] };
      else if (valor > exceso.pico) exceso = { indice: exceso.indice, pico: valor, ordenes: [...enBordo] };
    } else {
      cerrarExceso();
    }
  };
  medir(carga, 0);
  for (const s of paradas) {
    const c = aCentesimas(s.o.pallets);
    if (s.tipo === "P") {
      carga += c;
      enBordo.add(s.orden);
    } else {
      carga -= c;
      enBordo.delete(s.orden);
    }
    s.carga = carga;
    medir(carga, s.k);
  }
  cerrarExceso();

  // Regla 4: una orden que por sí sola no cabe en el camión.
  for (const id of ids) {
    const o = porId.get(id);
    if (!o || aCentesimas(o.pallets) <= cap) continue;
    const pP = posP.get(id);
    const pD = posD.get(id);
    const i = o.recogidaHecha === true ? (pD ?? pP) : (pP ?? pD);
    if (i === undefined) continue;
    viola(4, "orden_mayor_que_el_camion", paradas[i].k, [id], `${nombre(id)} lleva ${fmt(aCentesimas(o.pallets))} pallets y el camión aguanta ${fmt(cap)}.`, paradas[i].punto);
  }

  // Visitas: tramos de paradas consecutivas en el mismo punto. Una parada sin punto corta el tramo.
  const visitas: Visita[] = [];
  paradas.forEach((s, i) => {
    const punto = s.punto;
    if (punto === null) return;
    const ult = visitas[visitas.length - 1];
    if (ult && ult.hasta === i - 1 && ult.punto === punto) ult.hasta = i;
    else visitas.push({ punto, desde: i, hasta: i });
  });

  // Regla 2: dentro de una visita, no se entrega una orden que se recogió en otro sitio después de haber recogido en ese
  // mismo sitio. La entrega de una orden cuya recogida está antes en la MISMA visita no cuenta: esa orden sale del mismo
  // punto donde entra, y sigue valiendo para las demás de la visita.
  for (const v of visitas) {
    const previas: string[] = [];
    for (let i = v.desde; i <= v.hasta; i++) {
      const s = paradas[i];
      if (s.tipo === "P") {
        previas.push(s.orden);
      } else if (previas.length > 0 && !previas.includes(s.orden)) {
        viola(2, "carga_antes_de_descarga", s.k, unicos([s.orden, ...previas]),
          `En ${v.punto} se recoge ${unicos(previas).map(nombre).join(", ")} antes de entregar ${nombre(s.orden)}.`, v.punto);
        break;
      }
    }
  }

  // Regla 3: regreso a una tienda donde ya se estuvo, en el mismo viaje.
  // Ningún D con carga 0 en las posiciones [a, b] (si lo hay, el camión se vació: otro viaje).
  const sinCeroEntre = (a: number, b: number): boolean => {
    for (let i = a; i <= b; i++) if (paradas[i].tipo === "D" && paradas[i].carga === 0) return false;
    return true;
  };
  visitas.forEach((v2, j) => {
    let i = j - 1;
    while (i >= 0 && visitas[i].punto !== v2.punto) i--;
    if (i < 0) return;
    const v1 = visitas[i];
    if (!visitas.slice(i + 1, j).some((x) => x.punto !== v2.punto)) return;
    if (!sinCeroEntre(v1.hasta, v2.desde - 1)) return;

    const enV2 = paradas.slice(v2.desde, v2.hasta + 1);
    const pV2 = enV2.filter((s) => s.tipo === "P");
    const dV2 = enV2.filter((s) => s.tipo === "D");
    const primera = paradas[v2.desde];
    const ordenesV2 = unicos(enV2.map((s) => s.orden));

    const inevitable = dV2.filter((s) => {
      const p = posP.get(s.orden);
      return p !== undefined && p > v1.hasta;
    });
    if (inevitable.length > 0) {
      avisa(3, "regreso_inevitable", primera.k, unicos(inevitable.map((s) => s.orden)),
        `Vuelve a ${v2.punto} a entregar ${unicos(inevitable.map((s) => s.orden)).map(nombre).join(", ")}, que se recogió después de la primera pasada.`, v2.punto);
      return;
    }
    if (pV2.length > 0) {
      const maxEntre = paradas.slice(v1.hasta, v2.desde).reduce((m, s) => Math.max(m, s.carga), -Infinity);
      const sumaP = pV2.reduce((t, s) => t + aCentesimas(s.o.pallets), 0);
      if (maxEntre + sumaP > cap) {
        avisa(3, "regreso_por_capacidad", primera.k, ordenesV2,
          `Vuelve a ${v2.punto}: lo recogido no cabía en la primera pasada (${fmt(maxEntre)} + ${fmt(sumaP)} pallets, con capacidad de ${fmt(cap)}).`, v2.punto);
        return;
      }
      if (pV2.every((s) => hay(s.o.recogidaDesde))) {
        avisa(3, "regreso_por_disponibilidad", primera.k, ordenesV2,
          `Vuelve a ${v2.punto} a recoger lo que todavía no estaba disponible en la primera pasada.`, v2.punto);
        return;
      }
    }
    viola(3, "regreso_a_la_misma_tienda", primera.k, ordenesV2,
      `Vuelve a ${v2.punto} con el camión todavía cargado, sin que lo justifique la carga ni la disponibilidad.`, v2.punto);
  });

  // Regla 6: las paradas ya hechas tienen que seguir al principio, tal cual.
  const hechas = e.hechas ?? [];
  if (hechas.length > 0) {
    const faltan: string[] = [];
    hechas.forEach((h, p) => {
      if (p >= crudo.length) {
        faltan.push(h.orden);
        return;
      }
      const s = crudo[p];
      if (s.orden !== h.orden || s.tipo !== h.tipo) {
        viola(6, "parada_hecha_movida", p, unicos([h.orden, s.orden]),
          `La parada ${p + 1} ya estaba hecha (${nombre(h.orden)} ${h.tipo}) y ahora es ${nombre(s.orden)} ${s.tipo}.`);
      }
    });
    if (faltan.length > 0) {
      viola(6, "parada_hecha_ausente", -1, unicos(faltan), `La ruta es más corta que las paradas ya hechas: faltan ${unicos(faltan).map(nombre).join(", ")}.`);
    }
  }

  // Regla 7: llegada tarde a una ventana. Estrecha = violación; ancha = aviso.
  if (e.llegadas) {
    if (e.llegadas.length !== crudo.length) {
      viola(7, "llegadas_no_cuadran", -1, [], `Hay ${e.llegadas.length} llegadas para ${crudo.length} paradas.`);
    } else {
      for (const s of paradas) {
        const v = s.o.ventana;
        if (s.tipo !== "D" || !v) continue;
        const cierra = v[1];
        const llega = e.llegadas[s.k];
        if (!(llega > cierra)) continue;
        const tarde = llega - cierra;
        const detalle = `Llega al minuto ${llega}, ${tarde} min tarde de la ventana que cierra al ${cierra}.`;
        if (s.o.estrecha === true) viola(7, "fuera_de_ventana_estrecha", s.k, [s.orden], `${nombre(s.orden)}: ${detalle}`, s.punto);
        else avisa(7, "fuera_de_ventana", s.k, [s.orden], `${nombre(s.orden)}: ${detalle}`, s.punto);
      }
    }
  }

  // Regla 8: nada se salta en silencio.
  if (e.esperadas) {
    const enSecuencia = new Set(crudo.map((p) => p.orden));
    const reportadas = new Set(e.reportadasSinPunto ?? []);
    for (const id of unicos(e.esperadas)) {
      if (!enSecuencia.has(id) && !reportadas.has(id)) {
        viola(8, "orden_saltada", -1, [id], `${nombre(id)} está asignada a este chofer y no aparece en la ruta ni está reportada sin punto.`);
      }
    }
  }

  // Orden: por índice ascendente (-1 al final), y luego por regla.
  const ordenar = <T extends { indice: number; regla: ReglaDura }>(xs: T[]): T[] =>
    [...xs].sort((a, b) => {
      const ia = a.indice < 0 ? Infinity : a.indice;
      const ib = b.indice < 0 ? Infinity : b.indice;
      if (ia !== ib) return ia < ib ? -1 : 1;
      return a.regla - b.regla;
    });

  return { valida: violaciones.length === 0, violaciones: ordenar(violaciones), avisos: ordenar(avisos) };
}
