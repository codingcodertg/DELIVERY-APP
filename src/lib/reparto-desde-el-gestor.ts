import type { Entrada, Matriz, Punto, Reparto, SinAsignar } from "./route-engine";
import { entradaDelReparto, evaluaPlan, faltanEnElCamion, type MotivoSinAsignar, type PeticionDeReparto, type RutaRepartida } from "./route-engine";
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
  // Y dónde termina ESE día, si no es la base (166): sin su tramo, la vuelta se estimaría en línea recta.
  for (const c of entrada.choferes) { pon(c.base); pon(c.fin); }
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
// Lo que el motor deja fuera y AUN ASÍ se asigna. El dueño, 2026-11-25: «es que si yo digo que se asignen, se asignan; yo
// ahí lo arreglo, solo que se cambie». Regla:
//   · Va al FINAL de la lista de un elegido (como un «Asignar a…» normal: `route_seq` null → último), pasando el límite, y
//     el porqué del motor se enseña aparte. Si ya estaba con ese elegido, se queda donde estaba: tras la parada que la
//     precedía en su lista de hoy.
//   · Con cuál: el elegido con quien ya está, si es uno de los elegidos; si no, el elegido con MENOS minutos de ruta (empate:
//     el primero de la lista de elegidos). Cada orden forzada suma a la carga de ese elegido para la siguiente.
//   · Nunca se fuerza (queda fuera, con su porqué): la que ningún elegido puede llevar porque su camión no tiene lo que pide
//     (`faltanEnElCamion` en todos) → `falta_requisito`. Sin elegidos, lo mismo. Los choferes de ruta bloqueada 🔒 o que no
//     rutean no son elegibles, y las etapas no ruteables o ya entregadas no se seleccionan: eso lo filtra la pantalla.
//   · Una orden que ya tiene alguna parada en una ruta (la partió el motor) no se toca.
//   · Sin punto en el mapa (`sin_punto`) SÍ se fuerza: el porqué lo dice y la ruta marca el tramo sin tiempo.

/** Una orden que el motor dejó fuera y se asignó igual: a quién, y por qué el motor no la metió. */
export interface OrdenForzada { orden: string; chofer: string; nombre: string; motivo: MotivoSinAsignar }

/** El reparto del motor, con lo que se forzó encima. `sinAsignar` queda solo con lo que de verdad no se puede asignar. */
export type RepartoConForzadas = Reparto & { forzadas: OrdenForzada[] };

export function forzaLasQueNoCaben(r: Reparto, p: PeticionDeReparto): RepartoConForzadas {
  const { entrada } = entradaDelReparto(p);
  const porOrden = new Map(entrada.ordenes.map((o) => [o.id, o]));
  const choferPorId = new Map(entrada.choferes.map((c) => [c.id, c]));
  const rutas: RutaRepartida[] = r.rutas.map((x) => ({ ...x, paradas: [...x.paradas], nuevas: [...x.nuevas] }));
  // Quién la lleva hoy: lo pendiente de cada elegido, tal como lo ve la pantalla (incluye las que se reparten).
  const hoyCon = new Map<string, string>();
  for (const [chofer, lista] of Object.entries(p.yaLlevan)) for (const x of lista) hoyCon.set(x.orden, chofer);

  const forzadas: OrdenForzada[] = [];
  const sinAsignar: SinAsignar[] = [];
  const recalcula = () => {
    const plan = evaluaPlan({
      secuencias: Object.fromEntries(rutas.map((x) => [x.chofer, x.paradas])), ordenes: [...porOrden.values()],
      choferes: entrada.choferes, matriz: entrada.matriz, porHora: entrada.porHora, parametros: p.parametros,
    });
    for (const x of rutas) x.ruta = plan.rutas.find((q) => q.chofer === x.chofer) ?? x.ruta;
  };

  for (const s of r.sinAsignar) {
    const o = porOrden.get(s.orden);
    if (!o || !rutas.length) { sinAsignar.push(s); continue; }
    if (rutas.some((x) => x.paradas.some((q) => q.orden === o.id))) continue;
    const posibles = rutas.filter((x) => faltanEnElCamion(choferPorId.get(x.chofer)!, o).length === 0);
    if (!posibles.length) {
      // Ningún elegido tiene lo que pide el camión: se dice qué le falta al que más cerca estaba de tenerlo todo.
      const faltan = rutas.map((x) => faltanEnElCamion(choferPorId.get(x.chofer)!, o)).reduce((a, b) => (b.length < a.length ? b : a));
      sinAsignar.push({ orden: s.orden, motivo: "falta_requisito", faltan: [...faltan] });
      continue;
    }
    const hoy = hoyCon.get(o.id);
    const elegido = posibles.find((x) => x.chofer === hoy) ?? posibles.reduce((mejor, x) => (x.ruta.duracionMin < mejor.ruta.duracionMin ? x : mejor));
    const paradas: ParadaRef[] = o.recogidaHecha ? [{ orden: o.id, tipo: "D" }] : [{ orden: o.id, tipo: "P" }, { orden: o.id, tipo: "D" }];
    if (hoy === elegido.chofer) {
      // Ya estaba con él: se queda donde estaba, justo tras la última parada que la precedía en su lista de hoy.
      const previa = p.yaLlevan[elegido.chofer] ?? [];
      const i = previa.findIndex((x) => x.orden === o.id);
      let at = 0;
      for (let k = i - 1; k >= 0 && at === 0; k--) {
        let j = -1;
        elegido.paradas.forEach((q, n) => { if (q.orden === previa[k].orden) j = n; });
        if (j >= 0) at = j + 1;
      }
      elegido.paradas.splice(at, 0, ...paradas);
    } else {
      elegido.paradas.push(...paradas);
      elegido.nuevas.push(o.id);
    }
    recalcula();
    forzadas.push({ orden: s.orden, chofer: elegido.chofer, nombre: elegido.nombre, motivo: s.motivo });
  }

  return { rutas, sinAsignar, ignoradas: r.ignoradas, completo: sinAsignar.length === 0 && r.ignoradas.length === 0, plan: r.plan, forzadas };
}

// ---------------------------------------------------------------------------------------------------------------------
// El resumen antes de confirmar, lo que se dice después, y la etiqueta para deshacer.

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

/** «1 order» / «3 orders», «1 orden» / «3 órdenes»: sin «order(s)». */
const cuantas = (n: number) => ({ en: n === 1 ? "1 order" : `${n} orders`, es: n === 1 ? "1 orden" : `${n} órdenes` });

/** Las que se asignan pasando el límite, con su porqué del motor («…: 180597 (no room with the rest), …»). `null` = ninguna. */
function lineaSobreElLimite(forzadas: readonly OrdenForzada[], nombreDe: (orden: string) => string): { en: string; es: string } | null {
  if (!forzadas.length) return null;
  const lista = (k: 0 | 1) => forzadas.map((f) => `${nombreDe(f.orden)} (${MOTIVO[f.motivo]?.[k] ?? f.motivo})`).join(", ");
  const n = forzadas.length;
  return n === 1
    ? { en: `1 assigned over the limit (check the route): ${lista(0)}.`, es: `1 asignada pasando el límite (revisa la ruta): ${lista(1)}.` }
    : { en: `${n} assigned over the limit (check the route): ${lista(0)}.`, es: `${n} asignadas pasando el límite (revisa la ruta): ${lista(1)}.` };
}

/** Las que de verdad no se pueden asignar (y las que no están en la lista de este día): se quedan donde están. `null` = ninguna. */
function lineaNoCaben(sinAsignar: readonly SinAsignar[], ignoradas: readonly string[], nombreDe: (orden: string) => string): { en: string; es: string } | null {
  const fuera = [...sinAsignar.map((s) => ({ orden: s.orden, en: MOTIVO[s.motivo]?.[0] ?? s.motivo, es: MOTIVO[s.motivo]?.[1] ?? s.motivo })),
    ...ignoradas.map((orden) => ({ orden, en: "not on this day's list", es: "no está en la lista de este día" }))];
  if (!fuera.length) return null;
  const lista = (k: "en" | "es") => fuera.map((f) => `${nombreDe(f.orden)} (${f[k]})`).join(", ");
  if (fuera.length === 1) return { en: `1 doesn't fit and stays where it is: ${lista("en")}.`, es: `1 no cabe y se queda donde está: ${lista("es")}.` };
  return {
    en: `${fuera.length} don't fit and stay where they are: ${lista("en")}.`,
    es: `${fuera.length} no caben y se quedan donde están: ${lista("es")}.`,
  };
}

/**
 * Lo que se enseña ANTES de escribir nada: cuántas le tocan a cada quien y cómo queda su ruta; qué se mueve de otra ruta;
 * lo que se asigna pasando el límite, con su porqué; lo que de verdad no cabe y se queda donde está; y con qué se midió.
 */
export function resumenDelReparto(args: {
  r: Pick<Reparto, "rutas" | "sinAsignar" | "ignoradas"> & { forzadas?: readonly OrdenForzada[] };
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
    // D-1139: «+2 → 3 order(s)» no se entendía. Se dice con palabras: cuántas se le suman y con cuántas queda.
    const nuevas = x.nuevas.length;
    return {
      en: `• ${x.nombre}: ${nuevas} new, ${cuantas(ordenes).en} in total · ${medida}${tarde.en}`,
      es: `• ${x.nombre}: ${nuevas} ${nuevas === 1 ? "nueva" : "nuevas"}, ${cuantas(ordenes).es} en total · ${medida}${tarde.es}`,
    };
  });
  const movidas = args.movimientos.filter((m) => m.de);
  const mov = movidas.length
    ? { en: `\nMoved from another route: ${movidas.map((m) => `${args.nombreDe(m.orden)} (${m.de} → ${m.a})`).join(", ")}.`,
        es: `\nSe mueven de otra ruta: ${movidas.map((m) => `${args.nombreDe(m.orden)} (${m.de} → ${m.a})`).join(", ")}.` }
    : { en: "", es: "" };
  const sobre = lineaSobreElLimite(r.forzadas ?? [], args.nombreDe);
  const sin = lineaNoCaben(r.sinAsignar, r.ignoradas, args.nombreDe);
  const medida = args.medida.estimados > 0
    ? { en: `\n⚠ Measured in a straight line (estimate): ${args.medida.estimados} of ${args.medida.pares} legs had no street times.`,
        es: `\n⚠ Medido en línea recta (estimado): ${args.medida.estimados} de ${args.medida.pares} tramos sin tiempos por calles.` }
    : { en: "", es: "" };
  const fuera = r.sinAsignar.length + r.ignoradas.length;
  const n = args.totalSeleccionadas - fuera;
  const cab = conAlgo.length === 0
    ? (n > 0
      // Nada se mueve, pero algo sí queda asignado: no se puede decir «ninguna».
      ? { en: `🧭 Nothing moves: ${cuantas(n).en} already with their driver.`, es: `🧭 Nada se mueve: ${cuantas(n).es} ya están con su chofer.` }
      : { en: `🧭 None of the ${args.totalSeleccionadas} selected order(s) can be assigned.`, es: `🧭 Ninguna de las ${args.totalSeleccionadas} orden(es) seleccionadas se puede asignar.` })
    // D-1139 (reunión del 22 nov, Roberto: «What does this mean? Three orders, one driver»): la cabecera es la pregunta
    // que se está contestando al pulsar «Asignar», con el nombre del chofer cuando es uno solo.
    : conAlgo.length === 1
      ? { en: `🧭 Assign ${cuantas(n).en} to ${conAlgo[0].nombre}? Each one goes in the best place of its route:`,
          es: `🧭 ¿Asignar ${cuantas(n).es} a ${conAlgo[0].nombre}? Cada una va en el mejor lugar de su ruta:` }
      : { en: `🧭 Assign ${cuantas(n).en} among ${conAlgo.length} drivers? Each one goes in the best place of that driver's route:`,
          es: `🧭 ¿Repartir ${cuantas(n).es} entre ${conAlgo.length} choferes? Cada una va en el mejor lugar de la ruta de ese chofer:` };
  return {
    en: `${cab.en}\n${lineas.map((l) => l.en).join("\n")}${mov.en}${sobre ? `\n⚠ ${sobre.en}` : ""}${sin ? `\n⚠ ${sin.en}` : ""}${medida.en}`,
    es: `${cab.es}\n${lineas.map((l) => l.es).join("\n")}${mov.es}${sobre ? `\n⚠ ${sobre.es}` : ""}${sin ? `\n⚠ ${sin.es}` : ""}${medida.es}`,
  };
}

/**
 * Lo que se dice DESPUÉS de asignar (una línea: el aviso no conserva saltos). Qué se asignó y a quién; aparte, lo que pasó
 * el límite con su porqué; y lo que de verdad se quedó donde estaba.
 */
export function mensajeDelRepartoHecho(args: {
  rutas: readonly RutaRepartida[];
  forzadas: readonly OrdenForzada[];
  sinAsignar: readonly SinAsignar[];
  ignoradas: readonly string[];
  nombreDe: (orden: string) => string;
}): { en: string; es: string } {
  const asig = args.rutas.filter((x) => x.nuevas.length);
  const n = asig.reduce((s, x) => s + x.nuevas.length, 0);
  const lista = asig.map((x) => `${x.nombre} (+${x.nuevas.length})`).join(", ");
  const sobre = lineaSobreElLimite(args.forzadas, args.nombreDe);
  const sin = lineaNoCaben(args.sinAsignar, args.ignoradas, args.nombreDe);
  return {
    en: [`🧭 ${n} order(s) assigned to ${lista}. Ctrl+Z undoes it.`, sobre && `⚠ ${sobre.en}`, sin && `⚠ ${sin.en}`].filter(Boolean).join(" · "),
    es: [`🧭 ${n} orden(es) asignadas a ${lista}. Ctrl+Z lo deshace.`, sobre && `⚠ ${sobre.es}`, sin && `⚠ ${sin.es}`].filter(Boolean).join(" · "),
  };
}

/** La etiqueta del movimiento en deshacer / rehacer: UN movimiento para el lote entero. */
export function etiquetaDelReparto(n: number, nombres: readonly string[]): { en: string; es: string } {
  return { en: `Assign ${n} order(s) to ${nombres.join(", ")}`, es: `Asignar ${n} orden(es) a ${nombres.join(", ")}` };
}
