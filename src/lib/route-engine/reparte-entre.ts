import { planifica } from "./planifica";
import type { Entrada, OrdenEntrada, ParadaRef, Parametros, Plan, RutaEvaluada, SinAsignar } from "./types";

/**
 * «Asignar a…» varios choferes desde el Gestor de Rutas: repartir UN SUBCONJUNTO de órdenes entre LOS choferes que eligió
 * la persona, con el mismo motor y las mismas reglas que «Armar rutas» (D-NEXT).
 *
 * El dueño, 2026-10-06: «en routes manager quiero que puede select multiple orders y asignarla a los ocnductos que yo elija
 * asi como el autoassign entonces elijo 10 ordenes y las asigno a 2 conductos y el sistema automaticmaente sabe a quien
 * darselas».
 *
 * Lo que se decide aquí, sin pantalla, sin red y sin base:
 *   · El motor es `planifica` tal cual (`motor-7`): inserción con arrepentimiento, mejora, zonas, requisitos, prioridad,
 *     capacidad, ventanas, balance, de paso. No hay una regla de reparto aparte: la ÚNICA diferencia con «Armar rutas» es la
 *     entrada —solo los choferes elegidos y solo las órdenes seleccionadas más lo que esos choferes ya llevan—.
 *   · Lo que cada chofer elegido ya lleva hoy se queda con él y EN SU ORDEN (`secuenciaFijada` + `choferFijado`): las
 *     seleccionadas se INSERTAN en sus rutas, no se le reordena lo que tenía ni se le quita nada.
 *   · Una seleccionada que hoy está con OTRO chofer (elegido o no) entra libre: el motor decide con cuál de los elegidos va.
 *     Si su chofer de ahora no está entre los elegidos, se mueve.
 *   · Con UN solo elegido, el motor solo decide el orden: todas van con él.
 *   · Lo que no cabe se devuelve con su porqué (`sinAsignar`, los motivos del motor) y `completo` dice si entró todo. La
 *     pantalla lo enseña antes de escribir nada: no se asigna a medias sin avisar.
 */

/** Una orden partida por el motor (`id#a`) es UNA orden. Es la regla de `route-plan/publicar` (`ordenDeLaParte`), repetida
 *  aquí porque el motor no importa nada de fuera. */
const ordenDeLaParte = (id: string): string => id.split("#")[0];

export interface PeticionDeReparto {
  /** El día como lo ve «Armar rutas» (`entradaDelDia`): las órdenes pendientes con su chofer de ahora, y los choferes que rutean. */
  entrada: Entrada;
  parametros: Parametros;
  /** Las órdenes marcadas: las que se reparten. */
  seleccionadas: readonly string[];
  /** Los choferes elegidos, por su id de `entrada.choferes`. Entre ESTOS y solo estos. */
  elegidos: readonly string[];
  /** Lo que cada elegido ya lleva hoy, en el orden de su lista (P y D de cada orden pendiente). Lo que no es suyo o está
   *  seleccionado se ignora: la seleccionada entra libre. */
  yaLlevan: Readonly<Record<string, readonly ParadaRef[]>>;
}

export interface RutaRepartida {
  chofer: string;
  nombre: string;
  /** La lista ENTERA nueva del chofer: lo que llevaba, en su orden, con las seleccionadas metidas donde el motor decidió.
   *  Una orden por recogida y por entrega (las partes del motor, juntas). */
  paradas: ParadaRef[];
  /** Las seleccionadas que le tocaron, en el orden de su entrega. */
  nuevas: string[];
  ruta: RutaEvaluada;
}

export interface Reparto {
  rutas: RutaRepartida[];
  /** De las seleccionadas, las que no entraron en ningún elegido, con el motivo del motor. */
  sinAsignar: SinAsignar[];
  /** Seleccionadas que ni llegan al motor: no están en la entrada del día (sin fecha de hoy, en práctica, anuladas…). */
  ignoradas: string[];
  /** Todas las seleccionadas tienen chofer. */
  completo: boolean;
  plan: Plan;
}

/** Las paradas de una ruta del motor como UNA orden por recogida y por entrega (las partes `id#a`, `id#b` se juntan en su
 *  primera P y su primera D), en el orden de la ruta. */
export function paradasSinPartes(paradas: readonly ParadaRef[]): ParadaRef[] {
  const out: ParadaRef[] = [];
  const vistas = new Set<string>();
  for (const p of paradas) {
    const orden = ordenDeLaParte(p.orden);
    const clave = `${p.tipo}:${orden}`;
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    out.push({ orden, tipo: p.tipo });
  }
  return out;
}

/**
 * La entrada que ve el motor: solo los elegidos; solo las seleccionadas (libres) y lo que los elegidos ya llevan (con su
 * chofer y en su orden). Aparte de `reparteEntre` para que la pantalla sepa QUÉ puntos necesita medir antes de planificar.
 */
export function entradaDelReparto(p: Omit<PeticionDeReparto, "parametros">): { entrada: Entrada; ignoradas: string[] } {
  const sel = new Set(p.seleccionadas);
  const porId = new Map(p.entrada.ordenes.map((o) => [o.id, o]));
  const elegidos = p.entrada.choferes.filter((c) => p.elegidos.includes(c.id));

  // Lo que cada elegido ya lleva: se queda con él y en su orden. Una seleccionada no se fija aunque esté en su lista.
  const fijadaEn = new Map<string, string>();
  const secuenciaFijada: Record<string, ParadaRef[]> = {};
  for (const c of elegidos) {
    const suyas = (p.yaLlevan[c.id] ?? []).filter((x) => porId.has(x.orden) && !sel.has(x.orden));
    for (const x of suyas) fijadaEn.set(x.orden, c.id);
    if (suyas.length) secuenciaFijada[c.id] = suyas.map((x) => ({ orden: x.orden, tipo: x.tipo }));
  }

  const ordenes: OrdenEntrada[] = [];
  for (const o of p.entrada.ordenes) {
    if (sel.has(o.id)) ordenes.push({ ...o, choferFijado: null });
    else if (fijadaEn.has(o.id)) ordenes.push({ ...o, choferFijado: fijadaEn.get(o.id)! });
  }
  const ignoradas = p.seleccionadas.filter((id) => !porId.has(id));

  return {
    entrada: {
      ordenes, choferes: elegidos, matriz: p.entrada.matriz,
      ...(p.entrada.porHora ? { porHora: p.entrada.porHora } : {}),
      ...(Object.keys(secuenciaFijada).length ? { secuenciaFijada } : {}),
    },
    ignoradas,
  };
}

export function reparteEntre(p: PeticionDeReparto): Reparto {
  const sel = new Set(p.seleccionadas);
  const { entrada, ignoradas } = entradaDelReparto(p);
  const elegidos = entrada.choferes;
  const plan = planifica(entrada, p.parametros);

  const rutas: RutaRepartida[] = elegidos.map((c) => {
    const ruta = plan.rutas.find((r) => r.chofer === c.id) ?? { chofer: c.id, paradas: [], inicio: c.entrada, fin: c.entrada, duracionMin: 0, manejoMin: 0, millas: 0, tardeMin: 0, builderMin: 0, violaciones: [] };
    const paradas = paradasSinPartes(ruta.paradas);
    return { chofer: c.id, nombre: c.nombre, paradas, nuevas: paradas.filter((x) => x.tipo === "D" && sel.has(x.orden)).map((x) => x.orden), ruta };
  });

  // Lo que quedó fuera, una vez por orden (una partida en cargas puede salir en varias partes).
  const fuera = new Map<string, SinAsignar>();
  for (const s of plan.sinAsignar) {
    const orden = ordenDeLaParte(s.orden);
    if (sel.has(orden) && !fuera.has(orden)) fuera.set(orden, { ...s, orden });
  }
  const sinAsignar = [...fuera.values()];
  return { rutas, sinAsignar, ignoradas, completo: sinAsignar.length === 0 && ignoradas.length === 0, plan };
}
