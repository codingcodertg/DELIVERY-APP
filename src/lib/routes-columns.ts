/**
 * Las columnas de las tablas del Gestor de Rutas (D-331): cuáles hay, en qué tabla salen, y cuáles se ven por defecto.
 *
 * El dueño pidió ver el número de FACTURA en el Gestor («te pedí que viera invoice y no aparece»). Las tablas de
 * `/routes` tenían las columnas fijas y ninguna era la factura. Ahora la factura está, visible por defecto, y cada
 * quien elige qué columnas ve; la elección se guarda por persona (`user_prefs`, clave `routes_columns`).
 *
 * La primera columna (`#`, el código de la orden) y la de acciones son FIJAS: no se pueden quitar.
 */

export type TablaDelGestor = "programadas" | "sinAsignar";

export interface ColumnaDelGestor { key: string; en: string; es: string; tablas: readonly TablaDelGestor[]; ancho: number }

export const COLUMNAS_DEL_GESTOR: readonly ColumnaDelGestor[] = [
  { key: "invoice", en: "Invoice #", es: "Factura #", tablas: ["programadas", "sinAsignar"], ancho: 110 },
  { key: "account", en: "Account", es: "Cuenta", tablas: ["programadas", "sinAsignar"], ancho: 140 },
  { key: "store", en: "Store", es: "Tienda", tablas: ["sinAsignar"], ancho: 92 },
  { key: "driver", en: "Driver / Route", es: "Chofer / Ruta", tablas: ["programadas"], ancho: 140 },
  { key: "load", en: "Load", es: "Carga", tablas: ["programadas"], ancho: 52 },
  { key: "stop", en: "Stop", es: "Parada", tablas: ["programadas"], ancho: 52 },
  { key: "pallets", en: "Pallets", es: "Pallets", tablas: ["programadas", "sinAsignar"], ancho: 60 },
  { key: "date", en: "Delivery Date", es: "Fecha de Entrega", tablas: ["sinAsignar"], ancho: 100 },
  { key: "windows", en: "Windows", es: "Ventanas", tablas: ["programadas", "sinAsignar"], ancho: 100 },
  { key: "status", en: "Status", es: "Estado", tablas: ["sinAsignar"], ancho: 88 },
];

/** Por defecto, TODAS: lo que ya se veía, más la factura. Quitar columnas es una elección, no el punto de partida. */
export const COLUMNAS_DEL_GESTOR_POR_DEFECTO: readonly string[] = COLUMNAS_DEL_GESTOR.map((c) => c.key);

/** El orden de cada tabla es el que ya tenía antes de poder elegir: la factura entra la primera y nada más se mueve. */
const ORDEN: Record<TablaDelGestor, readonly string[]> = {
  programadas: ["invoice", "account", "driver", "load", "stop", "windows", "pallets"],
  sinAsignar: ["invoice", "account", "store", "pallets", "date", "windows", "status"],
};

/** Las columnas de UNA tabla, en SU orden —no en el que las marcó la persona—, y solo las elegidas. Una clave que ya
 *  no existe (una columna retirada) se ignora sin romper nada. */
export function columnasDeLaTabla(tabla: TablaDelGestor, elegidas: readonly string[]): ColumnaDelGestor[] {
  const si = new Set(elegidas);
  return ORDEN[tabla].filter((k) => si.has(k)).map((k) => COLUMNAS_DEL_GESTOR.find((c) => c.key === k)!);
}

/** Marcar o desmarcar una columna. Devuelve la lista en el orden canónico, sin repetidas y sin claves desconocidas. */
export function alternaColumna(elegidas: readonly string[], key: string): string[] {
  const si = new Set(elegidas);
  if (si.has(key)) si.delete(key); else si.add(key);
  return COLUMNAS_DEL_GESTOR.map((c) => c.key).filter((k) => si.has(k));
}
