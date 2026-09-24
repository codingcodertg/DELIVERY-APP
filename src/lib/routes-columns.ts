/**
 * Las columnas de las tablas del Gestor de Rutas (D-331): cuáles hay, en qué tabla salen, y cuáles se ven por defecto.
 *
 * El dueño pidió ver el número de FACTURA en el Gestor («te pedí que viera invoice y no aparece»). Las tablas de
 * `/routes` tenían las columnas fijas y ninguna era la factura. Ahora la factura está, visible por defecto, y cada
 * quien elige qué columnas ve; la elección se guarda por persona (`user_prefs`, clave `routes_columns`).
 *
 * La primera columna (`#`, el código de la orden) y la de acciones son FIJAS: no se pueden quitar.
 *
 * D-NEXT: la pestaña «Programadas» ya no existe —el dueño: «el view programados es innecesario»—, y con ella se fueron
 * las tres columnas que solo salían ahí (chofer, carga, parada). Quedan dos tablas: «Sin asignar» y la de paradas de
 * cada chofer. Una lista guardada que aún las nombre no rompe nada: una clave que ya no está en el catálogo se ignora.
 */

export type TablaDelGestor = "sinAsignar" | "paradas";

export interface ColumnaDelGestor {
  key: string; en: string; es: string; tablas: readonly TablaDelGestor[]; ancho: number;
  /** El puesto que la columna ya tenía en la tabla de paradas, que guarda su ancho por posición (`useColWidths`). Solo
   *  las cinco de D-346; las que llegaron después se guardan por clave y no llevan puesto. */
  indice?: number;
  /** La columna de Órdenes (`ORDER_COLUMNS`) de la que esta toma la celda, el valor para ordenar y filtrar, y la
   *  etiqueta del filtro (D-NEXT). Así «Costo» se pinta aquí exactamente como en Órdenes, con su bandera roja. */
  deOrdenes?: string;
  /** No sale por defecto: se elige en ⚙ Columnas. */
  oculta?: true;
}

export const COLUMNAS_DEL_GESTOR: readonly ColumnaDelGestor[] = [
  { key: "invoice", en: "Invoice #", es: "Factura #", tablas: ["sinAsignar"], ancho: 110 },
  { key: "account", en: "Account", es: "Cuenta", tablas: ["sinAsignar"], ancho: 140 },
  // La dirección de entrega (D-346). El dueño: «delivery address is missing in the logistic manager schedule table».
  { key: "address", en: "Delivery Address", es: "Dirección de entrega", tablas: ["sinAsignar"], ancho: 220 },
  // Dónde recoge (D-353). El dueño: «en logistic manager table también quiero ver dónde recoge».
  { key: "pickup", en: "Pickup", es: "Recogida", tablas: ["sinAsignar"], ancho: 160 },
  { key: "store", en: "Store", es: "Tienda", tablas: ["sinAsignar"], ancho: 92 },
  { key: "pallets", en: "Pallets", es: "Pallets", tablas: ["sinAsignar"], ancho: 60 },
  { key: "date", en: "Delivery Date", es: "Fecha de Entrega", tablas: ["sinAsignar"], ancho: 100 },
  { key: "windows", en: "Windows", es: "Ventanas", tablas: ["sinAsignar"], ancho: 100 },
  // Era «Status / Estado» y pintaba lo mismo que la «Etapa» de Órdenes: la etapa de la orden, en su pastilla de color.
  // Desde D-NEXT se llama como en Órdenes y se pinta con su celda. La clave sigue siendo `status`: es la que está guardada.
  { key: "status", en: "Stage", es: "Etapa", tablas: ["sinAsignar"], ancho: 88, deOrdenes: "stage" },
  // Las de Órdenes que el Gestor no tenía (D-NEXT). El dueño: «las mismas columnas que se miran en órdenes quiero que se
  // miren en el logistic manager». Mismo rótulo, misma celda, mismo valor para ordenar y filtrar.
  { key: "type", en: "Type", es: "Tipo", tablas: ["sinAsignar"], ancho: 96, deOrdenes: "type" },
  { key: "so", en: "SO #", es: "SO #", tablas: ["sinAsignar"], ancho: 72, deOrdenes: "so" },
  { key: "po", en: "PO #", es: "PO #", tablas: ["sinAsignar"], ancho: 72, deOrdenes: "po" },
  { key: "fee", en: "Fee", es: "Costo", tablas: ["sinAsignar"], ancho: 72, deOrdenes: "fee" },
  { key: "contact", en: "Contact", es: "Contacto", tablas: ["sinAsignar"], ancho: 116, deOrdenes: "contact" },
  // La tabla de PARADAS de un chofer, donde se cambia el orden (D-346): «let me configure it into columns». Sus columnas
  // eran fijas. El número de parada, el ID y las acciones siguen fijos; estas cinco se pueden quitar. `indice` es el
  // puesto que la columna ya tenía en esa tabla, que guarda su ancho por posición (`useColWidths`).
  { key: "p_type", en: "Stops: Type", es: "Paradas: Tipo", tablas: ["paradas"], ancho: 140, indice: 2 },
  { key: "p_pallets", en: "Stops: Pallets", es: "Paradas: Pallets", tablas: ["paradas"], ancho: 70, indice: 3 },
  { key: "p_address", en: "Stops: Address", es: "Paradas: Dirección", tablas: ["paradas"], ancho: 240, indice: 4 },
  { key: "p_eta", en: "Stops: ETA", es: "Paradas: Llegada", tablas: ["paradas"], ancho: 56, indice: 5 },
  { key: "p_windows", en: "Stops: Windows", es: "Paradas: Ventanas", tablas: ["paradas"], ancho: 110, indice: 6 },
  // Las de Órdenes que la tabla de paradas no tenía (D-NEXT). NO salen por defecto: esta tabla es donde se cambia el orden
  // con las flechas de la derecha, y ocho columnas más las sacarían de la pantalla (medido: ver la decisión). Se eligen
  // en su ⚙. Ni el chofer —la tabla ES la de un chofer— ni la factura —ya sale bajo el ID—.
  { key: "p_stage", en: "Stops: Stage", es: "Paradas: Etapa", tablas: ["paradas"], ancho: 108, deOrdenes: "stage", oculta: true },
  { key: "p_store", en: "Stops: Store", es: "Paradas: Tienda", tablas: ["paradas"], ancho: 128, deOrdenes: "store", oculta: true },
  { key: "p_account", en: "Stops: Account", es: "Paradas: Cuenta", tablas: ["paradas"], ancho: 184, deOrdenes: "account", oculta: true },
  { key: "p_so", en: "Stops: SO #", es: "Paradas: SO #", tablas: ["paradas"], ancho: 72, deOrdenes: "so", oculta: true },
  { key: "p_po", en: "Stops: PO #", es: "Paradas: PO #", tablas: ["paradas"], ancho: 72, deOrdenes: "po", oculta: true },
  { key: "p_date", en: "Stops: Delivery Date", es: "Paradas: Fecha entrega", tablas: ["paradas"], ancho: 112, deOrdenes: "date", oculta: true },
  { key: "p_fee", en: "Stops: Fee", es: "Paradas: Costo", tablas: ["paradas"], ancho: 72, deOrdenes: "fee", oculta: true },
  { key: "p_contact", en: "Stops: Contact", es: "Paradas: Contacto", tablas: ["paradas"], ancho: 116, deOrdenes: "contact", oculta: true },
];

/** Por defecto, todas menos las marcadas `oculta`: lo que ya se veía, más la factura y lo nuevo de «Sin asignar». Quitar
 *  columnas es una elección, no el punto de partida. */
export const COLUMNAS_DEL_GESTOR_POR_DEFECTO: readonly string[] = [...COLUMNAS_DEL_GESTOR.filter((c) => !c.oculta).map((c) => c.key), "_v2", "_v3", "_v4"];

/** El orden de cada tabla es el que ya tenía antes de poder elegir: la factura entra la primera y nada más se mueve.
 *  Lo que llega después va al final. */
const ORDEN: Record<TablaDelGestor, readonly string[]> = {
  sinAsignar: ["invoice", "account", "pickup", "address", "store", "pallets", "date", "windows", "status", "type", "so", "po", "fee", "contact"],
  paradas: ["p_type", "p_pallets", "p_address", "p_eta", "p_windows", "p_stage", "p_store", "p_account", "p_so", "p_po", "p_date", "p_fee", "p_contact"],
};

/** Las columnas de UNA tabla, en SU orden —no en el que las marcó la persona—, y solo las elegidas. Una clave que ya
 *  no existe (una columna retirada) se ignora sin romper nada. */
export function columnasDeLaTabla(tabla: TablaDelGestor, elegidas: readonly string[]): ColumnaDelGestor[] {
  const si = new Set(elegidas);
  return ORDEN[tabla].filter((k) => si.has(k)).map((k) => COLUMNAS_DEL_GESTOR.find((c) => c.key === k)!);
}

/**
 * La columna de Órdenes que pinta la columna `clave` del Gestor, o nada si el Gestor la pinta a su manera (D-NEXT).
 * Recibe el catálogo de Órdenes en vez de importarlo: ese catálogo vive en un componente con JSX, y esto se prueba sin él.
 */
export function columnaDeOrdenes<T extends { key: string }>(clave: string, catalogoDeOrdenes: readonly T[]): T | undefined {
  const deOrdenes = COLUMNAS_DEL_GESTOR.find((c) => c.key === clave)?.deOrdenes;
  return deOrdenes ? catalogoDeOrdenes.find((o) => o.key === deOrdenes) : undefined;
}

/**
 * El ancho de partida de la columna `clave` del Gestor si viene de Órdenes: el MISMO que tiene allí (`COLUMN_WIDTHS`, que
 * la página pasa), para que la pastilla de etapa no salga cortada aquí y entera allí. Sin columna de Órdenes, nada: manda
 * el ancho general de la tabla. Lo que la persona ya arrastró sigue mandando sobre esto.
 */
export function anchoDePartida(clave: string, anchosDeOrdenes: Readonly<Record<string, number>>): number | undefined {
  const deOrdenes = COLUMNAS_DEL_GESTOR.find((c) => c.key === clave)?.deOrdenes;
  return deOrdenes ? anchosDeOrdenes[deOrdenes] : undefined;
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
// D-353 llegó después de que alguien pudiera tener ya la marca v2: segunda tanda, con su propia marca.
export const MARCA_V3 = "_v3";
const NUEVAS_EN_V3: readonly string[] = ["pickup"];
// D-NEXT: las de Órdenes en «Sin asignar». Solo las que salen por defecto; las de paradas nacen ocultas y no se añaden.
export const MARCA_V4 = "_v4";
const NUEVAS_EN_V4: readonly string[] = ["type", "so", "po", "fee", "contact"];
export function conColumnasNuevas(guardadas: readonly string[]): string[] {
  let lista = guardadas.includes(MARCA_V2) ? [...guardadas] : [...new Set([...guardadas, ...NUEVAS_EN_V2])].concat(MARCA_V2);
  if (!lista.includes(MARCA_V3)) lista = [...new Set([...lista, ...NUEVAS_EN_V3])].concat(MARCA_V3);
  if (!lista.includes(MARCA_V4)) lista = [...new Set([...lista, ...NUEVAS_EN_V4])].concat(MARCA_V4);
  return lista;
}

/** Los índices (puestos) de la tabla de paradas que NO se pintan: las columnas de `paradas` CON puesto que la persona
 *  quitó. Las que no tienen puesto van por `extrasDeParadas`. */
export function indicesOcultosDeParadas(elegidas: readonly string[]): Set<number> {
  const si = new Set(elegidas);
  return new Set(COLUMNAS_DEL_GESTOR.filter((c) => c.tablas.includes("paradas") && c.indice != null && !si.has(c.key)).map((c) => c.indice!));
}

/** Las columnas de paradas SIN puesto que la persona eligió (D-NEXT), en su orden: van entre «Ventanas» y las acciones. */
export function extrasDeParadas(elegidas: readonly string[]): ColumnaDelGestor[] {
  return columnasDeLaTabla("paradas", elegidas).filter((c) => c.indice == null);
}

/** Marcar o desmarcar una columna. Devuelve la lista en el orden canónico, sin repetidas y sin claves desconocidas. */
export function alternaColumna(elegidas: readonly string[], key: string): string[] {
  const si = new Set(elegidas);
  if (si.has(key)) si.delete(key); else si.add(key);
  // Las marcas viajan siempre: lo que se guarde a partir de aquí ya conoce las columnas de cada tanda.
  return COLUMNAS_DEL_GESTOR.map((c) => c.key).filter((k) => si.has(k)).concat(MARCA_V2, MARCA_V3, MARCA_V4);
}
