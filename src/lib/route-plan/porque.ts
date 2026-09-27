import type { Desglose, Explicacion, PrioridadDeOrden, TipoDeViolacion } from "@/lib/route-engine";
import { etiquetaDePrioridad } from "@/lib/prioridad";
import { fraseDeFaltan } from "@/lib/requisitos";
import { ordenDeLaParte } from "./publicar";

/**
 * «¿Por qué está aquí?» y «¿por qué se quedó fuera?», en datos que la pantalla pueda decir con palabras.
 *
 * El motor ya lo calcula todo (`Plan.explicaciones`, `Plan.sinAsignar`): cuánto aporta cada orden al coste, y qué
 * costaría llevarla con cada uno de los otros choferes, o por qué con ese no se puede. Aquí NO se calcula nada
 * nuevo: se elige qué decir y en qué orden. La frase la pone la pantalla, en los dos idiomas.
 */

/** Por qué con ese chofer no: lo que el motor violaría, o que ni se le puede ofrecer (fijada con otro, o parte de una orden que ya lleva otro). */
export type MotivoDeNo = TipoDeViolacion | "no_permitido" | "falta_requisito";

export interface OtraOpcion {
  choferId: string;
  chofer: string;
  /** Con ese chofer no se puede, y por qué. */
  noPuede: MotivoDeNo | null;
  /** Con `falta_requisito` (D-418): lo que el camión de ese chofer no tiene. */
  faltan?: string[];
  /** Si se puede: cuánto PEOR saldría el plan entero. Positivo = peor que como está. */
  masManejoMin: number; masMillas: number; masTardeMin: number; masBuilderMin: number;
}

export interface PorQue {
  orden: string;
  /** `motor`: lo decidió el motor, y estas son las cuentas. `persona`: alguien la puso o la movió a mano — las
   *  cuentas del motor ya no describen dónde está, así que no se enseñan. */
  quien: "motor" | "persona";
  /** Lo que esta orden le suma al plan: quitarla lo bajaría en esto. */
  aporta: { manejoMin: number; millas: number; tardeMin: number } | null;
  /** Los otros choferes, del que menos empeoraría al que más; al final, con los que no se puede. */
  otras: OtraOpcion[];
  /** La prioridad con la que la planificó el motor (D-415), solo si no era normal. Es la del momento de planificar:
   *  lo que explica la decisión, aunque alguien la haya cambiado después. */
  prioridad?: PrioridadDeOrden;
}

/** Las órdenes tal como entraron al motor: de ellas sale la prioridad con que se planificó. */
type OrdenDelPlan = { id: string; prioridad?: PrioridadDeOrden | null };
const prioridadEnElPlan = (ordenes: readonly OrdenDelPlan[] | null | undefined) => {
  const m = new Map<string, PrioridadDeOrden>();
  for (const o of ordenes ?? []) if (o.prioridad && o.prioridad !== "normal") m.set(o.id, o.prioridad);
  return m;
};
const RANGO: Record<PrioridadDeOrden, number> = { critical: 0, high: 1, normal: 2, low: 3 };

const centesimas = (n: number) => Math.round(n * 100) / 100;

export function porQueEstaAqui(
  explicaciones: readonly Explicacion[] | null | undefined,
  choferes: readonly { id: string; nombre: string }[],
  ahora: Readonly<Record<string, string>>,
  fijadas: readonly string[] = [],
  ordenes: readonly OrdenDelPlan[] | null = null,
): Record<string, PorQue> {
  const nombreDe = new Map(choferes.map((c) => [c.id, c.nombre]));
  const aMano = new Set(fijadas);
  const prioridadDe = prioridadEnElPlan(ordenes);
  const r: Record<string, PorQue> = {};
  for (const e of explicaciones ?? []) {
    const donde = ahora[e.orden];
    if (!donde) continue;                                     // ya no está en ninguna ruta
    // Si alguien la fijó o la movió, o ya no va con quien decía el motor, sus cuentas describen OTRO plan.
    if (aMano.has(e.orden) || donde !== e.chofer) { r[e.orden] = { orden: e.orden, quien: "persona", aporta: null, otras: [] }; continue; }
    // Cuánto peor, en la suma PONDERADA del motor: es la que lleva los pesos del dueño.
    const peor = new Map(e.alternativas.map((a) => [a.chofer, a.diferencia?.total ?? 0]));
    const otras = e.alternativas.map((a): OtraOpcion => {
      const d: Desglose | null = a.diferencia;
      return {
        choferId: a.chofer, chofer: nombreDe.get(a.chofer) ?? "", noPuede: d ? null : (a.motivo ?? "no_permitido"),
        masManejoMin: d?.manejoMin ?? 0, masMillas: centesimas(d?.millas ?? 0), masTardeMin: d?.tardeMin ?? 0, masBuilderMin: d?.builder ?? 0,
        ...(a.faltan?.length ? { faltan: [...a.faltan] } : {}),
      };
    }).sort((x, y) => {
      if (!!x.noPuede !== !!y.noPuede) return x.noPuede ? 1 : -1;
      return (peor.get(x.choferId) ?? 0) - (peor.get(y.choferId) ?? 0) || (x.choferId < y.choferId ? -1 : 1);
    });
    const prioridad = prioridadDe.get(ordenDeLaParte(e.orden));
    r[e.orden] = {
      orden: e.orden, quien: "motor", aporta: { manejoMin: e.aporta.manejoMin, millas: centesimas(e.aporta.millas), tardeMin: e.aporta.tardeMin }, otras,
      ...(prioridad ? { prioridad } : {}),
    };
  }
  // Una orden que está en una ruta y de la que el motor no dijo nada (la metió una persona): también se dice.
  for (const orden of Object.keys(ahora)) if (!r[orden]) r[orden] = { orden, quien: "persona", aporta: null, otras: [] };
  return r;
}

/** Lo mismo, desde lo que se guarda: el resultado del plan, sus choferes y sus paradas. Es lo que llaman las rutas.
 *  `ordenes`: las del plan tal como entraron al motor (`input.entrada.ordenes`), para decir su prioridad. */
export function porQueDelPlan(
  result: { explicaciones?: readonly Explicacion[] | null; fijadas?: readonly string[] | null } | null | undefined,
  choferes: readonly { id: string; nombre: string }[] | null | undefined,
  paradas: readonly { driver_id: string | null; order_ref: string }[],
  ordenes: readonly OrdenDelPlan[] | null = null,
): Record<string, PorQue> {
  const ahora: Record<string, string> = {};
  for (const p of paradas) if (p.driver_id) ahora[p.order_ref] = p.driver_id;
  return porQueEstaAqui(result?.explicaciones, choferes ?? [], ahora, result?.fijadas ?? [], ordenes);
}

/** Qué se puede HACER con una orden que quedó fuera. No es el motivo (ese ya lo dice el motor): es el siguiente paso. */
export type Remedio = "dar_requisito" | "poner_pin" | "revisar_choferes" | "partir_o_camion_mayor" | "cambiar_ventana" | "otro_dia_o_mas_choferes" | "cambiar_chofer_fijado" | "quitar_del_carril" | "ninguno";

const REMEDIOS: Record<string, Remedio> = {
  sin_punto: "poner_pin", sin_chofer_disponible: "revisar_choferes", supera_capacidad: "partir_o_camion_mayor", ventana_imposible: "cambiar_ventana",
  retraso_sobre_el_tope: "cambiar_ventana", fuera_de_turno: "otro_dia_o_mas_choferes", no_cabe_con_el_resto: "otro_dia_o_mas_choferes",
  chofer_fijado_sin_hueco: "cambiar_chofer_fijado", chofer_no_rutea: "cambiar_chofer_fijado", en_un_carril_manual: "quitar_del_carril",
  falta_requisito: "dar_requisito",
};

/** Los motivos en los que la orden cabía SOLA y se quedó sin sitio por las demás: ahí la prioridad pudo decidir. */
const SIN_SITIO = new Set(["no_cabe_con_el_resto", "chofer_fijado_sin_hueco"]);

export interface FueraConPorque {
  id: string; orden: string; motivo: string; remedio: Remedio; laDejoFuera: "motor" | "entrada";
  /** Su prioridad en el plan (D-415), solo si no era normal. */
  prioridad?: PrioridadDeOrden;
  /** Cuando se quedó sin sitio: cuántas órdenes de MÁS prioridad sí van en ruta. El motor coloca antes lo de más
   *  prioridad, así que son las que cogieron el sitio. Solo si hay alguna. */
  masPrioritariasDentro?: number;
  /** Con `falta_requisito` (D-418): lo que le falta al chofer que más cerca estaba de tenerlo todo. */
  faltan?: string[];
}

/** Todo lo que no va en ninguna ruta, junto: lo que el motor no pudo asignar y lo que ni le llegó. Una fila por
 *  ORDEN (no por parte), en un orden estable. `ordenes`: las del plan como entraron al motor, para la prioridad. */
export function fueraConPorque(
  sinAsignar: readonly { orden: string; motivo: string; faltan?: readonly string[] }[] | null | undefined,
  fuera: readonly { id: string; motivo: string }[] | null | undefined,
  ordenes: readonly OrdenDelPlan[] | null = null,
): FueraConPorque[] {
  const prioridadDe = prioridadEnElPlan(ordenes);
  const filas = new Map<string, FueraConPorque>();
  for (const f of fuera ?? []) filas.set(f.id, { id: f.id, orden: f.id, motivo: f.motivo, remedio: REMEDIOS[f.motivo] ?? "ninguno", laDejoFuera: "entrada" });
  for (const s of sinAsignar ?? []) {
    const id = ordenDeLaParte(s.orden);
    if (!filas.has(id)) filas.set(id, { id, orden: s.orden, motivo: s.motivo, remedio: REMEDIOS[s.motivo] ?? "ninguno", laDejoFuera: "motor", ...(s.faltan?.length ? { faltan: [...s.faltan] } : {}) });
  }
  const dentro = (ordenes ?? []).filter((o) => !filas.has(o.id));
  for (const f of filas.values()) {
    const p = prioridadDe.get(f.id);
    if (p) f.prioridad = p;
    if (f.laDejoFuera !== "motor" || !SIN_SITIO.has(f.motivo)) continue;
    const mio = RANGO[p ?? "normal"];
    const mas = dentro.filter((o) => RANGO[prioridadDe.get(o.id) ?? "normal"] < mio).length;
    if (mas > 0) f.masPrioritariasDentro = mas;
  }
  return [...filas.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ---- Las frases de la prioridad (D-415): aquí, para que la pantalla solo las pinte y una prueba las fije ----

/** Lo que se dice de la prioridad de una orden que va en ruta. `null` = normal, o la puso una persona: nada que decir. */
export function fraseDePrioridadEnRuta(q: Pick<PorQue, "quien" | "prioridad">, lang: "en" | "es"): string | null {
  if (q.quien !== "motor" || !q.prioridad) return null;
  const nombre = etiquetaDePrioridad(q.prioridad, lang);
  if (q.prioridad === "low") {
    return lang === "es" ? `Prioridad ${nombre}: es de lo primero en quedarse fuera si no cabe todo.` : `${nombre} priority: among the first to be left out if not everything fits.`;
  }
  return lang === "es"
    ? `Prioridad ${nombre}: se colocó antes que las de menos prioridad, y a igual coste va antes en su ruta.`
    : `${nombre} priority: placed before lower-priority orders, and at equal cost it goes earlier in its route.`;
}

/** Lo que se dice de la prioridad de una orden que se quedó fuera. `null` = nada que añadir al motivo. */
export function fraseDePrioridadFuera(f: Pick<FueraConPorque, "prioridad" | "masPrioritariasDentro">, lang: "en" | "es"): string | null {
  const partes: string[] = [];
  if (f.prioridad) partes.push(lang === "es" ? `Prioridad ${etiquetaDePrioridad(f.prioridad, lang)}.` : `${etiquetaDePrioridad(f.prioridad, lang)} priority.`);
  const n = f.masPrioritariasDentro ?? 0;
  if (n > 0) {
    partes.push(lang === "es"
      ? `El sitio se le dio antes a ${n} ${n === 1 ? "orden" : "órdenes"} de más prioridad.`
      : `The room went first to ${n} higher-priority ${n === 1 ? "order" : "orders"}.`);
  }
  return partes.length ? partes.join(" ") : null;
}

// ---- Requisitos del camión (D-418): las frases, aquí, para que la pantalla solo las pinte y una prueba las fije ----

/** El motivo de una orden fuera por requisitos: «falta Liftgate: ningún chofer que rutea hoy lo tiene». `null` = no es eso. */
export function fraseDeRequisitoFuera(f: Pick<FueraConPorque, "motivo" | "faltan">, lang: "en" | "es"): string | null {
  if (f.motivo !== "falta_requisito") return null;
  const lista = f.faltan ?? [];
  if (!lista.length) return lang === "es" ? "ningún chofer que rutea hoy tiene lo que pide" : "no driver routed today has what it needs";
  return lang === "es" ? `${fraseDeFaltan(lista, lang)}: ningún chofer que rutea hoy lo tiene todo` : `${fraseDeFaltan(lista, lang)}: no driver routed today has it all`;
}

/** Por qué con ese chofer no, cuando es por el camión: «falta Liftgate». `null` = es otro motivo. */
export function fraseDeRequisitoConOtro(o: Pick<OtraOpcion, "noPuede" | "faltan">, lang: "en" | "es"): string | null {
  if (o.noPuede !== "falta_requisito") return null;
  return fraseDeFaltan(o.faltan ?? [], lang) || (lang === "es" ? "su camión no tiene lo que pide" : "their truck lacks what it needs");
}
