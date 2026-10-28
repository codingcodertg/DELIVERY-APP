/**
 * El chofer toma una orden que NO es suya para recogerla (D-625, 2026-10-21; migración 188).
 *
 * El dueño: «Drivers will need to be able to search for invoice numbers that aren't assigned to them and pick them up
 * even if they're not assigned to them. That will be only exceptions».
 *
 * D-735 (2026-10-28; migración 213): «if any invoice of an order is unassign the driver can look it up and search bar
 * for the driver to look it up and add it to his routes». Una orden SIN chofer no se toma como excepción: se agrega a
 * su ruta sin motivo (`pideMotivo`), con la nota «🚚 … agregó esta orden a su ruta» (`notaDeAgregada`). Quitársela a
 * otro chofer sigue siendo la excepción de la 188, con motivo. El buscador está en la pestaña Órdenes y en «Mi ruta».
 *
 * Lo que decide vive en la base (`buscar_factura_para_recoger`, `tomar_orden_para_recoger`, 188): quién, qué etapas, el
 * motivo, y cómo se parte una factura en números (`numeros_de_factura`). Aquí van la forma del texto que se manda, la
 * lectura de los errores y las etiquetas; `numerosDeFactura` es la copia de la de la base para el modo demo, que no
 * tiene base (y una prueba fija que las dos parten igual los casos del ensayo).
 */

/** Por debajo de esto la base no busca (devuelve nada): un número de 3 cifras casa con demasiadas facturas. */
export const MINIMO_PARA_BUSCAR = 4;
/** El motivo, como en «Reprogramar» (173): tres letras o más, ya limpio. */
export const MINIMO_DEL_MOTIVO = 3;
/** La campana: el aviso a admins, logística y al chofer de antes. */
export const KIND_TOMADA_POR_CHOFER = "tomada_por_chofer";
/** Etapas en las que una orden se puede tomar: las que esperan recogida. */
export const ETAPAS_PARA_TOMAR: ReadonlySet<string> = new Set(["approved", "fulfilling", "ready"]);

/** Lo que se manda a la base: sin espacios ni '#', en mayúsculas (lo mismo que hace ella). */
export function facturaParaBuscar(texto: string | null | undefined): string {
  return (texto ?? "").replace(/[\s#]/g, "").toUpperCase();
}

export function sePuedeBuscar(texto: string | null | undefined): boolean {
  return facturaParaBuscar(texto).length >= MINIMO_PARA_BUSCAR;
}

/** Copia de `public.numeros_de_factura` (188): cada trozo, y cada trozo partido también por el guion. */
export function numerosDeFactura(s: string | null | undefined): string[] {
  const base = (s ?? "").replace(/#/g, "").toUpperCase();
  const out = new Set<string>();
  for (const t of base.split(/[^A-Z0-9-]+/)) if (t && t !== "-") out.add(t);
  for (const t of base.split(/[^A-Z0-9]+/)) if (t) out.add(t);
  return [...out];
}

export function motivoLimpio(m: string | null | undefined): string {
  return (m ?? "").replace(/\s+/g, " ").trim();
}

export function motivoValido(m: string | null | undefined): boolean {
  return motivoLimpio(m).length >= MINIMO_DEL_MOTIVO;
}

/** El motivo solo se pide cuando la orden ERA de otro chofer (213): sin chofer, agregarla a la ruta no es una excepción. */
export function pideMotivo(o: { assigned_driver: string | null | undefined }): boolean {
  return !!(o.assigned_driver ?? "").trim();
}

/** Lo que vale mandar a la base: con chofer de antes, un motivo de 3 letras o más; sin chofer, cualquier cosa (o nada). */
export function sePuedeTomar(o: { assigned_driver: string | null | undefined }, motivo: string | null | undefined): boolean {
  return !pideMotivo(o) || motivoValido(motivo);
}

/** Una fila de `buscar_factura_para_recoger`: solo lo necesario para reconocer la orden. */
export interface OrdenParaTomar {
  id: string;
  order_no: number;
  order_suffix: string | null;
  order_code: string | null;
  invoice_num: string | null;
  account: string | null;
  store: string | null;
  pickup_name: string | null;
  delivery_name: string | null;
  delivery_address: string | null;
  delivery_date: string | null;
  stage: string;
  assigned_driver: string | null;
  est_pallets: number | null;
  es_mia: boolean;
}

/** Las que se ofrecen para tomar: no son suyas ni están ya en su lista. */
export function ajenasParaTomar(filas: readonly OrdenParaTomar[], misIds: ReadonlySet<string>): OrdenParaTomar[] {
  return filas.filter((f) => !f.es_mia && !misIds.has(f.id) && ETAPAS_PARA_TOMAR.has(f.stage));
}

export function etiquetaDeLaOrden(o: Pick<OrdenParaTomar, "order_no" | "order_suffix" | "invoice_num">): string {
  const inv = (o.invoice_num ?? "").trim();
  return `#${o.order_no}${o.order_suffix ?? ""}${inv ? ` · INV ${inv}` : ""}`;
}

export type FalloAlTomar = "sin-sesion" | "no-permitido" | "etapa" | "ya-es-tuya" | "sin-motivo" | "no-existe" | "sin-funcion" | "otro";

/** Los errores de la base llevan su código delante (`TOMAR_…`); sin la función (188 sin aplicar), PostgREST dice PGRST202. */
export function falloAlTomar(e: { message?: string | null; code?: string | null } | null | undefined): FalloAlTomar {
  const m = e?.message ?? "";
  if (e?.code === "PGRST202" || /Could not find the function/i.test(m)) return "sin-funcion";
  if (m.includes("TOMAR_SIN_SESION")) return "sin-sesion";
  if (m.includes("TOMAR_NO_PERMITIDO")) return "no-permitido";
  if (m.includes("TOMAR_ETAPA")) return "etapa";
  if (m.includes("TOMAR_YA_ES_TUYA")) return "ya-es-tuya";
  if (m.includes("TOMAR_SIN_MOTIVO")) return "sin-motivo";
  if (m.includes("TOMAR_NO_EXISTE") || m.includes("TOMAR_NO_GUARDADA")) return "no-existe";
  return "otro";
}

export function mensajeDelFallo(f: FalloAlTomar, t: (en: string, es: string) => string): string {
  switch (f) {
    case "sin-sesion": return t("Your session expired: sign in again.", "Tu sesión caducó: vuelve a entrar.");
    case "no-permitido": return t("Only drivers can take an order to pick it up.", "Solo un chofer puede tomar una orden para recogerla.");
    case "etapa": return t("That order can't be taken any more (it was picked up, delivered or canceled).", "Esa orden ya no se puede tomar (ya se recogió, se entregó o se anuló).");
    case "ya-es-tuya": return t("That order is already yours.", "Esa orden ya es tuya.");
    case "sin-motivo": return t("Write why you are taking it (3 letters or more).", "Escribe por qué la tomas (3 letras o más).");
    case "no-existe": return t("That order no longer exists.", "Esa orden ya no existe.");
    case "sin-funcion": return t("This isn't turned on yet. Ask the office.", "Esto todavía no está activado. Pregunta en la oficina.");
    default: return t("Couldn't take it. Try again.", "No se pudo tomar. Inténtalo de nuevo.");
  }
}

/** La nota del historial en el modo demo (en la base la escribe la función, con el mismo texto). Con chofer de antes (188). */
export function notaDeExcepcion(a: { yo: string; antes: string; motivo: string; lang: "en" | "es" }): string {
  const m = motivoLimpio(a.motivo);
  if (a.lang === "en") return `⚠️ Exception: ${a.yo} took this order to pick it up (it was ${a.antes}'s): ${m}`;
  return `⚠️ Excepción: ${a.yo} tomó esta orden para recogerla (era de ${a.antes}): ${m}`;
}

/** La nota sin chofer de antes (213): agregada a su ruta, y el motivo solo si lo escribió. */
export function notaDeAgregada(a: { yo: string; motivo?: string | null; lang: "en" | "es" }): string {
  const m = motivoLimpio(a.motivo);
  const cola = m ? `: ${m}` : "";
  if (a.lang === "en") return `🚚 ${a.yo} added this order to their route (it had no driver)${cola}`;
  return `🚚 ${a.yo} agregó esta orden a su ruta (no tenía chofer)${cola}`;
}

/** La nota que toca, según hubiera chofer o no (lo mismo que decide la función de la base). */
export function notaAlTomar(a: { yo: string; antes: string | null | undefined; motivo: string; lang: "en" | "es" }): string {
  const antes = (a.antes ?? "").trim();
  return antes ? notaDeExcepcion({ yo: a.yo, antes, motivo: a.motivo, lang: a.lang }) : notaDeAgregada({ yo: a.yo, motivo: a.motivo, lang: a.lang });
}
