import { PARAMETROS_DE_VUELTA_POR_DEFECTO, vueltasQueNoCompensan, type OrdenParaLaVuelta, type ParametrosDeVuelta, type RecomendacionDeVuelta, type TiendaConPunto } from "@/lib/route-engine";
import { siguienteDiaDeTrabajo } from "@/lib/aprobacion-por-hora-y-cupo";
import { esIntertienda } from "@/lib/reprogramar-intertiendas";
import { esVentanaDura } from "@/lib/route-settings";
import { ETAPAS_RUTEABLES } from "@/lib/route-plan/publicar";
import { palletsDeLaOrden } from "@/lib/pallets";
import { prioridadDe } from "@/lib/prioridad";
import type { Delivery, Settings, VueltaLejanaGuardada } from "@/lib/types";

/**
 * «Recomendaciones» del Gestor de Rutas (D-NEXT): de las filas de la base y de Ajustes a lo que entiende
 * `vueltasQueNoCompensan` (el motor, `route-engine/vuelta-que-no-compensa.ts`), y lo que la pantalla necesita alrededor:
 * los parámetros guardados, la nota del historial y el «Dejar así» de cada día. La regla vive en el motor; aquí solo se
 * traduce.
 */

/** Las etapas en las que una orden tiene día pero no ha salido: las que ve y mueve el Gestor (y «Armar rutas»). */
const ETAPAS_MOVIBLES: ReadonlySet<string> = new Set(ETAPAS_RUTEABLES);
/** Las que no cuentan para nada: no son órdenes de verdad, o ya no existen. Una entregada SÍ cuenta: ese viaje se hizo. */
const ETAPAS_QUE_NO_CUENTAN: ReadonlySet<string> = new Set(["draft", "canceled", "rejected"]);

type Fila = Pick<Delivery, "id" | "stage" | "order_type" | "store" | "delivery_name" | "delivery_lat" | "delivery_lng" | "delivery_date" |
  "delivery_windows" | "est_pallets" | "actual_pallets" | "is_training"> & Partial<Pick<Delivery, "pickup_name" | "priority" | "morning_priority">>;
type AjustesQueLee = Pick<Settings, "stores" | "order_type_rules" | "route_weights" | "route_hard_windows">;

const numeroValido = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** Los parámetros vigentes: lo guardado en `route_weights.vuelta_lejana` (el mismo jsonb que los pesos del motor: sin
 *  migración), y por cada uno que falte o no sea un número mayor que cero, el de por defecto. */
export function parametrosDeVuelta(settings: Pick<Settings, "route_weights">): ParametrosDeVuelta {
  const g: VueltaLejanaGuardada = settings.route_weights?.vuelta_lejana ?? {};
  const d = PARAMETROS_DE_VUELTA_POR_DEFECTO;
  return {
    factorDeLejania: numeroValido(g.factor) ? g.factor : d.factorDeLejania,
    umbralPallets: numeroValido(g.pallets) ? g.pallets : d.umbralPallets,
    radioMi: numeroValido(g.radio_mi) ? g.radio_mi : d.radioMi,
    diasAdelante: numeroValido(g.dias) ? Math.round(g.dias) : d.diasAdelante,
  };
}

/** El nombre, tal como está en Ajustes, si es una tienda con punto; si no, `null`. */
function tiendaConPuntoDe(nombre: string | null | undefined, settings: Pick<Settings, "stores">): string | null {
  const k = (nombre ?? "").trim().toLowerCase();
  return k ? tiendasConPunto(settings).find((t) => t.nombre.trim().toLowerCase() === k)?.nombre ?? null : null;
}

/** Una fila de la base, como la lee la regla. Urgente = prioridad alta o crítica, primera hora (`morning_priority`), o
 *  ventana dura de Ajustes: las tres cosas que dicen «ese día, sí o sí». Lo que pide del camión (`requirements`) no: dice
 *  quién la lleva, no cuándo. */
export function ordenParaLaVuelta(d: Fila, settings: AjustesQueLee): OrdenParaLaVuelta {
  const prioridad = prioridadDe(d);
  const inter = esIntertienda(d.order_type, settings.order_type_rules ?? {});
  return {
    id: d.id,
    fecha: (d.delivery_date ?? "").slice(0, 10),
    intertienda: inter,
    // El origen, como lo lee «Armar rutas» (`route-plan/entrada.ts`): la tienda de recogida si es una tienda con punto, y
    // si no, la de la orden. En el demo la recogida se llama «RDZ McAllen Warehouse», que no es ninguna tienda.
    origen: tiendaConPuntoDe(d.pickup_name, settings) ?? tiendaConPuntoDe(d.store, settings),
    destino: inter ? d.delivery_name ?? null : null,
    entrega: d.delivery_lat != null && d.delivery_lng != null ? { lat: Number(d.delivery_lat), lng: Number(d.delivery_lng) } : null,
    pallets: palletsDeLaOrden(d),
    urgente: prioridad === "high" || prioridad === "critical" || d.morning_priority === true || esVentanaDura(d.delivery_windows, settings),
    movible: ETAPAS_MOVIBLES.has(d.stage),
  };
}

/** Las tiendas de Ajustes que tienen punto verificado. Sin punto no se sabe si queda lejos: no entra. */
export function tiendasConPunto(settings: Pick<Settings, "stores">): TiendaConPunto[] {
  return (settings.stores ?? [])
    .filter((s) => typeof s.lat === "number" && typeof s.lng === "number" && Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .map((s) => ({ nombre: s.name, lat: s.lat as number, lng: s.lng as number }));
}

/**
 * Las recomendaciones del día que mira el Gestor. Entran TODAS las órdenes que tiene la pantalla —las de ese día y las de
 * los siguientes, también las que ya salieron—: lo que ya va en el camión hace que el viaje ocurra igual. Un día pasado no
 * se recomienda: no se reprograma hacia atrás.
 */
export function recomendacionesDelDia(deliveries: readonly Fila[], fecha: string, settings: AjustesQueLee, hoy: string): RecomendacionDeVuelta[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha < hoy) return [];
  const ordenes = deliveries
    .filter((d) => !d.is_training && !ETAPAS_QUE_NO_CUENTAN.has(d.stage) && (d.delivery_date ?? "").slice(0, 10) >= fecha)
    .map((d) => ordenParaLaVuelta(d, settings));
  return vueltasQueNoCompensan({ fecha, ordenes, tiendas: tiendasConPunto(settings), parametros: parametrosDeVuelta(settings), siguienteDia: siguienteDiaDeTrabajo });
}

/** La nota que queda en el historial de cada orden movida: el motivo, en el idioma de quien pulsa. */
export function notaDeLaRecomendacion(r: RecomendacionDeVuelta, lang: "en" | "es"): string {
  return lang === "es" ? `Recomendación del motor: ${r.motivo.es}` : `Route engine recommendation: ${r.motivo.en}`;
}

// ---- «Dejar así», por día ---------------------------------------------------------------------------------------------

/** Lo que identifica una recomendación: la tienda, el día y las órdenes. Si entra otra carga, es otra recomendación y
 *  vuelve a salir: lo que se dejó así fue AQUELLO. */
export const claveDeRecomendacion = (r: Pick<RecomendacionDeVuelta, "tienda" | "fecha" | "ids">): string =>
  `${r.fecha}|${r.tienda.trim().toLowerCase()}|${[...r.ids].sort().join(",")}`;

/** La clave del navegador, por persona, como los avisos del Gestor (`avisos-ocultos.ts`): `user_prefs` tiene sus claves
 *  cerradas en la base, y una nueva sería migración. En otro navegador, lo dejado así vuelve a salir. */
export const claveDeDejarAsi = (userId: string): string => `rtg_routes_vuelta_dejar_asi_${userId}`;

/** Lo dejado así por esta persona. Basura, nada guardado o un navegador que niega el almacenamiento: nada. */
export function leeDejadasAsi(leer: (clave: string) => string | null, userId: string): Set<string> {
  try {
    const v = JSON.parse(leer(claveDeDejarAsi(userId)) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

/** Guarda una más, y de paso olvida las de días ya pasados (la clave empieza por la fecha): la lista no crece sin fin. */
export function guardaDejadaAsi(leer: (clave: string) => string | null, escribir: (clave: string, valor: string) => void, userId: string, claveRec: string, hoy: string): Set<string> {
  const todas = [...leeDejadasAsi(leer, userId), claveRec].filter((c) => c.slice(0, 10) >= hoy);
  const out = new Set(todas);
  try { escribir(claveDeDejarAsi(userId), JSON.stringify([...out])); } catch { /* sin almacenamiento: vale para esta visita */ }
  return out;
}
