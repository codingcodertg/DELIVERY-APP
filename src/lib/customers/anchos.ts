/**
 * Los anchos de la lista de Clientes (D-673). Roberto Rodriguez Jr (admin), 2026-10-24, con la lista ordenada por
 * «# Stores»: «Columns should be adjustable to see info» y «Lets not wrap text so that it doesn't go down and make the
 * row thicker». La tabla pasa a ser de anchos fijos que se arrastran (`tbl-resize` y `useColWidthMap`, los de Órdenes):
 * nada salta de línea, lo que no cabe se corta con «…» y se lee en su título o ensanchando la columna. El ancho es de cada
 * navegador (como el de las tablas del Gestor); estos son solo los de partida.
 *
 * Las claves se guardan con prefijo (`claveDeAncho`): sin él, una columna que se llama igual que una de Órdenes («account»,
 * «store», «address») tomaría el ancho de partida de Órdenes (`COLUMN_WIDTHS`), que es de otra tabla.
 */
export const ANCHOS_DE_PARTIDA: Readonly<Record<string, number>> = {
  account: 260,
  store: 170,
  store_count: 115,
  concatenate: 200,
  status_store: 170, status_group: 170,
  history_store: 175, history_group: 175,
  crm_type_store: 130, crm_type_group: 130,
  associated_with: 160,
  qb_status: 160,
  activity_status: 120,
  unified_account: 240,
  rep_store: 165, rep_qb: 165, rep_history: 185,
  contact_name: 160, contact_title: 120,
  phone: 140,
  email: 240,
  website: 200,
  address: 240,
  terms: 120,
  tax_terms: 140,
  credit_limit: 110, euler_limit: 110,
  account_no: 150,
  added_batch: 90,
  house_no: 90,
  notes: 240,
  updated_at: 110,
  archived_reason: 160,
};
export const ANCHO_POR_DEFECTO = 140;
/** Lo más estrecha que se puede dejar una columna arrastrando. */
export const ANCHO_MINIMO = 60;

export const claveDeAncho = (key: string): string => `cli_${key}`;
export const anchoDePartida = (key: string): number => ANCHOS_DE_PARTIDA[key] ?? ANCHO_POR_DEFECTO;
/** La llave del navegador donde se guardan los anchos de quien mira. */
export const llaveDeAnchos = (userId: string | null | undefined): string => `rtg_customers_colw_${userId ?? "anon"}`;

/**
 * La celda «Tienda»: la tienda de la fila que se enseña y «+N» por las demás, no todas las pastillas una debajo de otra
 * (Roberto: «Instead of showing all, show store+3 or +2 so it doesnt take up more space»). Las demás, para el título.
 */
export function tiendasDeLaCelda<T extends { id: number; store: string }>(filas: readonly T[], principal: T): { principal: T; otras: T[] } {
  return { principal, otras: filas.filter((f) => f.id !== principal.id) };
}
