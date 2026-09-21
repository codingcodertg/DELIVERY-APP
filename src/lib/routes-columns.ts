/**
 * Las columnas de las tablas del Gestor de Rutas (D-331): cuáles hay, en qué tabla salen, y cuáles se ven por defecto.
 *
 * El dueño pidió ver el número de FACTURA en el Gestor («te pedí que viera invoice y no aparece»). Las tablas de
 * `/routes` tenían las columnas fijas y ninguna era la factura. Ahora la factura está, visible por defecto, y cada
 * quien elige qué columnas ve; la elección se guarda por persona (`user_prefs`, clave `routes_columns`).
 *
 * La primera columna (`#`, el código de la orden) y la de acciones son FIJAS: no se pueden quitar.
 */

export type TablaDelGestor = "programadas" | "sinAsignar" | "paradas";

export interface ColumnaDelGestor { key: string; en: string; es: string; tablas: readonly TablaDelGestor[]; ancho: number; indice?: number }

export const COLUMNAS_DEL_GESTOR: readonly ColumnaDelGestor[] = [
  { key: "invoice", en: "Invoice #", es: "Factura #", tablas: ["programadas", "sinAsignar"], ancho: 110 },
  { key: "account", en: "Account", es: "Cuenta", tablas: ["programadas", "sinAsignar"], ancho: 140 },
  // La dirección de entrega (D-346). El dueño: «delivery address is missing in the logistic manager schedule table».
  { key: "address", en: "Delivery Address", es: "Dirección de entrega", tablas: ["programadas", "sinAsignar"], ancho: 220 },
  { key: "store", en: "Store", es: "Tienda", tablas: ["sinAsignar"], ancho: 92 },
  { key: "driver", en: "Driver / Route", es: "Chofer / Ruta", tablas: ["programadas"], ancho: 140 },
  { key: "load", en: "Load", es: "Carga", tablas: ["programadas"], ancho: 52 },
  { key: "stop", en: "Stop", es: "Parada", tablas: ["programadas"], ancho: 52 },
  { key: "pallets", en: "Pallets", es: "Pallets", tablas: ["programadas", "sinAsignar"], ancho: 60 },
  { key: "date", en: "Delivery Date", es: "Fecha de Entrega", tablas: ["sinAsignar"], ancho: 100 },
  { key: "windows", en: "Windows", es: "Ventanas", tablas: ["programadas", "sinAsignar"], ancho: 100 },
  { key: "status", en: "Status", es: "Estado", tablas: ["sinAsignar"], ancho: 88 },
  // La tabla de PARADAS de un chofer, donde se cambia el orden (D-346): «let me configure it into columns». Sus columnas
  // eran fijas. El número de parada, el ID y las acciones siguen fijos; estas cinco se pueden quitar. `indice` es el
  // puesto que la columna ya tenía en esa tabla, que guarda su ancho por posición (`useColWidths`).
  { key: "p_type", en: "Stops: Type", es: "Paradas: Tipo", tablas: ["paradas"], ancho: 140, indice: 2 },
  { key: "p_pallets", en: "Stops: Pallets", es: "Paradas: Pallets", tablas: ["paradas"], ancho: 70, indice: 3 },
  { key: "p_address", en: "Stops: Address", es: "Paradas: Dirección", tablas: ["paradas"], ancho: 240, indice: 4 },
  { key: "p_eta", en: "Stops: ETA", es: "Paradas: Llegada", tablas: ["paradas"], ancho: 56, indice: 5 },
  { key: "p_windows", en: "Stops: Windows", es: "Paradas: Ventanas", tablas: ["paradas"], ancho: 110, indice: 6 },
];

/** Por defecto, TODAS: lo que ya se veía, más la factura. Quitar columnas es una elección, no el punto de partida. */
export const COLUMNAS_DEL_GESTOR_POR_DEFECTO: readonly string[] = [...COLUMNAS_DEL_GESTOR.map((c) => c.key), "_v2"];

/** El orden de cada tabla es el que ya tenía antes de poder elegir: la factura entra la primera y nada más se mueve. */
const ORDEN: Record<TablaDelGestor, readonly string[]> = {
  programadas: ["invoice", "account", "address", "driver", "load", "stop", "windows", "pallets"],
  sinAsignar: ["invoice", "account", "address", "store", "pallets", "date", "windows", "status"],
  paradas: ["p_type", "p_pallets", "p_address", "p_eta", "p_windows"],
};

/** Las columnas de UNA tabla, en SU orden —no en el que las marcó la persona—, y solo las elegidas. Una clave que ya
 *  no existe (una columna retirada) se ignora sin romper nada. */
export function columnasDeLaTabla(tabla: TablaDelGestor, elegidas: readonly string[]): ColumnaDelGestor[] {
  const si = new Set(elegidas);
  return ORDEN[tabla].filter((k) => si.has(k)).map((k) => COLUMNAS_DEL_GESTOR.find((c) => c.key === k)!);
}

/**
 * Las columnas que llegaron DESPUÉS de que alguien guardara las suyas (D-346).
 *
 * Lo guardado es la lista de las que se ven. Una columna nueva no está en esa lista, así que a quien ya guardó no le
 * saldría nunca — y no se distingue de «la quitó». La marca lo distingue: una lista sin `MARCA_V2` se guardó antes de
 * que existieran, y se le añaden; una lista con ella ya las conoce, y si no están es que la persona las quitó.
 */
export const MARCA_V2 = "_v2";
const NUEVAS_EN_V2: readonly string[] = ["address", "p_type", "p_pallets", "p_address", "p_eta", "p_windows"];
export function conColumnasNuevas(guardadas: readonly string[]): string[] {
  if (guardadas.includes(MARCA_V2)) return [...guardadas];
  return [...new Set([...guardadas, ...NUEVAS_EN_V2])].concat(MARCA_V2);
}

/** Los índices (puestos) de la tabla de paradas que NO se pintan: las columnas de `paradas` que la persona quitó. */
export function indicesOcultosDeParadas(elegidas: readonly string[]): Set<number> {
  const si = new Set(elegidas);
  return new Set(COLUMNAS_DEL_GESTOR.filter((c) => c.tablas.includes("paradas") && !si.has(c.key)).map((c) => c.indice!));
}

/** Marcar o desmarcar una columna. Devuelve la lista en el orden canónico, sin repetidas y sin claves desconocidas. */
export function alternaColumna(elegidas: readonly string[], key: string): string[] {
  const si = new Set(elegidas);
  if (si.has(key)) si.delete(key); else si.add(key);
  // La marca viaja siempre: lo que se guarde a partir de aquí ya conoce las columnas de D-346.
  return COLUMNAS_DEL_GESTOR.map((c) => c.key).filter((k) => si.has(k)).concat(MARCA_V2);
}
