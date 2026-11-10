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
  "warehouse_ops_search_products", // 247 (D-883): busca productos para la merma; stable, solo lee.
  "cuentas_de_clientes", // 203: las cuentas de Clientes para el formulario de orden; solo lee.
  "busca_clientes_en_toda_la_empresa", // 215 (D-740): la búsqueda del vendedor en toda la empresa; solo lee.
  "asociados_de_la_empresa", // 249 (D-884): las empresas asociadas a una («En asociación con»); solo lee.
  "busca_clientes_para_asociar", // 250 (D-886): el buscador de asociaciones (el no admin, solo sus tiendas); solo lee.
  "asociaciones_pendientes", // 250 (D-886): las propuestas de asociación abiertas de una empresa; solo lee.
  "analytics_category_stats", "analytics_store_stats", "analytics_vendor_stats", "buscar_factura_para_recoger",
  "catalog_facets", "category_browse", "dashboard_stats", "estimator_find_estimate", "estimator_pending_approvals",
  "leads_my_scope", "list_cycle_counts", "list_purchase_orders", "my_point_balance", "my_published_stops",
  "negative_balances", "phone_book", "po_receiving_detail", "product_vocabulary", "purchasing_groups", "reconcile_po",
  "pasos_del_relevo", "reorder_report", "review_tag_facets", "rutas_del_dia", "security_gate", "session_gate", "store_names", "suggest_po_line_matches",
  "mis_tiendas_de_clientes", // 250 (D-886): las tiendas en las que busca el no admin de Clientes; stable, solo lee.
  "tutorials",
  "tutorial_view_stats", // 267 (D-913): para el admin, cuántos vieron cada tutorial; stable, solo lee.
  "warehouse_ops_count_vendors", "warehouse_ops_count_products", // 274 (D-929): proveedores y productos para la hoja de conteo; devuelven tablas, solo leen.
] as const;

/** Las que escriben: se cortan. Están nombradas solo para que la prueba sepa que alguien las miró. */
export const RPC_QUE_ESCRIBEN = [
  "warehouse_ops_file_report", // 247 (D-883): crea un reporte de Operaciones de almacén y, en los de RR. HH., su fila del expediente.
  "warehouse_ops_edit_scrap_product", // 252: el gerente vincula o corrige el producto de una merma fuera de catálogo.
  "warehouse_ops_edit_scrap_origin", // 263: el gerente corrige el origen (CRMA / nota) de una merma.
  "warehouse_ops_add_photos", "warehouse_ops_set_photo_hashes", // 268 (D-914): agrega la foto a una merma guardada sin ella; rellena las huellas de las fotos de antes.
  "warehouse_ops_set_scrap_stage", // 270 (D-921): el gerente mueve la etapa de una merma (aprobada / desechada / ajustada; admin deshace).
  "warehouse_ops_sign_scrap", "warehouse_ops_unsign_scrap", // 280 (D-957): firma / quita la firma (gerente + supervisor) de la merma; sin las dos no se aprueba.
  // 281 (D-959): grupos de aprobación — crear, firmar/quitar firma y aprobar un grupo (aprueba todas sus mermas).
  "warehouse_ops_create_scrap_group", "warehouse_ops_sign_scrap_group", "warehouse_ops_unsign_scrap_group", "warehouse_ops_approve_scrap_group",
  "security_touch_device", "security_request_access", // 229 (D-811): registran el dispositivo de la sesión y su solicitud.
  "security_note_web_block", // 232 (D-818): anota que a esta sesión se le cerró la web.
  // 273 (D-927), Mantenimiento: equipo, lista diaria, refacciones y bitácora de uso. Todas escriben.
  "warehouse_ops_save_equipment", "warehouse_ops_file_checklist", "warehouse_ops_save_part", "warehouse_ops_request_part",
  "warehouse_ops_start_usage", "warehouse_ops_stop_usage",
  // 274 (D-929), Conteos de inventario: crear, avanzar, línea, firmar, recontar, ajustar, cancelar. Todas escriben.
  "warehouse_ops_create_count", "warehouse_ops_count_advance", "warehouse_ops_count_line", "warehouse_ops_count_sign",
  "warehouse_ops_count_recount", "warehouse_ops_count_adjust", "warehouse_ops_count_cancel",
  "security_sign_out_user", // 236 (D-828): cierra todas las sesiones de una persona.
  "revisa_solicitud_de_cliente", "corrige_solicitud_de_cliente", // 242 (D-865): mandan a Revisar y corrigen una solicitud.
  "add_product_relation", "adjust_inventory", "apply_decisions", "apply_master_import", "assign_draft_sku",
  "activar_relevo", "deshacer_relevo", // 256: activan y deshacen una transferencia por relevo.
  "delete_help_request", "restore_help_request", // 262: eliminan (borrado blando) y restauran una solicitud de ayuda.
  "bulk_resolve_tag", "bulk_update_products", "confirm_external_match", "decide_request", "junta_clientes", "juntar_cargas",
  "leads_set_cap", "link_draft_to_product", "mark_survey_contacted", "merge_products", "partir_carga",
  "promo_set_round_closed", "publish_product", "publish_route_plan", "receive_manual", "receive_po", "rechaza_sugerencia_de_clientes",
  "aprueba_solicitud_de_cliente", "rechaza_solicitud_de_cliente", // 216 (D-743): deciden una solicitud de cliente nuevo.
  "aprueba_edicion_de_cliente", // 221 (D-780): aplica una edición pedida por vendedor o gerente.
  "propone_asociaciones", // 250 (D-886): añade o quita asociaciones (el admin) o crea solicitudes (los demás).
  "aprueba_asociacion", // 250 (D-886): el admin aprueba una solicitud de asociación.
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
  "/api/route-plan/publish", "/api/customers/aviso-solicitud",
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
