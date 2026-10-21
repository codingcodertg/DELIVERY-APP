/**
 * El chofer toma una orden que NO es suya para recogerla (D-NEXT, 2026-10-21; migración 188).
 *
 * El dueño: «Drivers will need to be able to search for invoice numbers that aren't assigned to them and pick them up
 * even if they're not assigned to them. That will be only exceptions».
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

/** La nota del historial en el modo demo (en la base la escribe la función, con el mismo texto). */
export function notaDeExcepcion(a: { yo: string; antes: string | null; motivo: string; lang: "en" | "es" }): string {
  const m = motivoLimpio(a.motivo);
  if (a.lang === "en") {
    return `⚠️ Exception: ${a.yo} took this order to pick it up${a.antes ? ` (it was ${a.antes}'s)` : " (it had no driver)"}: ${m}`;
  }
  return `⚠️ Excepción: ${a.yo} tomó esta orden para recogerla${a.antes ? ` (era de ${a.antes})` : " (no tenía chofer)"}: ${m}`;
}
