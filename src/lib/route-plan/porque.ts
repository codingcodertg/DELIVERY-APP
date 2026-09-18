import type { Desglose, Explicacion, TipoDeViolacion } from "@/lib/route-engine";
import { ordenDeLaParte } from "./publicar";

/**
 * «¿Por qué está aquí?» y «¿por qué se quedó fuera?», en datos que la pantalla pueda decir con palabras.
 *
 * El motor ya lo calcula todo (`Plan.explicaciones`, `Plan.sinAsignar`): cuánto aporta cada orden al coste, y qué
 * costaría llevarla con cada uno de los otros choferes, o por qué con ese no se puede. Aquí NO se calcula nada
 * nuevo: se elige qué decir y en qué orden. La frase la pone la pantalla, en los dos idiomas.
 */

/** Por qué con ese chofer no: lo que el motor violaría, o que ni se le puede ofrecer (fijada con otro, o parte de una orden que ya lleva otro). */
export type MotivoDeNo = TipoDeViolacion | "no_permitido";

export interface OtraOpcion {
  choferId: string;
  chofer: string;
  /** Con ese chofer no se puede, y por qué. */
  noPuede: MotivoDeNo | null;
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
}

const centesimas = (n: number) => Math.round(n * 100) / 100;

export function porQueEstaAqui(
  explicaciones: readonly Explicacion[] | null | undefined,
  choferes: readonly { id: string; nombre: string }[],
  ahora: Readonly<Record<string, string>>,
  fijadas: readonly string[] = [],
): Record<string, PorQue> {
  const nombreDe = new Map(choferes.map((c) => [c.id, c.nombre]));
  const aMano = new Set(fijadas);
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
      };
    }).sort((x, y) => {
      if (!!x.noPuede !== !!y.noPuede) return x.noPuede ? 1 : -1;
      return (peor.get(x.choferId) ?? 0) - (peor.get(y.choferId) ?? 0) || (x.choferId < y.choferId ? -1 : 1);
    });
    r[e.orden] = { orden: e.orden, quien: "motor", aporta: { manejoMin: e.aporta.manejoMin, millas: centesimas(e.aporta.millas), tardeMin: e.aporta.tardeMin }, otras };
  }
  // Una orden que está en una ruta y de la que el motor no dijo nada (la metió una persona): también se dice.
  for (const orden of Object.keys(ahora)) if (!r[orden]) r[orden] = { orden, quien: "persona", aporta: null, otras: [] };
  return r;
}

/** Lo mismo, desde lo que se guarda: el resultado del plan, sus choferes y sus paradas. Es lo que llaman las rutas. */
export function porQueDelPlan(
  result: { explicaciones?: readonly Explicacion[] | null; fijadas?: readonly string[] | null } | null | undefined,
  choferes: readonly { id: string; nombre: string }[] | null | undefined,
  paradas: readonly { driver_id: string | null; order_ref: string }[],
): Record<string, PorQue> {
  const ahora: Record<string, string> = {};
  for (const p of paradas) if (p.driver_id) ahora[p.order_ref] = p.driver_id;
  return porQueEstaAqui(result?.explicaciones, choferes ?? [], ahora, result?.fijadas ?? []);
}

/** Qué se puede HACER con una orden que quedó fuera. No es el motivo (ese ya lo dice el motor): es el siguiente paso. */
export type Remedio = "poner_pin" | "revisar_choferes" | "partir_o_camion_mayor" | "cambiar_ventana" | "otro_dia_o_mas_choferes" | "cambiar_chofer_fijado" | "quitar_del_carril" | "ninguno";

const REMEDIOS: Record<string, Remedio> = {
  sin_punto: "poner_pin", sin_chofer_disponible: "revisar_choferes", supera_capacidad: "partir_o_camion_mayor", ventana_imposible: "cambiar_ventana",
  retraso_sobre_el_tope: "cambiar_ventana", fuera_de_turno: "otro_dia_o_mas_choferes", no_cabe_con_el_resto: "otro_dia_o_mas_choferes",
  chofer_fijado_sin_hueco: "cambiar_chofer_fijado", chofer_no_rutea: "cambiar_chofer_fijado", en_un_carril_manual: "quitar_del_carril",
};

export interface FueraConPorque { id: string; orden: string; motivo: string; remedio: Remedio; laDejoFuera: "motor" | "entrada" }

/** Todo lo que no va en ninguna ruta, junto: lo que el motor no pudo asignar y lo que ni le llegó. Una fila por
 *  ORDEN (no por parte), en un orden estable. */
export function fueraConPorque(sinAsignar: readonly { orden: string; motivo: string }[] | null | undefined, fuera: readonly { id: string; motivo: string }[] | null | undefined): FueraConPorque[] {
  const filas = new Map<string, FueraConPorque>();
  for (const f of fuera ?? []) filas.set(f.id, { id: f.id, orden: f.id, motivo: f.motivo, remedio: REMEDIOS[f.motivo] ?? "ninguno", laDejoFuera: "entrada" });
  for (const s of sinAsignar ?? []) {
    const id = ordenDeLaParte(s.orden);
    if (!filas.has(id)) filas.set(id, { id, orden: s.orden, motivo: s.motivo, remedio: REMEDIOS[s.motivo] ?? "ninguno", laDejoFuera: "motor" });
  }
  return [...filas.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
