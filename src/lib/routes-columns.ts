/**
 * Las columnas de las tablas del Gestor de Rutas (D-331): cuáles hay, en qué tabla salen, y cuáles se ven por defecto.
 *
 * El dueño pidió ver el número de FACTURA en el Gestor («te pedí que viera invoice y no aparece»). Las tablas de
 * `/routes` tenían las columnas fijas y ninguna era la factura. Ahora la factura está, visible por defecto, y cada
 * quien elige qué columnas ve; la elección se guarda por persona (`user_prefs`, clave `routes_columns`).
 *
 * La primera columna (`#`, el código de la orden) y la de acciones son FIJAS: no se pueden quitar.
 * D-408: la del código de orden ya no está. El dueño: «routes manager doesn't need to see id». Lo FIJO ahora es la
 * factura (`fija`), que es la que abre la orden en las dos tablas; y la «Dirección de entrega» enseña solo la ciudad
 * («Ciudad de entrega»; el dueño: «que salga delivery city y solo salga la city donde se entrega»).
 *
 * D-376: la pestaña «Programadas» ya no existe —el dueño: «el view programados es innecesario»—, y con ella se fueron
 * las tres columnas que solo salían ahí (chofer, carga, parada). Quedan dos tablas: «Sin asignar» y la de paradas de
 * cada chofer. Una lista guardada que aún las nombre no rompe nada: una clave que ya no está en el catálogo se ignora.
 *
 * D-402: «Sin asignar» sale en el MISMO orden que Órdenes vista por ventas. El dueño: «quiero que la tabla que se hizo en
 * logistic manager tenga el mismo orden que en order view de sales». Ese orden es el de partida de Órdenes
 * (`ORDEN_DE_PARTIDA`, D-347), que se LEE de allí, no se copia: si Órdenes cambia su orden, el Gestor lo sigue.
 */

import { ORDEN_DE_PARTIDA, mueveColumna, ordenEfectivo } from "./orden-de-columnas";

export type TablaDelGestor = "sinAsignar" | "paradas";

export interface ColumnaDelGestor {
  key: string; en: string; es: string; tablas: readonly TablaDelGestor[]; ancho: number;
  /** El puesto que la columna tenía en la tabla de paradas cuando esa tabla guardaba los anchos por posición
   *  (`rtg_routes_stops8`). Solo las cinco de D-346. Desde D-410 las columnas de paradas se mueven y los anchos van por
   *  clave: el puesto ya no pinta nada, solo dice de qué casilla del ancho viejo se hereda (`anchosDeParadasHeredados`). */
  indice?: number;
  /** La columna de Órdenes (`ORDER_COLUMNS`) de la que esta toma la celda, el valor para ordenar y filtrar, y la
   *  etiqueta del filtro (D-376). Así «Costo» se pinta aquí exactamente como en Órdenes, con su bandera roja. */
  deOrdenes?: string;
  /** No sale por defecto: se elige en ⚙ Columnas. */
  oculta?: true;
  /** Para una columna de «Sin asignar» que Órdenes no tiene (D-402): la columna del Gestor delante de la cual va. */
  antesDe?: string;
  /** Sale SIEMPRE y no está en el ⚙ (D-408): la factura, que abre la orden. Una lista guardada sin ella no la esconde. */
  fija?: true;
  /** Va la ÚLTIMA de «Sin asignar» aunque Órdenes la tenga en otro puesto (D-412, la prioridad). Es para una columna que
   *  nace escondida: en medio de las que se ven, mover una vecina arriba y abajo la dejaría a un lado distinto del de
   *  partida, y «Restablecer orden» saldría sin que se viera nada movido (`mueveColumna` salta las escondidas hacia un
   *  lado). Al final no estorba, como las escondidas de paradas. */
  alFinal?: true;
}

/** La columna de Órdenes que ocupa el puesto de esta en el orden de ventas (D-402): la de `deOrdenes`, o la de su misma
 *  clave —«Factura», «Cuenta», «Dirección», «Tienda», «Pallets», «Fecha» y «Ventanas» se llaman igual en las dos tablas
 *  y enseñan el mismo dato—. Nada si Órdenes no la tiene (la recogida). */
export function claveEnOrdenes(c: ColumnaDelGestor): string | undefined {
  const k = c.deOrdenes ?? c.key;
  return ORDEN_DE_PARTIDA.includes(k) ? k : undefined;
}

/**
 * El catálogo, con las de «Sin asignar» en el orden de Órdenes (D-402). Se ordena el CATÁLOGO, no cada pantalla —como
 * hizo D-347 en Órdenes—, para que la tabla, la lista del ⚙ y las plantillas salgan en el mismo orden sin tocar la
 * página. Una columna sin equivalente en Órdenes va justo delante de su `antesDe`, y si no tiene, al final. Las de
 * paradas no se mueven: van detrás, en el orden en que están escritas.
 */
export function enOrdenDeVentas(catalogo: readonly ColumnaDelGestor[]): ColumnaDelGestor[] {
  const puesto = (c: ColumnaDelGestor): number => {
    if (c.alFinal) return ORDEN_DE_PARTIDA.length + 1;
    const k = claveEnOrdenes(c);
    if (k) return ORDEN_DE_PARTIDA.indexOf(k);
    const vecina = c.antesDe ? catalogo.find((x) => x.key === c.antesDe) : undefined;
    return vecina ? puesto(vecina) - 0.5 : ORDEN_DE_PARTIDA.length;
  };
  const sinAsignar = catalogo.filter((c) => c.tablas.includes("sinAsignar")).sort((a, b) => puesto(a) - puesto(b));
  return [...sinAsignar, ...catalogo.filter((c) => !c.tablas.includes("sinAsignar"))];
}

export const COLUMNAS_DEL_GESTOR: readonly ColumnaDelGestor[] = enOrdenDeVentas([
  // Fija desde D-408: sin la columna del ID es lo que abre la orden, y esconderla dejaría la fila sin nada que pulsar.
  { key: "invoice", en: "Invoice #", es: "Factura #", tablas: ["sinAsignar"], ancho: 110, fija: true },
  { key: "account", en: "Account", es: "Cuenta", tablas: ["sinAsignar"], ancho: 140 },
  // La dirección de entrega (D-346). El dueño: «delivery address is missing in the logistic manager schedule table».
  // Desde D-408 enseña solo la CIUDAD (`ciudadDeEntrega`); la dirección entera, al pasar el ratón. La clave sigue siendo
  // `address`, como `status` más abajo: es la que está guardada en las listas y en las plantillas, y así no se mapea nada.
  { key: "address", en: "Delivery City", es: "Ciudad de entrega", tablas: ["sinAsignar"], ancho: 120 },
  // Dónde recoge (D-353). El dueño: «en logistic manager table también quiero ver dónde recoge». Órdenes no la tiene: va
  // justo delante de la dirección de entrega, de dónde sale a dónde va (D-402).
  { key: "pickup", en: "Pickup", es: "Recogida", tablas: ["sinAsignar"], ancho: 160, antesDe: "address" },
  { key: "store", en: "Store", es: "Tienda", tablas: ["sinAsignar"], ancho: 92 },
  { key: "pallets", en: "Pallets", es: "Pallets", tablas: ["sinAsignar"], ancho: 60 },
  { key: "date", en: "Delivery Date", es: "Fecha de Entrega", tablas: ["sinAsignar"], ancho: 100 },
  { key: "windows", en: "Windows", es: "Ventanas", tablas: ["sinAsignar"], ancho: 100 },
  // Era «Status / Estado» y pintaba lo mismo que la «Etapa» de Órdenes: la etapa de la orden, en su pastilla de color.
  // Desde D-376 se llama como en Órdenes y se pinta con su celda. La clave sigue siendo `status`: es la que está guardada.
  { key: "status", en: "Stage", es: "Etapa", tablas: ["sinAsignar"], ancho: 88, deOrdenes: "stage" },
  // Las de Órdenes que el Gestor no tenía (D-376). El dueño: «las mismas columnas que se miran en órdenes quiero que se
  // miren en el logistic manager». Mismo rótulo, misma celda, mismo valor para ordenar y filtrar.
  { key: "type", en: "Type", es: "Tipo", tablas: ["sinAsignar"], ancho: 96, deOrdenes: "type" },
  { key: "so", en: "SO #", es: "SO #", tablas: ["sinAsignar"], ancho: 72, deOrdenes: "so" },
  { key: "po", en: "PO #", es: "PO #", tablas: ["sinAsignar"], ancho: 72, deOrdenes: "po" },
  { key: "fee", en: "Fee", es: "Costo", tablas: ["sinAsignar"], ancho: 72, deOrdenes: "fee" },
  { key: "contact", en: "Contact", es: "Contacto", tablas: ["sinAsignar"], ancho: 116, deOrdenes: "contact" },
  // Prioridad (D-412, 147): la celda de Órdenes, que solo destaca alta y crítica. NO sale por defecto —se elige en ⚙,
  // como pidió el dueño— y por eso no lleva marca de tanda: una lista guardada no la recibe sola. De partida va la
  // última (`alFinal`), no tras la etapa como en Órdenes: es la única escondida de esta tabla (ver `alFinal`).
  { key: "priority", en: "Priority", es: "Prioridad", tablas: ["sinAsignar"], ancho: 96, deOrdenes: "priority", oculta: true, alFinal: true },
  // La tabla de PARADAS de un chofer, donde se cambia el orden (D-346): «let me configure it into columns». Sus columnas
  // eran fijas. El número de parada, el ID (desde D-408, la factura) y las acciones siguen fijos; estas cinco se pueden quitar. `indice` es el
  // puesto que la columna ya tenía en esa tabla, que guarda su ancho por posición (`useColWidths`).
  { key: "p_type", en: "Stops: Type", es: "Paradas: Tipo", tablas: ["paradas"], ancho: 140, indice: 2 },
  { key: "p_pallets", en: "Stops: Pallets", es: "Paradas: Pallets", tablas: ["paradas"], ancho: 70, indice: 3 },
  // La ciudad también aquí desde D-408, con la misma clave por la misma razón.
  { key: "p_address", en: "Stops: City", es: "Paradas: Ciudad", tablas: ["paradas"], ancho: 120, indice: 4 },
  { key: "p_eta", en: "Stops: ETA", es: "Paradas: Llegada", tablas: ["paradas"], ancho: 56, indice: 5 },
  { key: "p_windows", en: "Stops: Windows", es: "Paradas: Ventanas", tablas: ["paradas"], ancho: 110, indice: 6 },
  // Las de Órdenes que la tabla de paradas no tenía (D-376). NO salen por defecto: esta tabla es donde se cambia el orden
  // con las flechas de la derecha, y ocho columnas más las sacarían de la pantalla (medido: ver la decisión). Se eligen
  // en su ⚙. Ni el chofer —la tabla ES la de un chofer— ni la factura —ya sale bajo el ID; desde D-408, en su lugar—.
  { key: "p_stage", en: "Stops: Stage", es: "Paradas: Etapa", tablas: ["paradas"], ancho: 108, deOrdenes: "stage", oculta: true },
  { key: "p_store", en: "Stops: Store", es: "Paradas: Tienda", tablas: ["paradas"], ancho: 128, deOrdenes: "store", oculta: true },
  { key: "p_account", en: "Stops: Account", es: "Paradas: Cuenta", tablas: ["paradas"], ancho: 184, deOrdenes: "account", oculta: true },
  { key: "p_so", en: "Stops: SO #", es: "Paradas: SO #", tablas: ["paradas"], ancho: 72, deOrdenes: "so", oculta: true },
  { key: "p_po", en: "Stops: PO #", es: "Paradas: PO #", tablas: ["paradas"], ancho: 72, deOrdenes: "po", oculta: true },
  { key: "p_date", en: "Stops: Delivery Date", es: "Paradas: Fecha entrega", tablas: ["paradas"], ancho: 112, deOrdenes: "date", oculta: true },
  { key: "p_fee", en: "Stops: Fee", es: "Paradas: Costo", tablas: ["paradas"], ancho: 72, deOrdenes: "fee", oculta: true },
  { key: "p_contact", en: "Stops: Contact", es: "Paradas: Contacto", tablas: ["paradas"], ancho: 116, deOrdenes: "contact", oculta: true },
  { key: "p_priority", en: "Stops: Priority", es: "Paradas: Prioridad", tablas: ["paradas"], ancho: 96, deOrdenes: "priority", oculta: true },
]);

/** Por defecto, todas menos las marcadas `oculta`: lo que ya se veía, más la factura y lo nuevo de «Sin asignar». Quitar
 *  columnas es una elección, no el punto de partida. */
export const COLUMNAS_DEL_GESTOR_POR_DEFECTO: readonly string[] = [...COLUMNAS_DEL_GESTOR.filter((c) => !c.oculta).map((c) => c.key), "_v2", "_v3", "_v4"];

/** El orden DE PARTIDA de cada tabla: el de quien no ha movido nada, y el que devuelven «Default» y «Restablecer orden».
 *  «Sin asignar», el de Órdenes vista por ventas, que es el del catálogo (D-402; antes, desde D-331, la factura la primera
 *  y lo demás como estaba). Paradas, el que ya tenía antes de poder elegir: lo que llega después va al final. */
export const ORDEN_DE_PARTIDA_DEL_GESTOR: Readonly<Record<TablaDelGestor, readonly string[]>> = {
  sinAsignar: COLUMNAS_DEL_GESTOR.filter((c) => c.tablas.includes("sinAsignar")).map((c) => c.key),
  paradas: ["p_type", "p_pallets", "p_address", "p_eta", "p_windows", "p_stage", "p_store", "p_account", "p_so", "p_po", "p_date", "p_fee", "p_contact", "p_priority"],
};
const TABLAS: readonly TablaDelGestor[] = ["sinAsignar", "paradas"];

/**
 * MOVER COLUMNAS en el Gestor (D-410). El dueño: «Route manager view to be able to move columns and save template IN THE
 * COLUMNS». Es el mecanismo de Órdenes (D-332) y Promos (D-385): flechas ↑ ↓ en ⚙ Columnas, `mueveColumna` y
 * `ordenEfectivo`, y el orden guardado APARTE de qué columnas se ven, en la mitad `_orden` de la misma fila.
 *
 * `guardado` es la lista del rol en `_orden`: UNA lista para las dos tablas —sus claves no se cruzan—, y en ella solo
 * está la tabla que la persona movió. Una tabla que vuelve a su orden de partida sale de la lista, y una lista vacía es
 * `null` (no se guarda nada): así una columna futura de una tabla que nadie tocó entra donde diga el código, no al final.
 */
export function ordenDeLaTabla(tabla: TablaDelGestor, guardado: readonly string[] | null | undefined): string[] {
  return ordenEfectivo(ORDEN_DE_PARTIDA_DEL_GESTOR[tabla], guardado);
}

/** La lista que se guarda con el orden de cada tabla. `null` = las dos en su orden de partida. */
export function componeOrdenDelGestor(porTabla: Readonly<Record<TablaDelGestor, readonly string[]>>): string[] | null {
  const r = TABLAS.flatMap((tb) => {
    const suyo = ordenDeLaTabla(tb, porTabla[tb]);
    return suyo.join() === ORDEN_DE_PARTIDA_DEL_GESTOR[tb].join() ? [] : suyo;
  });
  return r.length ? r : null;
}

/** Cambia el orden de UNA tabla y deja el de la otra como estaba. */
function conOrdenDe(tabla: TablaDelGestor, suyo: readonly string[] | null, guardado: readonly string[] | null | undefined): string[] | null {
  const porTabla = { sinAsignar: ordenDeLaTabla("sinAsignar", guardado), paradas: ordenDeLaTabla("paradas", guardado) };
  porTabla[tabla] = suyo ? [...suyo] : [...ORDEN_DE_PARTIDA_DEL_GESTOR[tabla]];
  return componeOrdenDelGestor(porTabla);
}

/**
 * Sube (-1) o baja (+1) una columna de una tabla, un puesto ENTRE LAS QUE SE VEN (`mueveColumna` de Órdenes: salta por
 * encima de las escondidas). Las fijas cuentan como vistas: la factura de «Sin asignar» se mueve como las demás, solo que
 * no se puede quitar. Devuelve la lista entera que se guarda.
 */
export function mueveEnElGestor(tabla: TablaDelGestor, guardado: readonly string[] | null | undefined, clave: string, delta: -1 | 1, elegidas: readonly string[]): string[] | null {
  const orden = ordenDeLaTabla(tabla, guardado);
  const vistas = columnasDeLaTabla(tabla, elegidas, guardado).map((c) => c.key);
  return conOrdenDe(tabla, mueveColumna(orden, clave, delta, vistas), guardado);
}

/** Si la flecha haría algo: la flecha se apaga en el tope, contando que una visible salta sobre las escondidas (D-332). */
export function seMueveEnElGestor(tabla: TablaDelGestor, guardado: readonly string[] | null | undefined, clave: string, delta: -1 | 1, elegidas: readonly string[]): boolean {
  return ordenDeLaTabla(tabla, mueveEnElGestor(tabla, guardado, clave, delta, elegidas)).join() !== ordenDeLaTabla(tabla, guardado).join();
}

/** Dónde guarda el DEMO el orden (no tiene base): en este navegador, por rol, como Promos (`rtg_promos_orden_<rol>`). */
export const claveDelOrdenEnElNavegador = (rol: string): string => `rtg_routes_orden_${rol}`;
/** El orden guardado en el navegador, saneado. Un JSON roto, o algo que no sea una lista de textos, no es ningún orden. */
export function ordenDelGestorEnElNavegador(texto: string | null): string[] | null {
  try {
    const v: unknown = JSON.parse(texto ?? "null");
    return Array.isArray(v) && v.every((k) => typeof k === "string") ? ordenDePlantillaDelGestor(v) : null;
  } catch { return null; }
}

/** «Restablecer orden» de una tabla: vuelve a su orden de partida, y la otra se queda como estaba. */
export function restableceOrdenDelGestor(tabla: TablaDelGestor, guardado: readonly string[] | null | undefined): string[] | null {
  return conOrdenDe(tabla, null, guardado);
}

/** Si esta tabla tiene un orden propio (para enseñar «Restablecer orden» solo cuando hace algo). */
export const tieneOrdenPropio = (tabla: TablaDelGestor, guardado: readonly string[] | null | undefined): boolean =>
  ordenDeLaTabla(tabla, guardado).join() !== ORDEN_DE_PARTIDA_DEL_GESTOR[tabla].join();

/** Las columnas de UNA tabla, en el orden de la persona (`guardado`, o el de partida si no movió nada) —nunca en el que
 *  las marcó—, y solo las elegidas y las fijas. Una clave que ya no existe (una columna retirada) se ignora sin romper. */
export function columnasDeLaTabla(tabla: TablaDelGestor, elegidas: readonly string[], guardado?: readonly string[] | null): ColumnaDelGestor[] {
  const si = new Set(elegidas);
  return ordenDeLaTabla(tabla, guardado).map((k) => COLUMNAS_DEL_GESTOR.find((c) => c.key === k)!).filter((c) => si.has(c.key) || c.fija);
}

/** Lo que lista el ⚙ de una tabla: TODAS las suyas, en el orden de la persona, fijas incluidas (con la casilla apagada:
 *  se mueven, no se quitan). Hasta D-410 el ⚙ no enseñaba la factura (D-408); ahora sale para poder moverla. */
export function columnasDelSelector(tabla: TablaDelGestor, guardado: readonly string[] | null | undefined): ColumnaDelGestor[] {
  return ordenDeLaTabla(tabla, guardado).map((k) => COLUMNAS_DEL_GESTOR.find((c) => c.key === k)!);
}

/** El orden que trae una plantilla del Gestor, o `null` si se guardó sin orden propio (las de antes de D-410): entonces
 *  se aplica el de partida. Solo claves que aún existen; lo que quede en su orden de partida no se guarda. */
export function ordenDePlantillaDelGestor(o: readonly string[] | undefined): string[] | null {
  return o ? componeOrdenDelGestor({ sinAsignar: ordenDeLaTabla("sinAsignar", o), paradas: ordenDeLaTabla("paradas", o) }) : null;
}


/**
 * La columna de Órdenes que pinta la columna `clave` del Gestor, o nada si el Gestor la pinta a su manera (D-376).
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
// D-376: las de Órdenes en «Sin asignar». Solo las que salen por defecto; las de paradas nacen ocultas y no se añaden.
export const MARCA_V4 = "_v4";
const NUEVAS_EN_V4: readonly string[] = ["type", "so", "po", "fee", "contact"];
export function conColumnasNuevas(guardadas: readonly string[]): string[] {
  let lista = guardadas.includes(MARCA_V2) ? [...guardadas] : [...new Set([...guardadas, ...NUEVAS_EN_V2])].concat(MARCA_V2);
  if (!lista.includes(MARCA_V3)) lista = [...new Set([...lista, ...NUEVAS_EN_V3])].concat(MARCA_V3);
  if (!lista.includes(MARCA_V4)) lista = [...new Set([...lista, ...NUEVAS_EN_V4])].concat(MARCA_V4);
  return lista;
}

/**
 * Los ANCHOS de la tabla de paradas van por CLAVE desde D-410 (`rtg_routes_stops9`): una columna que se mueve se lleva
 * su ancho. Hasta aquí vivían en dos sitios: `rtg_routes_stops8`, por POSICIÓN —[parada, factura, tipo, pallets, ciudad,
 * llegada, ventanas, acciones]—, y `rtg_routes_stops_extra1`, por la clave de Órdenes de las columnas sin puesto (D-376).
 * Esto los traduce a las claves nuevas, una vez, para que nadie pierda lo que arrastró. Lo que no sea un número se ignora.
 * Las tres fijas de la tabla —número de parada, factura y acciones— llevan su propia clave.
 */
export const ANCHO_FIJO_DE_PARADAS: Readonly<Record<string, number>> = { _n: 40, _factura: 110, _acciones: 150 };

/** El ancho de partida de una columna de paradas, por su clave: el de las tres fijas; el de Órdenes para las que vienen de
 *  allí (D-376); y si no, el del catálogo. Son los mismos números que tenía la tabla por posición ([40, 110, 140, 70, 120,
 *  56, 110, 150], D-408): la prueba los compara uno a uno. */
export function anchoDePartidaDeParada(clave: string, anchosDeOrdenes: Readonly<Record<string, number>>): number | undefined {
  return ANCHO_FIJO_DE_PARADAS[clave] ?? anchoDePartida(clave, anchosDeOrdenes) ?? COLUMNAS_DEL_GESTOR.find((c) => c.key === clave)?.ancho;
}
export function anchosDeParadasHeredados(porPosicion: unknown, extras: unknown): Record<string, number> {
  const r: Record<string, number> = {};
  const vale = (w: unknown): w is number => typeof w === "number" && Number.isFinite(w) && w > 0;
  if (Array.isArray(porPosicion) && porPosicion.length === 8) {
    if (vale(porPosicion[0])) r._n = porPosicion[0];
    if (vale(porPosicion[1])) r._factura = porPosicion[1];
    if (vale(porPosicion[7])) r._acciones = porPosicion[7];
    for (const c of COLUMNAS_DEL_GESTOR) if (c.indice != null && vale(porPosicion[c.indice])) r[c.key] = porPosicion[c.indice];
  }
  if (extras && typeof extras === "object" && !Array.isArray(extras)) {
    const e = extras as Record<string, unknown>;
    for (const c of COLUMNAS_DEL_GESTOR) if (c.tablas.includes("paradas") && c.indice == null && c.deOrdenes && vale(e[c.deOrdenes])) r[c.key] = e[c.deOrdenes] as number;
  }
  return r;
}

/**
 * Siembra, UNA vez, la llave nueva de anchos de paradas con lo heredado de las dos viejas. Si la nueva ya existe no toca
 * nada (lo de después manda); si no hay nada que heredar, tampoco escribe. Las viejas no se borran: son de antes y no
 * estorban. Recibe el `localStorage` (o lo que se le parezca) para poder probarse sin navegador.
 */
export const LLAVE_DE_ANCHOS_DE_PARADAS = "rtg_routes_stops9";
export function siembraAnchosDeParadas(almacen: { getItem(k: string): string | null; setItem(k: string, v: string): void }): void {
  try {
    if (almacen.getItem(LLAVE_DE_ANCHOS_DE_PARADAS) != null) return;
    const lee = (k: string) => { try { return JSON.parse(almacen.getItem(k) ?? "null"); } catch { return null; } };
    const r = anchosDeParadasHeredados(lee("rtg_routes_stops8"), lee("rtg_routes_stops_extra1"));
    if (Object.keys(r).length) almacen.setItem(LLAVE_DE_ANCHOS_DE_PARADAS, JSON.stringify(r));
  } catch { /* sin navegador, o sin permiso: se empieza con el defecto */ }
}

/**
 * Lo que se pone al aplicar una PLANTILLA del Gestor (D-394): las columnas de la foto que aún existen, en el orden del
 * catálogo, con las marcas. Las marcas van SIEMPRE: la foto se tomó con este código, que ya conoce las columnas de cada tanda,
 * y sin ellas `conColumnasNuevas` volvería a añadir al recargar las que la plantilla tenía quitadas.
 */
export function columnasDePlantillaDelGestor(v: readonly string[]): string[] {
  const si = new Set(v);
  return COLUMNAS_DEL_GESTOR.map((c) => c.key).filter((k) => si.has(k)).concat(MARCA_V2, MARCA_V3, MARCA_V4);
}

/** La foto que guarda una plantilla del Gestor: solo las columnas del catálogo que se ven, sin marcas ni claves retiradas. */
export function fotoDelGestor(elegidas: readonly string[]): string[] {
  const si = new Set(elegidas);
  return COLUMNAS_DEL_GESTOR.map((c) => c.key).filter((k) => si.has(k));
}

/** La foto entera de una plantilla del Gestor desde D-410: qué columnas se ven (`v`) y, si la persona movió alguna, su
 *  orden (`o`), como en Órdenes. Sin orden propio la plantilla no lleva `o`, y al aplicarla sale el de partida. */
export function fotoDePlantillaDelGestor(elegidas: readonly string[], orden: readonly string[] | null | undefined): { v: string[]; o?: string[] } {
  const o = orden ? ordenDePlantillaDelGestor(orden) : null;
  return o ? { v: fotoDelGestor(elegidas), o } : { v: fotoDelGestor(elegidas) };
}

/** Marcar o desmarcar una columna. Devuelve la lista en el orden canónico, sin repetidas y sin claves desconocidas. */
export function alternaColumna(elegidas: readonly string[], key: string): string[] {
  const si = new Set(elegidas);
  if (si.has(key)) si.delete(key); else si.add(key);
  // Las marcas viajan siempre: lo que se guarde a partir de aquí ya conoce las columnas de cada tanda.
  return COLUMNAS_DEL_GESTOR.map((c) => c.key).filter((k) => si.has(k)).concat(MARCA_V2, MARCA_V3, MARCA_V4);
}
