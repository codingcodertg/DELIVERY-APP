import { orderTypeRule, type OrderTypeRules } from "@/lib/required";
import { isoInTZ } from "@/lib/utils";

/**
 * Reprogramar solas las Intertiendas que no se entregaron (D-NEXT).
 *
 * El dueño, 2026-09-26: «si intertienda no se entregó ese día se reprograma automáticamente para el
 * día siguiente». Un cron de madrugada (vercel.json) llama a `/api/cron/reprogramar-intertiendas`, que
 * usa esto.
 *
 * Aquí viven dos cosas: la REGLA (pura: qué se mueve y a qué día) y la EJECUCIÓN (lee, escribe la fecha
 * y deja en el historial de qué día venía). La ruta solo autoriza y crea el cliente.
 */

/** Las etapas en las que una orden ya no se mueve: terminada, anulada, sin enviar o rechazada.
 * `pending` (esperando aprobación) y `picked_up` (cargada, sin entregar) SÍ se mueven: siguen sin
 * entregarse, que es lo único que mira la frase del dueño. */
export const ETAPAS_QUE_NO_SE_MUEVEN = ["delivered", "canceled", "draft", "rejected"] as const;

/** Una Intertienda es el tipo cuya regla es tienda-a-tienda Y tiene la tienda de quien la crea como
 * destino (`homeIsDestination`). Transfer es tienda-a-tienda pero NO «que recibe»: no entra. La regla
 * sale de Ajustes (`settings.order_type_rules`) por `orderTypeRule`, igual que en la app; no se
 * compara el nombre del tipo. */
export function esIntertienda(orderType: string | null | undefined, reglas: OrderTypeRules): boolean {
  const regla = orderTypeRule(orderType, reglas);
  return regla.storeToStore === true && regla.homeIsDestination === true;
}

export type OrdenParaReprogramar = {
  id: string;
  order_type?: string | null;
  stage?: string | null;
  delivery_date?: string | null;
  is_training?: boolean | null;
  order_code?: string | null;
  order_no?: number | null;
};

export type Movimiento = { id: string; etiqueta: string; antes: string; despues: string };

/** «Hoy» en Texas (America/Chicago) para un instante dado. El cron corre en UTC: a las 00:30 UTC
 * todavía es ayer en Texas, y eso es lo que manda. */
export const hoyEnTexas = (ahora: Date = new Date()): string => isoInTZ(ahora);

/**
 * La regla. Se mueve una orden si es Intertienda, no está en una etapa final (ver arriba), no es de
 * enseñanza, y su fecha de entrega es ANTERIOR a hoy. Se mueve a HOY: el día siguiente del que no se
 * entregó, o hoy si faltó varios días (no se reparte en días intermedios que ya pasaron). Sin fecha,
 * no se toca.
 */
export function reprogramarIntertiendas(
  ordenes: readonly OrdenParaReprogramar[],
  hoy: string,
  reglas: OrderTypeRules,
): Movimiento[] {
  const out: Movimiento[] = [];
  for (const o of ordenes) {
    if (!o.delivery_date) continue;
    if (o.is_training === true) continue;
    if ((ETAPAS_QUE_NO_SE_MUEVEN as readonly string[]).includes(String(o.stage ?? ""))) continue;
    if (!esIntertienda(o.order_type, reglas)) continue;
    const antes = o.delivery_date.slice(0, 10);
    if (!(antes < hoy)) continue;
    out.push({ id: o.id, etiqueta: o.order_code || (o.order_no != null ? `#${o.order_no}` : o.id), antes, despues: hoy });
  }
  return out;
}

/** La nota del historial. Lleva el valor anterior, para que siempre se pueda deshacer (D-372: el
 * 2026-09-23 se cambiaron 162 fechas y no se supo de qué día venían 52). */
export const notaDeReprogramacion = (antes: string, despues: string) =>
  `Reprogramada automáticamente: ${antes} → ${despues} (no se entregó)`;

/** Lo mínimo del cliente de Supabase que usa la ejecución: así la prueba lo sustituye sin red. */
type Resultado<T> = { data: T | null; error: { message: string } | null };
export type ClienteMinimo = {
  from: (tabla: string) => any;
};

export type InformeDeReprogramacion = {
  ok: boolean;
  ensayo: boolean;
  hoy: string;
  /** Los tipos que cuentan como Intertienda según Ajustes: si sale vacío, no se va a mover nada. */
  tipos: string[];
  revisadas: number;
  movidas: number;
  ordenes: Movimiento[];
  fallos: { id: string; etiqueta: string; error: string }[];
  error?: string;
};

/**
 * Lee las candidatas con la llave de servicio, aplica la regla y, salvo en ensayo, escribe.
 *
 * Por cada orden, en este orden:
 *  1. `update deliveries set delivery_date = hoy where id = … and delivery_date = antes`, pidiendo la
 *     fila de vuelta. Si vuelve vacía (alguien la movió o la entregó entre la lectura y la escritura),
 *     no se toca y se cuenta como fallo, no como movida: un UPDATE de cero filas no da error.
 *  2. el evento en `order_events` con la nota «… antes → después …».
 *  3. si el evento NO se pudo escribir, se DESHACE el paso 1 (vuelve a `antes`): una fecha cambiada
 *     sin rastro de la anterior es justo lo que no puede volver a pasar.
 */
export async function ejecutarReprogramacion(
  cliente: ClienteMinimo,
  opciones: { ahora?: Date; ensayo: boolean },
): Promise<InformeDeReprogramacion> {
  const hoy = hoyEnTexas(opciones.ahora);
  const ensayo = opciones.ensayo;
  const base = { ensayo, hoy, tipos: [] as string[], revisadas: 0, movidas: 0, ordenes: [] as Movimiento[], fallos: [] as InformeDeReprogramacion["fallos"] };

  const ajustes: Resultado<{ order_type_rules: OrderTypeRules; order_types?: string[] | null }> = await cliente
    .from("settings").select("order_type_rules, order_types").eq("id", 1).maybeSingle();
  if (ajustes.error) return { ok: false, ...base, error: `settings: ${ajustes.error.message}` };
  const reglas = (ajustes.data?.order_type_rules ?? undefined) as OrderTypeRules;
  const nombres = new Set<string>([...Object.keys(reglas ?? {}), ...(ajustes.data?.order_types ?? [])]);
  base.tipos = [...nombres].filter((t) => esIntertienda(t, reglas)).sort();

  const lista: Resultado<OrdenParaReprogramar[]> = await cliente
    .from("deliveries")
    .select("id, order_code, order_no, order_type, stage, delivery_date, is_training")
    .eq("is_training", false)
    .lt("delivery_date", hoy)
    .not("stage", "in", `(${ETAPAS_QUE_NO_SE_MUEVEN.join(",")})`);
  if (lista.error) return { ok: false, ...base, error: `deliveries: ${lista.error.message}` };
  const candidatas = lista.data ?? [];
  base.revisadas = candidatas.length;

  const movimientos = reprogramarIntertiendas(candidatas, hoy, reglas);
  if (ensayo) return { ok: true, ...base, movidas: movimientos.length, ordenes: movimientos };

  for (const m of movimientos) {
    const cambio: Resultado<{ id: string }[]> = await cliente
      .from("deliveries").update({ delivery_date: m.despues }).eq("id", m.id).eq("delivery_date", m.antes).select("id");
    if (cambio.error || !cambio.data || cambio.data.length === 0) {
      base.fallos.push({ id: m.id, etiqueta: m.etiqueta, error: cambio.error?.message ?? "no se cambió ninguna fila (ya la movió o la cerró alguien)" });
      continue;
    }
    const evento: Resultado<unknown> = await cliente
      .from("order_events").insert({ delivery_id: m.id, kind: "edited", note: notaDeReprogramacion(m.antes, m.despues), created_by: null });
    if (evento.error) {
      await cliente.from("deliveries").update({ delivery_date: m.antes }).eq("id", m.id).eq("delivery_date", m.despues);
      base.fallos.push({ id: m.id, etiqueta: m.etiqueta, error: `historial: ${evento.error.message} (fecha devuelta a ${m.antes})` });
      continue;
    }
    base.ordenes.push(m);
  }
  base.movidas = base.ordenes.length;
  return { ok: base.fallos.length === 0, ...base };
}
