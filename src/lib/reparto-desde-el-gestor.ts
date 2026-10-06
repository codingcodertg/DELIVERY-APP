import type { Entrada, Matriz, Punto, Reparto, SinAsignar } from "./route-engine";
import type { EntradaDelDia } from "./route-plan/entrada";
import type { ParadaDeLaLista } from "./lista-unica";
import type { ParadaRef } from "./route-engine";
import type { TiemposDeLaRuta } from "./optimiza-la-ruta";
import { claveDePunto, type LatLng } from "./route-times/claves";
import { FACTOR_DE_RODEO, MILLAS_POR_HORA_ESTIMADAS, millasEnLineaRecta } from "./route-times/proveedores";
import type { DriverSettings, Profile } from "./types";

/**
 * Lo que el Gestor de Rutas pone alrededor de `reparteEntre` (D-474, «Asignar a…» varios choferes): con qué choferes se
 * puede repartir y por qué no con los demás, qué puntos hay que medir, cómo se vuelve matriz lo que contesta
 * `/api/route-matrix` (y qué se estima en línea recta si falta), cómo se pasa de la lista del Gestor a las paradas del motor
 * y de vuelta, y qué dice el resumen antes de confirmar. Todo puro: sin pantalla, sin base, sin red.
 *
 * El dueño, 2026-10-06: «elijo 10 ordenes y las asigno a 2 conductos y el sistema automaticmaente sabe a quien darselas».
 */

// ---------------------------------------------------------------------------------------------------------------------
// Los choferes, como los ve «Armar rutas».

/**
 * Las filas de Ajustes → Rutas con la base del PERFIL cuando no hay base de Ajustes (D-461: la base de una ruta del Gestor es
 * la de Ajustes y, si no, la tienda del perfil). «Armar rutas» en el servidor solo mira Ajustes; aquí se completa con el
 * perfil para que un chofer que el Gestor ya mide desde su tienda pueda ser elegido. Un chofer sin fila entra con los
 * valores de partida de `choferParaElMotor` (turno 08:00–17:30, vuelve a base, rutea).
 */
export function ajustesConBaseDelPerfil(
  filas: readonly DriverSettings[], choferes: readonly Pick<Profile, "id" | "store">[],
): DriverSettings[] {
  const porId = new Map(filas.map((f) => [f.profile_id, f]));
  return choferes.map((c) => {
    const fila = porId.get(c.id);
    const base = (fila?.base_store ?? "").trim() || (c.store ?? "").trim() || null;
    return fila ? { ...fila, base_store: base } : { profile_id: c.id, base_store: base, capacity_pallets: null, shift_start: "", shift_end: "", returns_to_base: true, routable: true };
  });
}

export type MotivoDeNoRepartir = EntradaDelDia["choferesFuera"][number]["motivo"] | "ruta_bloqueada";

export interface OpcionDeReparto {
  id: string;
  nombre: string;
  /** Se le puede repartir: rutea para el motor y su ruta no está bloqueada 🔒. */
  puede: boolean;
  /** Por qué no, si no puede. */
  motivo?: MotivoDeNoRepartir;
  /** De vacaciones, baja o taller ese día: sale y se puede elegir, marcado (como en «Elige conductor», D-395). */
  noDisponible: boolean;
}

/**
 * Con quién se puede repartir: los choferes que entran al motor (`entradaDelDia`, los mismos de «Armar rutas»), salvo los
 * de ruta bloqueada 🔒; los demás salen apagados con su porqué. En el orden del Gestor (`drivers`).
 */
export function choferesParaRepartir(
  dia: Pick<EntradaDelDia, "entrada" | "choferesFuera">,
  choferes: readonly Pick<Profile, "id" | "full_name">[],
  bloqueada: (nombre: string) => boolean,
  noDisponibles: ReadonlySet<string>,
): OpcionDeReparto[] {
  const dentro = new Set(dia.entrada.choferes.map((c) => c.id));
  const fuera = new Map(dia.choferesFuera.map((c) => [c.id, c.motivo]));
  return choferes.flatMap((c) => {
    const nombre = (c.full_name ?? "").trim();
    if (!dentro.has(c.id) && !fuera.has(c.id)) return [];
    const motivo: MotivoDeNoRepartir | undefined = dentro.has(c.id) ? (bloqueada(nombre) ? "ruta_bloqueada" : undefined) : fuera.get(c.id);
    return [{ id: c.id, nombre, puede: !motivo, ...(motivo ? { motivo } : {}), noDisponible: noDisponibles.has(nombre) }];
  });
}

/** Por qué un chofer no se puede elegir, en los dos idiomas (los mismos textos que el panel del plan). */
export function textoDeNoRepartir(motivo: MotivoDeNoRepartir): { en: string; es: string } {
  const m: Record<MotivoDeNoRepartir, [string, string]> = {
    no_rutea: ["not routed", "no rutea"], base: ["no base store", "sin tienda base"], base_sin_punto: ["base store has no map point", "su tienda base no tiene punto"],
    no_disponible: ["off today", "hoy no está"], ruta_bloqueada: ["route locked 🔒", "ruta bloqueada 🔒"],
  };
  return { en: m[motivo][0], es: m[motivo][1] };
}

// ---------------------------------------------------------------------------------------------------------------------
// Los tiempos: qué puntos medir, y la matriz del motor a partir de lo que contesta `/api/route-matrix`.

/** Los puntos que usa esta entrada (las bases de los elegidos, la tienda y el pin de cada orden), con sus coordenadas. */
export function puntosDelReparto(entrada: Pick<Entrada, "ordenes" | "choferes">, puntos: Readonly<Record<Punto, LatLng>>): Record<Punto, LatLng> {
  const r: Record<Punto, LatLng> = {};
  const pon = (p: Punto | null | undefined) => { if (p && puntos[p]) r[p] = puntos[p]; };
  for (const c of entrada.choferes) pon(c.base);
  for (const o of entrada.ordenes) { pon(o.origen); pon(o.destino); }
  return r;
}

/** El mismo escalón de respaldo que el motor (`proveedorEstimado`): línea recta con rodeo, a la velocidad estimada. */
export function tramoEstimado(a: LatLng, b: LatLng): { minutos: number; millas: number } {
  const millas = Math.round(millasEnLineaRecta(a, b) * FACTOR_DE_RODEO * 100) / 100;
  return { minutos: Math.round((millas / MILLAS_POR_HORA_ESTIMADAS) * 60), millas };
}

/**
 * La matriz del motor, por el NOMBRE de cada punto (`tienda:…`, `orden:…`), a partir de los tiempos por calles que da
 * `/api/route-matrix` (por la clave lat,lng de cada punto). Lo que falte —el servidor no contestó, o no tiene ese tramo— se
 * estima en línea recta, y se cuenta: el resumen lo dice. Dos puntos en el mismo sitio comparten tramo (cero).
 */
export function matrizDelGestor(puntos: Readonly<Record<Punto, LatLng>>, tiempos: TiemposDeLaRuta | null): { matriz: Matriz; estimados: number; pares: number } {
  const nombres = Object.keys(puntos);
  const matriz: Matriz = Object.fromEntries(nombres.map((n) => [n, {}]));
  let estimados = 0, pares = 0;
  for (const a of nombres) for (const b of nombres) {
    if (a === b) continue;
    const ka = claveDePunto(puntos[a]), kb = claveDePunto(puntos[b]);
    if (ka === kb) { matriz[a][b] = { minutos: 0, millas: 0 }; continue; }
    pares++;
    const t = tiempos?.[ka]?.[kb];
    if (t && Number.isFinite(t.minutos) && Number.isFinite(t.millas)) matriz[a][b] = { minutos: t.minutos, millas: t.millas };
    else { matriz[a][b] = tramoEstimado(puntos[a], puntos[b]); estimados++; }
  }
  return { matriz, estimados, pares };
}

// ---------------------------------------------------------------------------------------------------------------------
// De la lista del Gestor a las paradas del motor, y de vuelta.

/** La lista de un chofer (una fila P por recogida con sus órdenes, una D por entrega) como paradas del motor: una P y una
 *  D por orden, en el mismo orden. */
export function paradasDeLaLista(lista: readonly ParadaDeLaLista[]): ParadaRef[] {
  return lista.flatMap((p): ParadaRef[] => (p.tipo === "P" ? p.ordenes.map((orden) => ({ orden, tipo: "P" })) : [{ orden: p.orden, tipo: "D" }]));
}

/** Las paradas que dejó el motor como lista del Gestor, para guardarla por el camino de siempre (`escrituraDeLaLista`): cada
 *  recogida en su fila, con su tienda. `obligatorias`: órdenes de esa ruta que el motor no vio (no entraron al día: en
 *  práctica, sin etapa ruteable…) van AL FINAL, su recogida y su entrega, para que la lista que se escribe sea la ENTERA y
 *  ninguna se quede con un puesto viejo. */
export function listaDeLasParadas(paradas: readonly ParadaRef[], tiendaDe: (orden: string) => string | null, obligatorias: readonly string[] = []): ParadaDeLaLista[] {
  const lista: ParadaDeLaLista[] = paradas.map((p) => (p.tipo === "P" ? { tipo: "P", ordenes: [p.orden], tienda: tiendaDe(p.orden) } : { tipo: "D", orden: p.orden }));
  const vistas = new Set(paradas.map((p) => p.orden));
  for (const orden of obligatorias) {
    if (vistas.has(orden)) continue;
    vistas.add(orden);
    lista.push({ tipo: "P", ordenes: [orden], tienda: tiendaDe(orden) }, { tipo: "D", orden });
  }
  return lista;
}

/** Qué seleccionadas cambian de ruta: de dónde salen (`null` = sin asignar) y a dónde van. Las que ya estaban con ese chofer
 *  no cuentan: solo cambian de puesto. */
export function movimientosDelReparto(r: Pick<Reparto, "rutas">, rutaDe: (orden: string) => string | null): { orden: string; de: string | null; a: string }[] {
  return r.rutas.flatMap((ruta) => ruta.nuevas.filter((o) => rutaDe(o) !== ruta.nombre).map((orden) => ({ orden, de: rutaDe(orden), a: ruta.nombre })));
}

// ---------------------------------------------------------------------------------------------------------------------
// El resumen antes de confirmar, y la etiqueta para deshacer.

const MOTIVO: Record<SinAsignar["motivo"], [string, string]> = {
  sin_punto: ["no map point", "sin punto en el mapa"], sin_chofer_disponible: ["no driver available", "sin chofer disponible"],
  supera_capacidad: ["larger than the truck", "mayor que el camión"], ventana_imposible: ["hard window can't be met", "no se llega a su ventana dura"],
  retraso_sobre_el_tope: ["would be too late", "llegaría demasiado tarde"], fuera_de_turno: ["doesn't fit in the shift", "no cabe en el turno"],
  chofer_fijado_sin_hueco: ["its driver has no room", "su chofer no tiene hueco"], no_cabe_con_el_resto: ["no room with the rest", "no cabe con lo demás"],
  falta_requisito: ["the truck lacks what it needs", "el camión no tiene lo que pide"],
};

const minutos = (min: number): string => {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
};

/**
 * Lo que se enseña ANTES de escribir nada: cuántas le tocan a cada quien y cómo queda su ruta; qué se mueve de otra ruta;
 * lo que no cabe, con su porqué, que se queda donde está; y con qué se midió. En los dos idiomas.
 */
export function resumenDelReparto(args: {
  r: Pick<Reparto, "rutas" | "sinAsignar" | "ignoradas">;
  /** Cómo se nombra una orden (su factura o su código). */
  nombreDe: (orden: string) => string;
  movimientos: readonly { orden: string; de: string | null; a: string }[];
  medida: { estimados: number; pares: number };
  totalSeleccionadas: number;
}): { en: string; es: string } {
  const { r } = args;
  const conAlgo = r.rutas.filter((x) => x.nuevas.length);
  const lineas = r.rutas.map((x) => {
    const ordenes = x.paradas.filter((p) => p.tipo === "D").length;
    const medida = `${x.ruta.millas.toFixed(1)} mi · ${minutos(x.ruta.duracionMin)}`;
    const tarde = x.ruta.tardeMin > 0 ? { en: ` · ⚠ ${x.ruta.tardeMin} min late`, es: ` · ⚠ ${x.ruta.tardeMin} min tarde` } : { en: "", es: "" };
    return {
      en: `• ${x.nombre}: +${x.nuevas.length} → ${ordenes} order(s) · ${medida}${tarde.en}`,
      es: `• ${x.nombre}: +${x.nuevas.length} → ${ordenes} orden(es) · ${medida}${tarde.es}`,
    };
  });
  const movidas = args.movimientos.filter((m) => m.de);
  const mov = movidas.length
    ? { en: `\nMoved from another route: ${movidas.map((m) => `${args.nombreDe(m.orden)} (${m.de} → ${m.a})`).join(", ")}.`,
        es: `\nSe mueven de otra ruta: ${movidas.map((m) => `${args.nombreDe(m.orden)} (${m.de} → ${m.a})`).join(", ")}.` }
    : { en: "", es: "" };
  const fuera = [...r.sinAsignar.map((s) => ({ orden: s.orden, en: MOTIVO[s.motivo]?.[0] ?? s.motivo, es: MOTIVO[s.motivo]?.[1] ?? s.motivo })),
    ...r.ignoradas.map((orden) => ({ orden, en: "not on this day's list", es: "no está en la lista de este día" }))];
  const sin = fuera.length
    ? { en: `\n⚠ ${fuera.length} don't fit and stay where they are: ${fuera.map((f) => `${args.nombreDe(f.orden)} (${f.en})`).join(", ")}.`,
        es: `\n⚠ ${fuera.length} no caben y se quedan donde están: ${fuera.map((f) => `${args.nombreDe(f.orden)} (${f.es})`).join(", ")}.` }
    : { en: "", es: "" };
  const medida = args.medida.estimados > 0
    ? { en: `\n⚠ Measured in a straight line (estimate): ${args.medida.estimados} of ${args.medida.pares} legs had no street times.`,
        es: `\n⚠ Medido en línea recta (estimado): ${args.medida.estimados} de ${args.medida.pares} tramos sin tiempos por calles.` }
    : { en: "", es: "" };
  const n = args.totalSeleccionadas - fuera.length;
  const cab = conAlgo.length === 0
    ? { en: `🧭 None of the ${args.totalSeleccionadas} selected order(s) can be assigned.`, es: `🧭 Ninguna de las ${args.totalSeleccionadas} orden(es) seleccionadas se puede asignar.` }
    : { en: `🧭 ${n} order(s) among ${conAlgo.length} driver(s), each in the best place of their route:`, es: `🧭 ${n} orden(es) entre ${conAlgo.length} chofer(es), cada una en el mejor sitio de su ruta:` };
  return {
    en: `${cab.en}\n${lineas.map((l) => l.en).join("\n")}${mov.en}${sin.en}${medida.en}`,
    es: `${cab.es}\n${lineas.map((l) => l.es).join("\n")}${mov.es}${sin.es}${medida.es}`,
  };
}

/** La etiqueta del movimiento en deshacer / rehacer: UN movimiento para el lote entero. */
export function etiquetaDelReparto(n: number, nombres: readonly string[]): { en: string; es: string } {
  return { en: `Assign ${n} order(s) to ${nombres.join(", ")}`, es: `Asignar ${n} orden(es) a ${nombres.join(", ")}` };
}
