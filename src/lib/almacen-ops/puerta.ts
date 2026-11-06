/**
 * Operaciones de almacén (D-NEXT, migración 265): la puerta de cada ruta. La usa la página del SERVIDOR antes de
 * pintar nada (una URL escrita a mano a un formulario oculto no abre) y la pantalla del cliente (el demo). Sin React.
 * La base repite la regla: el guardia de `warehouse_reports` rechaza el tipo y la RLS no devuelve las filas.
 */
import type { TipoDeReporte } from "./tipos";
import { nivelDe, puedeLlenar, tiposPermitidos } from "./nivel";
import { veLosReportes, type Quien } from "./visibilidad";

export type Vista = { v: "inicio" } | { v: "nuevo"; tipo: TipoDeReporte } | { v: "mios" } | { v: "reportes" };

export function vistaPermitida(q: Quien, vista: Vista): boolean {
  switch (vista.v) {
    case "inicio": return true;
    case "nuevo": return puedeLlenar(q, vista.tipo);
    // «Mis reportes» es de quien llena algo; RR. HH. sin el módulo no llena nada.
    case "mios": return tiposPermitidos(q).length > 0;
    case "reportes": return veLosReportes(q);
  }
}

/**
 * Las tiendas que se le ofrecen (para llenar y para filtrar). El `store_admin` solo las suyas (`profiles.store` y
 * `visible_stores`): es admin de la app dentro de su tienda, y la base le rechaza un reporte de otra. Los demás, todas,
 * como siempre. Si por un dato raro no le queda ninguna, se le dejan todas: la base decide.
 */
export function tiendasPara(q: Quien, tiendas: readonly string[]): string[] {
  if (nivelDe(q) !== "store_admin") return [...tiendas];
  const mias = tiendas.filter((s) => s === q.store || (q.visible_stores ?? []).includes(s));
  return mias.length > 0 ? mias : [...tiendas];
}
