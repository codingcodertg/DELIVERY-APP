import type { Idioma } from "@/lib/idioma";
import { appForPath } from "@/lib/app-for-path";
import { CUBO_DE_ADJUNTOS } from "@/lib/help-attachments";
import { esEscrituraBloqueada, fetchConCorte, valorDeCapacitacion } from "@/lib/timetracker/capacitacion";
import { mensajeDeLoQueNoSePractica } from "@/lib/practica/mensajes";

/**
 * El modo enseñanza, en TODAS las apps (D-626, 2026-10-21).
 *
 * El dueño: «el hub y erp no se le prende el modo enseñanza arregla eso que todas esas opciones sean a nivel general
 * del app». Medido antes: el botón de la burbuja (D-623) solo apuntaba `rtg_teaching` en el navegador, y esa bandera
 * solo la leía Entregas (su entorno de práctica, D-274) y su aviso morado vivía en la barra de Entregas. En el hub, el
 * Inventario, RR. HH. y las demás no pasaba nada: ni aviso ni protección, y lo que se cambiara se guardaba de verdad.
 *
 * Ahora es UNA bandera para todo el sitio y lo que significa en cada sitio:
 * - **Entregas**: su entorno de práctica de siempre (se trabaja sobre las órdenes reales y nada sale de la pantalla).
 * - **Time Tracker**: su modo capacitación (D-490), que la burbuja enciende y apaga a la vez.
 * - **Las demás apps** (hub, Inventario, RR. HH., Clientes, Leads, Encuestas, Promociones, Estimador): se puede mirar
 *   todo, pero NINGÚN cambio llega a la base. El corte es el mismo de Time Tracker (`fetchConCorte`): cualquier petición
 *   a la base que escribe vuelve con un 403 sin salir, y cada pantalla lo enseña como cualquier otro fallo.
 *
 * Dónde se corta: en los clientes de Supabase, que es por donde pasa toda escritura. En el navegador (sus tres clientes:
 * el general, el del Inventario y el de RR. HH.) y en el servidor (las acciones del Inventario, de RR. HH. y las rutas
 * `/api` usan los clientes de sesión y de servicio de `lib/supabase` y `lib/erp/supabase`). Los de Time Tracker ya
 * llevan su corte. Los que entran como otro usuario (`/api/impersonate…`) crean su cliente aparte a propósito: cambiar
 * de usuario sigue funcionando en enseñanza.
 *
 * **La cookie** `rtg_ensenanza` (con el idioma, en todo el sitio) es lo que leen el navegador y el servidor; la de
 * `localStorage` (`rtg_teaching`) sigue siendo la de Entregas. Las dos se escriben juntas (`escribeEnsenanza`).
 */

export const COOKIE_ENSENANZA = "rtg_ensenanza";

/** Lo que se asigna a `document.cookie` para encender (con el idioma) o apagar. En todo el sitio y sin caducidad. */
export function cookieDeEnsenanza(idioma: Idioma | null): string {
  const base = "Path=/; SameSite=Lax";
  return idioma ? `${COOKIE_ENSENANZA}=${idioma}; ${base}` : `${COOKIE_ENSENANZA}=; ${base}; Max-Age=0`;
}

/** Busca la cookie en `document.cookie` (o en una cabecera `Cookie`). */
export function ensenanzaDeLasCookies(cookies: string | null | undefined): Idioma | null {
  if (!cookies) return null;
  for (const trozo of cookies.split(";")) {
    const i = trozo.indexOf("=");
    if (i < 0) continue;
    if (trozo.slice(0, i).trim() === COOKIE_ENSENANZA) return valorDeCapacitacion(decodeURIComponent(trozo.slice(i + 1)));
  }
  return null;
}

export { valorDeCapacitacion as valorDeEnsenanza };

/**
 * Las funciones de la base (`rpc`) que la app llama y que SOLO LEEN: pasan en enseñanza. Van por POST como las que
 * escriben, así que hay que nombrarlas. Medido en producción el 2026-10-21 (`pg_proc`: estables, o volátiles sin
 * escribir nada). Una función que no esté aquí se corta: la prueba exige que cada `.rpc("…")` de `src/` esté en esta
 * lista o en la de abajo, para que una nueva no se cuele sin que alguien decida.
 */
export const RPC_QUE_SOLO_LEEN = [
  "analytics_category_stats", "analytics_store_stats", "analytics_vendor_stats", "buscar_factura_para_recoger",
  "catalog_facets", "category_browse", "dashboard_stats", "estimator_find_estimate", "estimator_pending_approvals",
  "leads_my_scope", "list_cycle_counts", "list_purchase_orders", "my_point_balance", "my_published_stops",
  "negative_balances", "phone_book", "po_receiving_detail", "product_vocabulary", "purchasing_groups", "reconcile_po",
  "reorder_report", "review_tag_facets", "rutas_del_dia", "session_gate", "store_names", "suggest_po_line_matches",
  "tutorials",
] as const;

/** Las que escriben: se cortan. Están nombradas solo para que la prueba sepa que alguien las miró. */
export const RPC_QUE_ESCRIBEN = [
  "add_product_relation", "adjust_inventory", "apply_decisions", "apply_master_import", "assign_draft_sku",
  "bulk_resolve_tag", "bulk_update_products", "confirm_external_match", "decide_request", "junta_clientes", "juntar_cargas",
  "leads_set_cap", "link_draft_to_product", "mark_survey_contacted", "merge_products", "partir_carga",
  "promo_set_round_closed", "publish_product", "publish_route_plan", "receive_manual", "receive_po", "rechaza_sugerencia_de_clientes",
  "reconcile_cycle_count", "record_cycle_count", "reentrega_como_carga", "reject_external_match",
  "remove_product_relation", "reparte_cargas", "reprogramar_orden", "resolve_review_tag", "set_po_line_product",
  "set_request_ready", "tomar_orden_para_recoger", "update_product", "upsert_acknowledgment", "upsert_purchase_order",
] as const;

/**
 * Lo que SÍ se guarda en enseñanza: hablar con la gente no es practicar con los datos. El chat (y la campana que avisa
 * al otro de un mensaje), pedir ayuda (y sus adjuntos), registrar el teléfono para los avisos y el registro de
 * seguridad (`security_events`, que no se puede perder) siguen funcionando.
 */
export const TABLAS_QUE_SIGUEN = [
  "chat_messages", "help_messages", "help_reads", "help_requests", "device_tokens", "notifications", "security_events",
] as const;
export const CUBOS_QUE_SIGUEN = [CUBO_DE_ADJUNTOS] as const;

/** ¿Esta petición se corta en enseñanza? Lo que corta Time Tracker, menos lo que lee y lo que sigue. */
export function escrituraBloqueadaEnEnsenanza(metodo: string | null | undefined, url: string): boolean {
  let ruta = url;
  try { ruta = new URL(url, "http://local").pathname; } catch { /* se mira el texto tal cual */ }
  // Además de lo de Time Tracker: las cuentas que el admin crea, cambia o borra desde Usuarios (`/api/invite`,
  // `/api/delete-user`…) van por la API de administración de Auth, no por `/rest/v1`.
  const m = (metodo || "GET").toUpperCase();
  if (ruta.includes("/auth/v1/admin/") && m !== "GET" && m !== "HEAD" && m !== "OPTIONS") return true;
  if (!esEscrituraBloqueada(metodo, url)) return false;
  const rest = ruta.split("/rest/v1/")[1];
  if (rest !== undefined) {
    if (rest.startsWith("rpc/")) return !(RPC_QUE_SOLO_LEEN as readonly string[]).includes(rest.slice(4).split("/")[0]);
    return !(TABLAS_QUE_SIGUEN as readonly string[]).includes(rest.split("/")[0]);
  }
  const cubo = ruta.split("/storage/v1/object/")[1]?.split("/")[0];
  return !(cubo && (CUBOS_QUE_SIGUEN as readonly string[]).includes(cubo));
}

/** El `fetch` de los clientes de Supabase: con la enseñanza encendida, corta lo que escribe. */
export function fetchDeEnsenanza(
  fetchReal: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  activa: () => Idioma | null | Promise<Idioma | null>,
) {
  return fetchConCorte(fetchReal, activa, { bloquea: escrituraBloqueadaEnEnsenanza, mensaje: mensajeDeLoQueNoSePractica, codigo: "ENSENANZA" });
}

/** Lo que el navegador le da a `fetchDeEnsenanza`: la cookie, leída en cada petición. Fuera del navegador, nunca. */
export function ensenanzaDelNavegador(): Idioma | null {
  return typeof document === "undefined" ? null : ensenanzaDeLasCookies(document.cookie);
}

/**
 * El aviso general sale en todas las apps menos en las que ya tienen el suyo: Entregas (su barra, con «Reiniciar
 * práctica») y Time Tracker y fichaje (el de capacitación). El hub vive en `/home` y la ruta lo da como Entregas: sí lo
 * lleva.
 */
export function avisoGeneralEnLaRuta(pathname: string | null | undefined): boolean {
  const p = pathname || "/";
  if (p === "/home" || p.startsWith("/home/")) return true;
  const app = appForPath(p);
  return app !== "deliveries" && app !== "timetracker" && app !== "clockin";
}

/**
 * Las rutas `/api` que hacen algo en el mundo real y que en práctica NO se llaman (D-628): un correo o un SMS al
 * cliente o al candidato, una llamada por RingCentral, un aviso push, crear, cambiar o borrar cuentas. No hay forma de
 * deshacerlas al salir. Las corta el middleware (`apiQueNoSePractica`) con un 403 y la cabecera `x-rtg-practica`, y el
 * aviso de la práctica lo enseña. Leer (GET) sigue pasando.
 *
 * Una prueba recorre `src/app/api` y exige que toda ruta que habla con Resend, RingCentral, Twilio, FCM o la
 * administración de Auth esté aquí o en `RUTAS_CON_EFECTO_QUE_SIGUEN`.
 */
export const RUTAS_QUE_NO_SE_PRACTICAN = [
  "/api/notify", "/api/call", "/api/push", "/api/recruiting/rc-contact", "/api/avisos-cliente",
  "/api/invite", "/api/reset-password", "/api/delete-user", "/api/user-identity", "/api/profile/password",
  "/api/route-plan/publish",
] as const;

/** Las que tienen efecto y siguen en práctica, con su porqué. */
export const RUTAS_CON_EFECTO_QUE_SIGUEN: Record<string, string> = {
  "/api/chat/send": "hablar con la gente no es practicar con los datos",
  "/api/help": "pedir ayuda tampoco",
  "/api/impersonate": "entrar como otro y volver: es cómo se enseña",
  "/api/route-plan/actuals": "solo pregunta el nombre de un chofer a Auth (getUserById)",
  "/api/route-plan/drivers-seen": "solo pregunta el nombre de un chofer a Auth (getUserById)",
  "/api/cron": "los cron no traen la cookie de nadie",
};

export function apiQueNoSePractica(metodo: string | null | undefined, ruta: string): boolean {
  const m = (metodo || "GET").toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return false;
  return RUTAS_QUE_NO_SE_PRACTICAN.some((r) => ruta === r || ruta.startsWith(r + "/"));
}

export const CABECERA_DE_CORTE = "x-rtg-practica";
