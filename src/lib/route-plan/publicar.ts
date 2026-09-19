import type { ChoferEntrada, Plan } from "@/lib/route-engine";

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
  /** El viaje: un viaje es el tramo entre dos momentos en que el camión va vacío. Empieza en 1. */
  load_no: number;
  /** La posición de su entrega DENTRO de su viaje, desde 0 — como lo numera hoy el Gestor (migración 033). */
  route_seq: number;
  load_auto: true;
}

/**
 * El viaje y el puesto de cada orden en UNA ruta, de sus paradas en orden. Es el corazón de lo que publicar escribe, sacado
 * aparte para que también lo use quien tiene que saber si una ruta SIGUE siendo la que se publicó (`./lectura-de-ruta`):
 * acepta lo mínimo de una parada, que es lo que devuelven tanto el motor como `route_plan_stops` y `my_published_stops`.
 *
 * Una orden repartida en cargas se queda con el viaje y el puesto de su PRIMERA entrega; las demás cargas ocupan puesto
 * (el camión pasa por ahí) pero no escriben nada.
 */
export function posicionesDeLaRuta(paradas: readonly { tipo: "P" | "D"; orden: string; cargaAlSalir: number }[]): { id: string; load_no: number; route_seq: number }[] {
  const r: { id: string; load_no: number; route_seq: number }[] = [];
  const vistas = new Set<string>();
  let viaje = 1, posicion = 0;
  for (const p of paradas) {
    if (p.tipo !== "D") continue;
    const id = ordenDeLaParte(p.orden);
    if (!vistas.has(id)) { vistas.add(id); r.push({ id, load_no: viaje, route_seq: posicion }); }
    posicion++;
    // Vacío: lo que venga después es otro viaje. (Si no viene nada, el número no lo lleva ninguna orden.)
    if (p.cargaAlSalir === 0) { viaje++; posicion = 0; }
  }
  return r;
}

/**
 * Lo que publicar escribe en cada orden: exactamente las cuatro columnas que ya escribe el Gestor de Rutas,
 * con el mismo significado, para que «Mi ruta», el mapa, almacén y el manifiesto no se enteren del cambio.
 *
 * Una orden partida en cargas (a/b/c) es UNA fila en la base: se queda con el viaje y la posición de su
 * PRIMERA entrega. Partirla de verdad en filas a/b es otro incremento; el plan guardado sí conserva las partes.
 */
export function escriturasAlPublicar(plan: Pick<Plan, "rutas">, choferes: readonly Pick<ChoferEntrada, "id" | "nombre">[]): EscrituraDeOrden[] {
  const nombreDe = new Map(choferes.map((c) => [c.id, c.nombre]));
  const escrituras = new Map<string, EscrituraDeOrden>();
  for (const r of plan.rutas) {
    const nombre = nombreDe.get(r.chofer);
    if (!nombre) continue;
    for (const x of posicionesDeLaRuta(r.paradas)) if (!escrituras.has(x.id)) escrituras.set(x.id, { id: x.id, assigned_driver: nombre, load_no: x.load_no, route_seq: x.route_seq, load_auto: true });
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
export function avisosAlPublicar(nuevo: PlanParaAvisar, anterior: PlanParaAvisar | null): AvisoDeRuta[] {
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
  // Un chofer que estaba en el plan anterior y ya ni aparece en el nuevo también se queda sin ruta.
  for (const [chofer, previa] of antes) {
    if (!vistos.has(chofer) && previa.paradas.length > 0) avisos.push({ chofer, motivo: "sin_ruta", paradas: 0, primeraSalida: null });
  }
  return avisos.sort((a, b) => (a.chofer < b.chofer ? -1 : a.chofer > b.chofer ? 1 : 0));
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
