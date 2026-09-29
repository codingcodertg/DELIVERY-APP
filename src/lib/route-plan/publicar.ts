import type { ChoferEntrada, Plan } from "@/lib/route-engine";
import { escrituraDeLaLista, type ParadaDeLaLista } from "@/lib/lista-unica";

/**
 * Publicar una ruta: lo que se DECIDE al publicar, sin red ni base (D-320). Plan en
 * `docs/PLAN-133-route-plans.md`; diseño en `docs/route-algorithm-design.md`, §7.
 *
 * Aquí vive qué se escribe en cada orden, cuándo un plan ya no vale porque las órdenes cambiaron, y a qué
 * chofer se avisa. La ruta de servidor solo ejecuta lo que esto decide.
 */

/** Una orden partida por el motor (`id#a`, `id#b`) es UNA orden en la base. */
export const ordenDeLaParte = (id: string): string => id.split("#")[0];

/** Las etapas en las que el Gestor de Rutas planifica (`routes/page.tsx`, `ROUTE_STAGES`). Una orden que
 *  ya salió de ahí —recogida, entregada, anulada— no se toca al publicar. */
export const ETAPAS_RUTEABLES: readonly string[] = ["pending", "approved", "fulfilling", "ready"];

export interface EscrituraDeOrden {
  id: string;
  /** El NOMBRE del chofer: es lo que guarda `deliveries.assigned_driver`, y de él cuelga lo que el chofer ve. */
  assigned_driver: string;
  /** El puesto de su entrega en la lista del chofer, desde 0 (D-443: seguida, ya sin viajes). */
  route_seq: number;
  /** Dónde va su recogida, en la misma escala que `route_seq` (D-443, migración 154). Sin la 154 la base lo ignora. */
  pickup_seq?: number;
  /** HISTÓRICO. Hasta D-443 era el viaje (1, 2…). Ya no se escribe: `publish_route_plan` lo deja en `null`. Solo lo traen
   *  los planes publicados antes, en `route_plans.writes`. */
  load_no?: number | null;
  load_auto: true;
}

/** La lista del chofer tal como la dejó un plan (sus paradas en orden), de lo mínimo de cada parada. Una orden repartida en
 *  cargas (`id#a`, `id#b`) es UNA orden: cuenta su PRIMERA recogida y su PRIMERA entrega; las demás cargas no escriben. */
function listaDelPlan(paradas: readonly { tipo: "P" | "D"; orden: string }[]): ParadaDeLaLista[] {
  const out: ParadaDeLaLista[] = [];
  const recogida = new Set<string>(), entregada = new Set<string>();
  for (const p of paradas) {
    const id = ordenDeLaParte(p.orden);
    if (p.tipo === "P") { if (!recogida.has(id)) { recogida.add(id); out.push({ tipo: "P", ordenes: [id], tienda: null }); } }
    else if (!entregada.has(id)) { entregada.add(id); out.push({ tipo: "D", orden: id }); }
  }
  return out;
}

/**
 * El puesto de cada orden en UNA ruta, de sus paradas en orden (D-443: una sola lista, sin viajes). Es el corazón de lo que
 * publicar escribe, sacado aparte para que también lo use quien tiene que saber si una ruta SIGUE siendo la que se publicó
 * (`./lectura-de-ruta`): acepta lo mínimo de una parada, que es lo que devuelven tanto el motor como `route_plan_stops` y
 * `my_published_stops`.
 *
 * `route_seq`: el puesto de su entrega, 0, 1, 2… seguido en todo el día. `pickup_seq`: dónde va su recogida, en la misma
 * escala (`escrituraDeLaLista`): así el Gestor y «Mi ruta» vuelven a leer la recogida donde el motor la puso, también la
 * recarga a media ruta.
 */
export function posicionesDeLaRuta(paradas: readonly { tipo: "P" | "D"; orden: string }[]): { id: string; route_seq: number; pickup_seq: number | null }[] {
  const e = escrituraDeLaLista(listaDelPlan(paradas), 0);
  return e.ids.map((id, i) => ({ id, route_seq: i, pickup_seq: e.pickupSeqById[id] ?? null }));
}

/**
 * HISTÓRICO: lo que publicar escribía hasta D-443 — el viaje (`load_no`, sube cada vez que el camión se vacía) y el puesto
 * DENTRO de ese viaje. Solo para reconocer una ruta publicada ANTES de D-443 que nadie ha tocado (`sigueElPlan`): sus
 * órdenes siguen guardadas así, y sin esto se leería como «cambió tras publicar» sin que nadie la cambiara.
 */
export function posicionesPorViajeHistoricas(paradas: readonly { tipo: "P" | "D"; orden: string; cargaAlSalir: number }[]): { id: string; load_no: number; route_seq: number }[] {
  const r: { id: string; load_no: number; route_seq: number }[] = [];
  const vistas = new Set<string>();
  let viaje = 1, posicion = 0;
  for (const p of paradas) {
    if (p.tipo !== "D") continue;
    const id = ordenDeLaParte(p.orden);
    if (!vistas.has(id)) { vistas.add(id); r.push({ id, load_no: viaje, route_seq: posicion }); }
    posicion++;
    if (p.cargaAlSalir === 0) { viaje++; posicion = 0; }
  }
  return r;
}

/**
 * Lo que publicar escribe en cada orden: el chofer, el puesto de su entrega y la posición de su recogida (D-443). El viaje
 * (`load_no`) ya no va: `publish_route_plan` lee `w->>'load_no'`, que ahora es nulo, y lo deja en `null`.
 *
 * Una orden partida en cargas (a/b/c) es UNA fila en la base: se queda con su PRIMERA recogida y su PRIMERA entrega.
 * Partirla de verdad en filas a/b es otro incremento; el plan guardado sí conserva las partes.
 */
export function escriturasAlPublicar(plan: Pick<Plan, "rutas">, choferes: readonly Pick<ChoferEntrada, "id" | "nombre">[]): EscrituraDeOrden[] {
  const nombreDe = new Map(choferes.map((c) => [c.id, c.nombre]));
  const escrituras = new Map<string, EscrituraDeOrden>();
  for (const r of plan.rutas) {
    const nombre = nombreDe.get(r.chofer);
    if (!nombre) continue;
    for (const x of posicionesDeLaRuta(r.paradas)) {
      if (escrituras.has(x.id)) continue;
      escrituras.set(x.id, { id: x.id, assigned_driver: nombre, route_seq: x.route_seq, ...(x.pickup_seq != null ? { pickup_seq: x.pickup_seq } : {}), load_auto: true });
    }
  }
  return [...escrituras.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ¿Sigue valiendo el plan? Eso lo decide `publish_route_plan` (133) contra la foto guardada en `input.ordenes`,
// dentro de la misma transacción que escribe. Aquí hubo una copia en TypeScript; nadie la llamaba y se quitó.

/** Lo mínimo de una ruta para decidir un aviso: vale igual un plan recién salido del motor que uno leído de
 *  `route_plan_stops`. */
export type RutaParaAvisar = { chofer: string; paradas: readonly { tipo: "P" | "D"; orden: string; llegada: number }[] };
export type PlanParaAvisar = { rutas: readonly RutaParaAvisar[] };

/** La ruta de un chofer reducida a lo que él notaría: qué paradas y en qué orden. Las horas no cuentan: un
 *  plan recalculado con otro tráfico no es una noticia. */
export const firmaDeRuta = (r: Pick<RutaParaAvisar, "paradas">): string => r.paradas.map((p) => `${p.tipo}:${p.orden}`).join(">");

export type AvisoDeRuta = { chofer: string; motivo: "nueva" | "cambio" | "sin_ruta"; paradas: number; primeraSalida: number | null };

/**
 * A quién se avisa al publicar: UN aviso por chofer, no uno por orden. La primera vez, a todo el que tenga
 * paradas. Al re-publicar, solo a quien le cambió la lista o el orden, y a quien se quedó sin ninguna. A
 * quien no le cambió nada, silencio.
 */
export function avisosAlPublicar(nuevo: PlanParaAvisar, anterior: PlanParaAvisar | null, sinAviso: ReadonlySet<string> = new Set()): AvisoDeRuta[] {
  const antes = new Map((anterior?.rutas ?? []).map((r) => [r.chofer, r]));
  const avisos: AvisoDeRuta[] = [];
  const vistos = new Set<string>();
  for (const r of nuevo.rutas) {
    vistos.add(r.chofer);
    const previa = antes.get(r.chofer);
    const tenia = !!previa && previa.paradas.length > 0, tiene = r.paradas.length > 0;
    if (!tiene && !tenia) continue;
    const motivo: AvisoDeRuta["motivo"] | null = !tiene ? "sin_ruta" : !tenia ? "nueva" : firmaDeRuta(previa!) !== firmaDeRuta(r) ? "cambio" : null;
    if (motivo) avisos.push({ chofer: r.chofer, motivo, paradas: r.paradas.length, primeraSalida: r.paradas[0]?.llegada ?? null });
  }
  // Un chofer que estaba en el plan anterior y ya ni aparece en el nuevo también se queda sin ruta — salvo que no entrara
  // porque su ruta está bloqueada 🔒 (`sinAviso`): sus órdenes siguen siendo suyas, y el aviso le mentiría (D-414).
  for (const [chofer, previa] of antes) {
    if (!vistos.has(chofer) && !sinAviso.has(chofer) && previa.paradas.length > 0) avisos.push({ chofer, motivo: "sin_ruta", paradas: 0, primeraSalida: null });
  }
  return avisos.sort((a, b) => (a.chofer < b.chofer ? -1 : a.chofer > b.chofer ? 1 : 0));
}

/** Los choferes que el plan dejó fuera por tener la ruta bloqueada 🔒 (`result.choferesFuera`, motivo `ruta_bloqueada`). */
export function choferesConRutaBloqueada(choferesFuera: unknown): Set<string> {
  if (!Array.isArray(choferesFuera)) return new Set();
  return new Set(choferesFuera.filter((c): c is { id: string; motivo: string } => !!c && typeof c === "object" && typeof (c as { id?: unknown }).id === "string" && (c as { motivo?: unknown }).motivo === "ruta_bloqueada").map((c) => c.id));
}

export const ROUTE_PUBLISHED_KIND = "route_published";

const hora = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** El texto del aviso. En inglés, como el resto de los avisos de la campana que escribe el sistema: no se
 *  sabe el idioma de quien lo lee. */
export function textoDelAviso(a: AvisoDeRuta, fechaISO: string): string {
  if (a.motivo === "sin_ruta") return `Your route for ${fechaISO} changed: you have no stops now`;
  const cuando = a.primeraSalida == null ? "" : `, first stop ${hora(a.primeraSalida)}`;
  const paradas = `${a.paradas} stop${a.paradas === 1 ? "" : "s"}`;
  return a.motivo === "nueva" ? `Your route for ${fechaISO} is ready: ${paradas}${cuando}` : `Your route for ${fechaISO} changed: ${paradas}${cuando}`;
}
