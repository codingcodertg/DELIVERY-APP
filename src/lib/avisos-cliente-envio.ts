import {
  ETAPAS_DEL_AVISO, TOKEN_DE_BAJA_RE, correoValido, decidirAviso, mananaEnTexas, siguienteParada, telefonoValido,
  textoDelAviso, tocaNocheAntes, tokenDeBaja, segmentosSms,
  type OrdenParaAviso, type TipoDeAviso,
} from "@/lib/avisos-cliente";
import { routeOrder } from "@/lib/dispatch";
import { paradasDelChofer } from "@/lib/ordenes-del-dia";
import type { Proveedor, ResultadoDeEnvio } from "@/lib/mensajeria";
import type { Delivery } from "@/lib/types";
import type { OrderTypeRules } from "@/lib/required";

/**
 * Avisos al cliente: LA EJECUCIÓN (D-NEXT, migración 150). Lee la base, decide con `avisos-cliente.ts`, envía por el
 * proveedor que se le INYECTA y lo deja en el registro. Las rutas (/api/cron/avisos-noche-antes, /api/avisos-cliente/*)
 * solo autorizan y crean el cliente de servicio.
 *
 * IDEMPOTENTE: un aviso por orden, tipo y DÍA de entrega. Antes de mandar nada se RECLAMA la fila de
 * `customer_notifications` con un insert que choca con la clave (delivery_id, kind, service_date); si ya estaba, no se
 * manda. El día entra en la clave porque una orden reprogramada es otra entrega: el cliente tiene que saber la fecha
 * nueva la noche antes de ella, y el aviso de la fecha vieja no le dijo nada de eso. Reclamar primero y mandar después
 * significa que un envío que falla NO se reintenta solo (queda `failed` en el registro, a la vista): se prefiere un
 * aviso perdido a dos avisos, que además se cobran dos veces.
 */

type Resultado<T> = { data: T | null; error: { message: string; code?: string } | null };
/** Lo mínimo del cliente de Supabase que se usa: así la prueba lo sustituye sin red. */
export type ClienteMinimo = { from: (tabla: string) => any };

export type Contexto = {
  db: ClienteMinimo;
  proveedor: Proveedor;
  /** «https://dominio», sin barra final: de aquí salen los enlaces de seguimiento y de baja. */
  origen: string;
  /** Bytes aleatorios para el token de baja. Por defecto, `crypto.getRandomValues`. */
  aleatorio?: () => Uint8Array;
};

export type ResultadoDeAviso =
  | { id: string; estado: "omitida"; motivo: string }
  | { id: string; estado: "ya_enviado" }
  | { id: string; estado: "enviado"; sms: string | null; correo: string | null }
  | { id: string; estado: "ensayo"; sms: string | null; correo: string | null }
  | { id: string; estado: "error"; motivo: string };

const bytesAleatorios = () => crypto.getRandomValues(new Uint8Array(12));

/** Lo que dice el registro de un envío: enviado, dry-run (sin proveedor configurado, o el stub), o fallido. */
export function estadoDelEnvio(r: ResultadoDeEnvio): "sent" | "dry_run" | "failed" {
  return r.ok ? "sent" : r.dryRun ? "dry_run" : "failed";
}

/** Las bajas que hay entre estos contactos. Sin contactos no se pregunta (`in.()` vacío en PostgREST no es «todo»,
 * pero una consulta de más tampoco hace falta). */
export async function leerBajas(db: ClienteMinimo, contactos: readonly (string | null)[]): Promise<Set<string>> {
  const lista = [...new Set(contactos.filter((c): c is string => !!c))];
  if (!lista.length) return new Set();
  const r = (await db.from("customer_notify_optouts").select("contact").in("contact", lista)) as Resultado<{ contact: string }[]>;
  if (r.error) throw new Error(`optouts: ${r.error.message}`);
  return new Set((r.data ?? []).map((x) => x.contact));
}

const contactosDe = (ordenes: readonly OrdenParaAviso[]) =>
  ordenes.flatMap((o) => [telefonoValido(o.delivery_phone), correoValido(o.customer_email)]);

/** Un aviso a una orden. Con `ensayo`, decide y NO reclama ni envía. */
export async function enviarAviso(
  ctx: Contexto, orden: OrdenParaAviso, tipo: TipoDeAviso, reglas: OrderTypeRules | undefined, bajas: ReadonlySet<string>,
  opciones: { ensayo?: boolean } = {},
): Promise<ResultadoDeAviso> {
  const d = decidirAviso(orden, tipo, reglas, bajas);
  if (!d.ok) return { id: orden.id, estado: "omitida", motivo: d.motivo };
  const dia = String(orden.delivery_date ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return { id: orden.id, estado: "omitida", motivo: "sin_fecha" };
  if (opciones.ensayo) return { id: orden.id, estado: "ensayo", sms: d.sms, correo: d.email };

  const token = tokenDeBaja((ctx.aleatorio ?? bytesAleatorios)());
  const reclamo = (await ctx.db.from("customer_notifications")
    .upsert({ delivery_id: orden.id, kind: tipo, service_date: dia, sms_to: d.sms, email_to: d.email, unsub_token: token },
      { onConflict: "delivery_id,kind,service_date", ignoreDuplicates: true })
    .select("id")) as Resultado<{ id: string }[]>;
  if (reclamo.error) return { id: orden.id, estado: "error", motivo: reclamo.error.message };
  const fila = reclamo.data?.[0];
  if (!fila) return { id: orden.id, estado: "ya_enviado" };

  const texto = textoDelAviso(orden, tipo, { seguimiento: `${ctx.origen}/track/${orden.id}`, baja: `${ctx.origen}/unsubscribe/${token}` });
  const rSms = d.sms ? await ctx.proveedor.sms(d.sms, texto.sms) : null;
  const rCorreo = d.email ? await ctx.proveedor.correo(d.email, texto.asunto, texto.correo) : null;
  const errores = [rSms, rCorreo].flatMap((r) => (r && !r.ok && !r.dryRun ? [r.error] : []));
  const proveedores = [rSms, rCorreo].flatMap((r) => (r?.ok ? [r.proveedor] : []));
  const cierre = (await ctx.db.from("customer_notifications").update({
    sms_status: rSms ? estadoDelEnvio(rSms) : null,
    email_status: rCorreo ? estadoDelEnvio(rCorreo) : null,
    sms_segments: rSms ? segmentosSms(texto.sms) : null,
    provider: proveedores.join(",") || null,
    error: errores.join(" | ").slice(0, 500) || null,
    sent_at: new Date().toISOString(),
  }).eq("id", fila.id)) as Resultado<unknown>;
  if (cierre.error) console.error("[avisos-cliente] no se pudo cerrar la fila del registro", fila.id, cierre.error.message);
  return {
    id: orden.id, estado: "enviado",
    sms: rSms ? estadoDelEnvio(rSms) : null,
    correo: rCorreo ? estadoDelEnvio(rCorreo) : null,
  };
}

type AjustesDeAvisos = {
  notify_night_before_enabled?: boolean | null;
  notify_on_the_way_enabled?: boolean | null;
  notify_night_before_hour?: number | null;
  order_type_rules?: OrderTypeRules | null;
};

async function leerAjustes(db: ClienteMinimo): Promise<Resultado<AjustesDeAvisos>> {
  return (await db.from("settings")
    .select("notify_night_before_enabled, notify_on_the_way_enabled, notify_night_before_hour, order_type_rules")
    .eq("id", 1).maybeSingle()) as Resultado<AjustesDeAvisos>;
}

export type InformeNocheAntes = {
  ok: boolean;
  error?: string;
  apagado?: boolean;
  fueraDeHora?: boolean;
  manana?: string;
  revisadas?: number;
  resultados?: ResultadoDeAviso[];
};

/** El cron de la noche antes. Apagado en Ajustes → no lee ni una orden. */
export async function ejecutarNocheAntes(ctx: Contexto, opciones: { ahora?: Date; ensayo?: boolean } = {}): Promise<InformeNocheAntes> {
  const ahora = opciones.ahora ?? new Date();
  const aj = await leerAjustes(ctx.db);
  if (aj.error) return { ok: false, error: `settings: ${aj.error.message}` };
  if (aj.data?.notify_night_before_enabled !== true) return { ok: true, apagado: true };
  if (!tocaNocheAntes(ahora, aj.data.notify_night_before_hour)) return { ok: true, fueraDeHora: true };

  const manana = mananaEnTexas(ahora);
  const r = (await ctx.db.from("deliveries").select("*")
    .eq("delivery_date", manana)
    .in("stage", [...ETAPAS_DEL_AVISO.night_before])
    .eq("is_training", false)) as Resultado<OrdenParaAviso[]>;
  if (r.error) return { ok: false, error: `deliveries: ${r.error.message}` };
  const ordenes = r.data ?? [];
  const bajas = await leerBajas(ctx.db, contactosDe(ordenes));
  const resultados: ResultadoDeAviso[] = [];
  for (const o of ordenes) {
    resultados.push(await enviarAviso(ctx, o, "night_before", aj.data.order_type_rules ?? undefined, bajas, { ensayo: opciones.ensayo }));
  }
  return { ok: !resultados.some((x) => x.estado === "error"), manana, revisadas: ordenes.length, resultados };
}

export type InformeEnCamino = { ok: boolean; error?: string; apagado?: boolean; siguiente?: string | null; resultado?: ResultadoDeAviso };

/**
 * «En camino»: el chofer acaba de recoger o entregar la orden `deliveryId`. Se recalcula SU ruta de ese día con las
 * mismas funciones que «Mi ruta» (`paradasDelChofer` + `routeOrder` + `siguienteParada`) y, si la siguiente parada ya
 * va en el camión (`picked_up`), se le avisa. Lo que diga el navegador no cuenta: todo sale de la base.
 */
export async function ejecutarEnCamino(ctx: Contexto, deliveryId: string): Promise<InformeEnCamino> {
  const aj = await leerAjustes(ctx.db);
  if (aj.error) return { ok: false, error: `settings: ${aj.error.message}` };
  if (aj.data?.notify_on_the_way_enabled !== true) return { ok: true, apagado: true };

  const o = (await ctx.db.from("deliveries").select("id, assigned_driver, delivery_date").eq("id", deliveryId).maybeSingle()) as
    Resultado<{ id: string; assigned_driver: string | null; delivery_date: string | null }>;
  if (o.error) return { ok: false, error: `deliveries: ${o.error.message}` };
  if (!o.data?.assigned_driver || !o.data.delivery_date) return { ok: true, siguiente: null };

  const ruta = (await ctx.db.from("deliveries").select("*")
    .eq("assigned_driver", o.data.assigned_driver)
    .eq("delivery_date", o.data.delivery_date)) as Resultado<Delivery[]>;
  if (ruta.error) return { ok: false, error: `deliveries: ${ruta.error.message}` };
  const ordenadas = routeOrder(paradasDelChofer(ruta.data ?? [], o.data.assigned_driver, o.data.delivery_date, "dia"));
  const siguiente = siguienteParada(ordenadas);
  if (!siguiente) return { ok: true, siguiente: null };

  const bajas = await leerBajas(ctx.db, contactosDe([siguiente]));
  const resultado = await enviarAviso(ctx, siguiente, "on_the_way", aj.data.order_type_rules ?? undefined, bajas);
  return { ok: resultado.estado !== "error", siguiente: siguiente.id, resultado };
}

/** «***-***-1234» / «j***@dominio.com»: lo que la página de baja enseña, sin dar el contacto entero a quien tenga el
 * enlace. */
export function contactoEnmascarado(c: string): string {
  if (c.includes("@")) {
    const [u, dom] = c.split("@");
    return `${u.slice(0, 1)}***@${dom}`;
  }
  return `***-***-${c.slice(-4)}`;
}

export type InformeDeBaja = { ok: true; contactos: string[] } | { ok: false; motivo: "token" | "no_encontrado" | "error"; error?: string };

/** La baja: el token dice qué aviso fue; su teléfono y su correo pasan a «no avisar», para todas las órdenes. */
export async function darDeBaja(db: ClienteMinimo, token: string): Promise<InformeDeBaja> {
  if (!TOKEN_DE_BAJA_RE.test(token)) return { ok: false, motivo: "token" };
  const r = (await db.from("customer_notifications").select("id, sms_to, email_to").eq("unsub_token", token).maybeSingle()) as
    Resultado<{ id: string; sms_to: string | null; email_to: string | null }>;
  if (r.error) return { ok: false, motivo: "error", error: r.error.message };
  if (!r.data) return { ok: false, motivo: "no_encontrado" };
  const filas = [
    ...(r.data.sms_to ? [{ contact: r.data.sms_to, channel: "sms", source_notification: r.data.id }] : []),
    ...(r.data.email_to ? [{ contact: r.data.email_to, channel: "email", source_notification: r.data.id }] : []),
  ];
  if (filas.length) {
    const w = (await db.from("customer_notify_optouts").upsert(filas, { onConflict: "contact", ignoreDuplicates: true })) as Resultado<unknown>;
    if (w.error) return { ok: false, motivo: "error", error: w.error.message };
  }
  return { ok: true, contactos: filas.map((f) => contactoEnmascarado(f.contact)) };
}

/** El dominio público para los enlaces: el de producción de Vercel si lo hay (el cron puede llegar por la URL del
 * despliegue), si no el de la petición. */
export function origenPublico(urlDeLaPeticion: string, env: Record<string, string | undefined> = process.env): string {
  const prod = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (prod) return `https://${prod.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return new URL(urlDeLaPeticion).origin;
}
