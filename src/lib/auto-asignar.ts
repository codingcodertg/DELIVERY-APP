/**
 * «Auto-asignar» del Gestor de Rutas con diálogo (D-401).
 *
 * El dueño, el 2026-09-25: *«cuando le apreto autoasignar se debe abrir un dialog para seleccionar a qué conductores les
 * quiero asignar todas las órdenes, o seleccionar algunas, y que se auto-asignen optimizando la ruta»*.
 *
 * Hasta aquí «✨ Auto-asignar (N)» repartía al instante lo sin chofer del día entre TODOS los choferes disponibles, y
 * optimizar era un botón aparte («Optimizar todas las rutas»). Ahora el botón abre un diálogo que pregunta tres cosas:
 * qué órdenes, a qué choferes y si se optimiza al terminar. Aquí vive lo que el diálogo decide, sin pantalla; la
 * pantalla (`routes/page.tsx` y `components/AutoAsignarDialogo.tsx`) solo lo pinta y le pasa con qué asignar y con qué
 * optimizar.
 *
 * **Desde D-NEXT el reparto es el motor de «Planificar el día»** (`route-plan/reparto.ts`, `/api/route-plan/reparto`), y
 * ya no hay «optimizar al terminar»: el motor deja cada ruta ordenada (chofer, viaje y puesto), y pasarla después por
 * «Optimizar ruta» (`computeRoute`) la desharía. El dueño, 2026-09-27: *«quioero que hagamos mucho emfasis porque todo
 * funciona bien pero estmaos teniendo probemas en el autoassign investiga como lo hace para hacerlo mejro y que funcione
 * perfectamente»*.
 */
import type { Delivery } from "@/lib/types";
import type { OpcionDeConductor } from "@/lib/elige-conductor";
import { prioridadDe, seDestaca } from "@/lib/prioridad";
import { textoDelMotivo, type EscrituraDelReparto, type MotivoDelReparto, type PeticionDeReparto, type RespuestaDelReparto } from "@/lib/route-plan/reparto";

/** Qué órdenes reparte: todas las sin chofer del día, o solo las marcadas en la tabla «Sin asignar». */
export type AlcanceDelReparto = "todas" | "marcadas";

/** Con órdenes marcadas, el diálogo nace en «Solo las marcadas»: si alguien marcó, es que quiere esas. Si no, «Todas». */
export function alcanceInicial(marcadas: number): AlcanceDelReparto {
  return marcadas > 0 ? "marcadas" : "todas";
}

/** Las órdenes que se reparten según el alcance. «Marcadas» sin ninguna marcada no reparte nada. */
export function ordenesDelReparto(alcance: AlcanceDelReparto, delDia: readonly Delivery[], marcadas: readonly Delivery[]): Delivery[] {
  return alcance === "marcadas" ? [...marcadas] : [...delDia];
}

/** Se puede marcar un chofer en el diálogo si ese día está disponible (no de vacaciones, baja ni taller). */
export const seMarca = (o: OpcionDeConductor) => !o.noDisponible;

/**
 * Qué choferes nacen marcados. Con el filtro de chofer de arriba (D-393) en un chofer disponible, **solo ese**: el
 * filtro dice «trabajo con Diego», y repartirle a él es lo que se espera; los demás se añaden con un clic o con
 * «Todos». Sin filtro (o con el filtro en uno no disponible, o en una ruta temporal, que no entra en el reparto),
 * **todos los disponibles**: es lo que hacía «Auto-asignar» hasta hoy. Los no disponibles nunca nacen marcados.
 */
export function choferesIniciales(opciones: readonly OpcionDeConductor[]): Set<string> {
  const delFiltro = opciones.find((o) => o.delFiltro && seMarca(o));
  if (delFiltro) return new Set([delFiltro.clave]);
  return new Set(opciones.filter(seMarca).map((o) => o.clave));
}

/** «Todos»: los disponibles. Los no disponibles salen desactivados y no se marcan. */
export function todosLosChoferes(opciones: readonly OpcionDeConductor[]): Set<string> {
  return new Set(opciones.filter(seMarca).map((o) => o.clave));
}

/** «Asignar y optimizar» se enciende con algún chofer marcado y alguna orden que repartir. */
export function puedeRepartir(choferes: ReadonlySet<string>, ordenes: number): boolean {
  return choferes.size > 0 && ordenes > 0;
}

/** Una ruta que optimizar: el chofer y sus paradas del día. La usa el bucle de «Optimizar todas las rutas» del Gestor
 *  (`optimizaEstas`); desde D-NEXT el diálogo ya no optimiza. */
export interface RutaQueOptimizar { clave: string; paradas: Delivery[] }

/** Lo que queda tras repartir, juntando todos los días de la selección. */
export interface ResultadoDelReparto {
  /** Órdenes marcadas que recibieron chofer, y cuál. */
  colocadas: { id: string; chofer: string }[];
  /** Órdenes marcadas que no, con su porqué (del motor, o de antes de llegar a él). */
  sinColocar: { id: string; motivo: MotivoDelReparto }[];
  /** Escrituras que la base no aceptó: la orden cambió después de planificar, o la rechazó su guard. No se tocaron. */
  noEscritas: string[];
  /** Órdenes que ya llevaban los choferes y a las que se les cambió el puesto o el viaje para hacer sitio. */
  reordenadas: number;
  /** Choferes elegidos que el motor no pudo usar, con su porqué, sin repetir. */
  choferesFuera: { nombre: string; motivo: string }[];
  /** Los días repartidos, uno por petición. */
  dias: string[];
}

/**
 * Reparte con el motor. **Un día por petición**: la selección se parte por su fecha de entrega (con el chip «Todas» se
 * marcan órdenes de varios días), y cada día se reparte con lo que los choferes ya llevan ESE día. Mezclarlos era el
 * fallo de antes: una orden del martes ocupaba sitio del lunes. Sin fecha, no se reparte (`sin_fecha`).
 *
 * `pide` y `escribe` los pone quien llama: la pantalla pasa el servidor (o el motor en el navegador, en el demo) y
 * `updateDelivery(…, { siNoCambioDesde })`; las pruebas, dobles.
 */
export async function repartirConElMotor(e: {
  ordenes: readonly Delivery[];
  choferes: readonly string[];
  pide: (p: PeticionDeReparto) => Promise<RespuestaDelReparto>;
  escribe: (w: EscrituraDelReparto) => Promise<boolean>;
}): Promise<ResultadoDelReparto> {
  const r: ResultadoDelReparto = { colocadas: [], sinColocar: [], noEscritas: [], reordenadas: 0, choferesFuera: [], dias: [] };
  const porDia = new Map<string, string[]>();
  for (const d of e.ordenes) {
    if (!d.delivery_date) { r.sinColocar.push({ id: d.id, motivo: "sin_fecha" }); continue; }
    porDia.set(d.delivery_date, [...(porDia.get(d.delivery_date) ?? []), d.id]);
  }
  for (const fecha of [...porDia.keys()].sort()) {
    const ids = porDia.get(fecha)!;
    r.dias.push(fecha);
    let resp: RespuestaDelReparto;
    try {
      resp = await e.pide({ fecha, ordenes: ids, choferes: [...e.choferes] });
    } catch {
      for (const id of ids) r.sinColocar.push({ id, motivo: "error" });
      continue;
    }
    for (const w of resp.escrituras) {
      const ok = await e.escribe(w);
      if (!ok) r.noEscritas.push(w.id);
      else if (w.nueva) r.colocadas.push({ id: w.id, chofer: w.chofer });
      else r.reordenadas++;
    }
    r.sinColocar.push(...resp.sinColocar);
    for (const c of resp.choferesFuera) if (!r.choferesFuera.some((x) => x.nombre === c.nombre && x.motivo === c.motivo)) r.choferesFuera.push(c);
  }
  return r;
}

/**
 * El aviso al terminar: cuántas y a cuántos choferes; las que no se colocaron **con su porqué** (el del motor, no «sin
 * ubicación, sin capacidad o con la ventana ya ocupada», que era una conjetura); las altas y críticas que se quedaron
 * fuera, aparte (D-412); los choferes que no pudieron entrar; y lo que no se escribió porque cambió entretanto.
 */
export function resumenDelReparto(r: ResultadoDelReparto, orden: (id: string) => Delivery | undefined, etiqueta: (d: Delivery) => string): { en: string; es: string } {
  const n = r.colocadas.length;
  const choferes = new Set(r.colocadas.map((a) => a.chofer)).size;
  const num = (id: string) => { const d = orden(id); return `#${d ? etiqueta(d) : id}`; };
  const lista = (lang: "en" | "es") => r.sinColocar.slice(0, 6).map((s) => `${num(s.id)} (${textoDelMotivo(s.motivo, lang)})`).join(", ") + (r.sinColocar.length > 6 ? ` +${r.sinColocar.length - 6}` : "");
  const dias = r.dias.length > 1 ? { en: ` over ${r.dias.length} days`, es: ` en ${r.dias.length} días` } : { en: "", es: "" };
  const enSueltas = r.sinColocar.length ? ` · ${r.sinColocar.length} not placed: ${lista("en")}` : "";
  const esSueltas = r.sinColocar.length ? ` · ${r.sinColocar.length} sin colocar: ${lista("es")}` : "";
  // Prioridad (D-412): el motor coloca primero las críticas y las altas (D-415). Si aun así alguna se queda fuera, se dice
  // aparte: es la que alguien tiene que mirar a mano, y perdida entre «+29» no se ve.
  const urgentes = r.sinColocar.filter((s) => { const d = orden(s.id); return !!d && seDestaca(prioridadDe(d)); }).length;
  const enUrg = urgentes ? ` · ‼ ${urgentes} high/critical not placed` : "";
  const esUrg = urgentes ? ` · ‼ ${urgentes} alta(s)/crítica(s) sin colocar` : "";
  const fuera = (lang: "en" | "es") => r.choferesFuera.map((c) => `${c.nombre} (${textoDelMotivo(c.motivo, lang)})`).join(", ");
  const enFuera = r.choferesFuera.length ? ` · Left out: ${fuera("en")}` : "";
  const esFuera = r.choferesFuera.length ? ` · Quedaron fuera: ${fuera("es")}` : "";
  const enNo = r.noEscritas.length ? ` · ${r.noEscritas.length} not written (changed meanwhile or refused)` : "";
  const esNo = r.noEscritas.length ? ` · ${r.noEscritas.length} sin escribir (cambiaron entretanto o la base las rechazó)` : "";
  return {
    en: `Auto-assigned ${n} order(s) to ${choferes} driver(s)${dias.en}${enSueltas}${enUrg}${enFuera}${enNo}.`,
    es: `Auto-asignadas ${n} orden(es) a ${choferes} chofer(es)${dias.es}${esSueltas}${esUrg}${esFuera}${esNo}.`,
  };
}
