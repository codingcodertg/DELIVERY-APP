// ============================================================
// D-NEXT: cómo se NOMBRA una orden en el Recorrido (`/track`): por su número de factura.
//
// Roberto (logística), en la reunión con el dueño: «Replace ID numbers with invoice numbers in the actual pickups and
// deliveries list». El Panel (tablero) sigue enseñando todo como hasta ahora; es el Recorrido el que cambia: en la lista
// de cargas y entregas, en las paradas del plan (D-910), en los globos del mapa y en «Entregadas ese día», la orden se
// identifica por la FACTURA (`deliveries.invoice_num`), que es lo que logística y el cliente reconocen.
//
// Sin factura, se enseña el código de la orden (FW171) marcado como suplente —«#FW171 (sin factura)» en texto, o en gris
// en pantalla— para que nadie lo tome por una factura. El código nunca se pierde: va en el `title` (al pasar el ratón) y
// en la ficha de la orden, que se abre al pulsar.
//
// Puro: sin React ni base. Lo usan la página del Recorrido, `PlanContraReal` y las pruebas.
// ============================================================

import { numeroConLetra } from "./relevo-etiqueta";

/** Lo mínimo que hace falta para nombrar una orden: la factura, si la tiene, y su código. */
export interface OrdenNombrable {
  /** `invoice_num` en `deliveries`; `factura` en las paradas del plan (`/api/route-adherence`). */
  invoice_num?: string | null;
  factura?: string | null;
  /** `order_code` en `deliveries`; `codigo` en las paradas del plan. */
  order_code?: string | null;
  codigo?: string | null;
  /** De `deliveries`: la letra de una carga partida (FA100a) y el paso de un relevo (Tr-…-a), como `nombreDeLaOrden`. */
  order_suffix?: string | null;
  relay_step?: number | null;
}

export interface EtiquetaDeOrden {
  /** Lo que se enseña en grande: la factura, o «#<código>» sin ella. */
  texto: string;
  /** `true` cuando no hay factura y se enseña el código en su lugar (va en gris / con «(sin factura)»). */
  suplente: boolean;
  /** El código de la orden (FW171), para el `title` y la ficha. Vacío si tampoco hay código. */
  codigo: string;
  /** La factura limpia, o `null`. */
  factura: string | null;
}

const limpia = (x: string | null | undefined): string => (x ?? "").trim();

/** La etiqueta de una orden en el Recorrido: factura primero; sin ella, el código como suplente. */
export function etiquetaDeOrden(o: OrdenNombrable): EtiquetaDeOrden {
  const conLetra = (x: string) => (o.order_suffix != null || o.relay_step != null ? numeroConLetra(x, o) : x);
  const factura = limpia(o.invoice_num) || limpia(o.factura) || null;
  const codigo = conLetra(limpia(o.order_code) || limpia(o.codigo));
  if (factura) return { texto: conLetra(factura), suplente: false, codigo, factura: conLetra(factura) };
  return { texto: codigo ? `#${codigo}` : "—", suplente: true, codigo, factura: null };
}

type T = (en: string, es: string) => string;

/**
 * La etiqueta como UNA cadena de texto plano (globos del mapa, `title`, CSV): «12345», o «#FW171 (sin factura)» cuando se
 * enseña el código en su lugar. Es texto, no HTML: los globos de Leaflet pasan por `soloTexto()`.
 */
export function textoDeEtiqueta(e: EtiquetaDeOrden, t: T): string {
  return e.suplente ? `${e.texto} ${t("(no invoice)", "(sin factura)")}` : e.texto;
}

/** Lo que se dice al pasar el ratón: la factura y el código, para que nada se pierda. */
export function tituloDeEtiqueta(e: EtiquetaDeOrden, t: T): string {
  if (!e.factura) return e.codigo ? t(`Order ${e.codigo} · no invoice number`, `Orden ${e.codigo} · sin número de factura`) : t("No invoice number", "Sin número de factura");
  return e.codigo ? t(`Invoice ${e.factura} · order ${e.codigo}`, `Factura ${e.factura} · orden ${e.codigo}`) : t(`Invoice ${e.factura}`, `Factura ${e.factura}`);
}
