import { stageInfo } from "@/lib/constants";
import { redondeaDinero } from "@/lib/totales";
import type { ValorDeCelda } from "@/lib/orden-y-filtro";
import { mueveColumna } from "@/lib/orden-de-columnas";

/**
 * RTG PROMOS — la tabla de decisiones, **sin React**.
 *
 * Qué columnas hay, qué valor tiene cada celda para ordenar y filtrar, qué estado lleva cada
 * producto y qué filas se escriben al aprobar en bloque. Todo aquí, y probado sin navegador; la
 * pantalla solo pinta lo que esto decide. El ordenar y el filtrar en sí son los de `orden-y-filtro`
 * (D-360), que ya usan la tabla de Órdenes y el Gestor: aquí solo se dice **qué saca cada columna
 * de una fila**.
 */

export type EstadoDeDecision = "pending" | "approved" | "rejected";
export const ESTADOS: readonly EstadoDeDecision[] = ["pending", "approved", "rejected"];

/**
 * El color de cada estado, **sacado de la paleta de las etapas de Órdenes y no inventado aquí**.
 *
 * El dueño pidió «el estilo de la tabla de Órdenes», y el estado en texto plano era la diferencia
 * que más se veía al ponerlas al lado. Los colores salen de `stageInfo` por la clave cuyo color
 * significa eso —espera, sí, no— para que la app tenga **una sola lengua de color**: si un día se
 * retoca esa paleta, se retoca aquí también sin que nadie tenga que acordarse.
 *
 * (La clave `delivered` se usa por su VERDE, no porque una promoción se entregue. Va dicho para que
 * nadie lo lea como un error.)
 */
export const COLOR_DE_ESTADO: Record<EstadoDeDecision, string> = {
  pending: stageInfo("pending").color,
  approved: stageInfo("delivered").color,
  rejected: stageInfo("rejected").color,
};

/**
 * Quién ve las cinco privadas, **para el modo demo y solo para él**.
 *
 * En la app de verdad esto NO se calcula: se lee del dato —si `promo_catalog.private` llegó nulo,
 * no se puede— porque un dato medido no puede discrepar de la base. Pero en demo no hay base que
 * mida nada, así que el demo tiene que simular la regla; y si no la simulara, enseñaría el costo a
 * un vendedor de mentira y el demo mentiría justo sobre lo que más importa del módulo.
 *
 * Gemelo de `promo_can_see_private()`, con su prueba atada al `.sql`. Desde la 143 (D-386) **solo el
 * admin**: el dueño, «just admin can see costs». Gerente y office siguen decidiendo (`esDecisorDePromos`).
 */
export function puedeVerPrivadasDePromos(rol: string | null | undefined): boolean {
  return rol === "admin";
}

/**
 * El grupo de promociones de una tienda, tal como lo pone el admin en Datos.
 *
 * **Es el gemelo en TypeScript de `promo_group_of_user()` de la 140**, y tiene que decidir lo mismo
 * que ella: si la pantalla creyera que alguien pertenece a un grupo y la base dijera otra cosa, el
 * botón de aprobar se ofrecería y la escritura la rechazaría la RLS **sin error**, con cero filas —
 * o sea, en silencio. Por eso compara igual que la función: recortando y **sin distinguir
 * mayúsculas**. Nulo es el valor seguro en los dos lados.
 *
 * (`gruposDeAjustes`, en `subida.ts`, mira lo mismo desde el otro lado: qué grupos existen.)
 */
export function grupoDeLaTienda(
  stores: readonly { name?: string | null; promo_group?: string | null }[] | null | undefined,
  nombreDeTienda: string | null | undefined,
): string | null {
  const buscado = (nombreDeTienda ?? "").trim().toLowerCase();
  if (!buscado) return null;
  for (const s of stores ?? []) {
    if ((s.name ?? "").trim().toLowerCase() !== buscado) continue;
    return (s.promo_group ?? "").trim() || null;
  }
  return null;
}

/** Una fila de `promo_catalog`. `private` llega **nulo** para quien no puede ver las cinco. */
export interface ProductoDeCatalogo {
  round_id: string;
  code: string;
  supplier: string | null;
  size: string | null;
  description: string | null;
  qoh: number | null;
  qoh_by_store: Record<string, number | null> | null;
  price: number | null;
  source_sheet: string;
  row_no: number | null;
  private: {
    notes: string | null;
    demand: number | null;
    months_of_stock: number | null;
    cost: number | null;
    diff: number | null;
  } | null;
}

export interface DecisionDeGrupo {
  round_id: string;
  code: string;
  group_code: string;
  status: EstadoDeDecision;
  note: string | null;
}

export interface FilaDePromo {
  code: string;
  description: string | null;
  supplier: string | null;
  size: string | null;
  qoh: number | null;
  /** Por tienda, con la clave que traía el libro. **Separadas aunque dos decidan juntas.** */
  porTienda: Record<string, number | null>;
  price: number | null;
  cost: number | null;
  diff: number | null;
  demand: number | null;
  mo: number | null;
  notes: string | null;
  sourceSheet: string;
  rowNo: number | null;
  estado: EstadoDeDecision;
  nota: string | null;
}

export interface ColumnaDePromos {
  key: string;
  en: string;
  es: string;
  ancho: number;
  /** Ordena como número. Lo demás, como texto. */
  numero?: boolean;
  /** Una de las cinco de `Sheet6`: solo existe si `private` no es nulo. */
  privada?: boolean;
  /** Las existencias de esta tienda. La clave es la del libro, no una de Ajustes. */
  tienda?: string;
}

/**
 * Las columnas que NO se pueden quitar. El código identifica la fila, y el estado es para lo que se
 * entra aquí: esconderlo dejaría una tabla que no sirve para decidir.
 *
 * La columna «Nota» ya no existe (D-387: el dueño, «quita eso de notas en general»). Antes fue fija (D-369) y dejó de serlo en D-381: el dueño, viéndola en la tabla, «nota está
 * showing en el promos table pero no aparece para quitar en el columns». Sigue saliendo por defecto;
 * quitarla solo la esconde, las notas escritas no se tocan.
 */
export const COLUMNAS_FIJAS: readonly string[] = ["code", "estado"];

/**
 * El catálogo de columnas de una ronda.
 *
 * **Las de tienda son del DATO, no del código**: salen de las claves que el libro traía en
 * `qoh_by_store`, así que una tienda nueva aparece sola y ninguna se escribe aquí. Y salen
 * **separadas aunque dos tiendas decidan juntas** — son existencias de dos almacenes distintos, y
 * juntarlas escondería que una tiene el material y la otra no.
 *
 * Las cinco privadas solo existen si quien mira puede verlas. No se ofrecen apagadas: una columna
 * que no se puede rellenar es peor que una que no está.
 */
export function columnasDePromos(clavesDeTienda: readonly string[], puedeVerPrivadas: boolean): ColumnaDePromos[] {
  const out: ColumnaDePromos[] = [
    { key: "code", en: "Code", es: "Código", ancho: 130 },
    { key: "description", en: "Description", es: "Descripción", ancho: 280 },
    { key: "supplier", en: "Supplier", es: "Proveedor", ancho: 160 },
    { key: "size", en: "Size", es: "Tamaño", ancho: 80 },
    { key: "qoh", en: "QOH", es: "Existencias", ancho: 80, numero: true },
  ];
  for (const t of clavesDeTienda) {
    // 64 y no 76 (D-375): desde que salen por defecto son seis columnas más en la pantalla de
    // todo el mundo, y lo que llevan son números de tres o cuatro cifras. Lo que se estrecha es el
    // hueco, no el dato. La cabecera corta con puntos, como el resto de la tabla, y el nombre
    // entero sigue en ⚙ Columnas y en el menú de la propia cabecera.
    out.push({ key: `qoh_${t}`, en: `QOH ${t}`, es: `Existencias ${t}`, ancho: 64, numero: true, tienda: t });
  }
  out.push({ key: "price", en: "Price", es: "Precio", ancho: 84, numero: true });
  if (puedeVerPrivadas) {
    out.push(
      { key: "cost", en: "Cost", es: "Costo", ancho: 84, numero: true, privada: true },
      { key: "diff", en: "Margin", es: "Margen", ancho: 84, numero: true, privada: true },
      { key: "demand", en: "Demand", es: "Demanda", ancho: 90, numero: true, privada: true },
      { key: "mo", en: "Months of stock", es: "Meses de stock", ancho: 110, numero: true, privada: true },
      { key: "notes", en: "Notes", es: "Notas", ancho: 140, privada: true },
    );
  }
  out.push(
    { key: "estado", en: "Decision", es: "Decisión", ancho: 120 },
  );
  return out;
}

/**
 * Las que se ven **al entrar**: pocas, y a propósito.
 *
 * La primera versión ofrecía TODAS —hasta diecisiete, con las seis de existencias por tienda y las
 * cinco privadas— y el dueño lo vio y dijo *«it's horrible, first it doesn't fit in 1 screen»*. Una
 * tabla que nace fuera de la pantalla obliga a desplazarse a lo ancho antes de leer nada, así que
 * el punto de partida es lo mínimo para decidir: qué es, cuánto hay, a cuánto se vende, y qué se
 * decidió. Las demás **siguen estando**, en ⚙ Columnas, a un clic.
 *
 * Es lo contrario de lo que hace el Gestor de Rutas (D-331, «por defecto todas»), y la diferencia
 * es que allí son nueve columnas fijas y aquí el número **lo pone el libro**: cada tienda nueva del
 * Excel añade una, así que «todas» crece sola y nadie se entera hasta que no cabe.
 */
export const COLUMNAS_DE_PROMOS_POR_DEFECTO: readonly string[] = [
  // «supplier» entra al arranque en D-387: el dueño, «actívales a todos lo de proveedor».
  "code", "description", "supplier", "size", "qoh", "price", "estado",
];

/**
 * El precio como se pinta: con su signo de dólar y dos decimales (D-387, el dueño: «a precio
 * agrégale el $»). Sin precio, «—». Solo pinta: ordenar y filtrar siguen usando el número.
 */
export function textoDePrecio(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : String(v);
}

/**
 * Las de partida que existen de verdad para quien mira (una privada no entra si no puede verla),
 * **más las seis de existencias por tienda** (D-375).
 *
 * **Esto cambia en parte la decisión de arriba, y el dueño lo pidió sabiendo cuál era**: *«pon el
 * inventario de todas las tiendas para vista de todos»*. La razón de que estuvieran apagadas sigue
 * siendo verdad —la tabla se ensancha— y lo que cambia es el juicio: saber qué tienda tiene el
 * material es parte de decidir, no un extra. Lo que **no** vuelve es «todas»: las cinco privadas
 * siguen fuera del arranque y siguen siendo de quien puede verlas.
 *
 * Lo que compensa el ancho no es esconder columnas: es que la página **nunca** se desplace de lado
 * —se desplaza la caja de la tabla, como en Órdenes— y que estas seis sean estrechas (64 px).
 *
 * Se devuelven en el orden del catálogo, que es donde las de tienda ya viven entre `qoh` y `price`.
 */
export function columnasDePromosPorDefecto(clavesDeTienda: readonly string[], puedeVerPrivadas: boolean): string[] {
  const catalogo = columnasDePromos(clavesDeTienda, puedeVerPrivadas);
  const arranque = new Set<string>(COLUMNAS_DE_PROMOS_POR_DEFECTO);
  for (const c of catalogo) if (c.tienda) arranque.add(c.key);
  return catalogo.filter((c) => arranque.has(c.key)).map((c) => c.key);
}

/**
 * Las columnas que se pintan, a partir de lo que esa persona guardó.
 *
 * Dos reglas, y las dos son por algo que pasa de verdad:
 *   · **una clave guardada que ya no existe se ignora** — una columna de tienda desaparece en
 *     cuanto el libro del mes que viene no la trae, y quien la tuviera guardada se quedaría con una
 *     cabecera sin celdas;
 *   · **las fijas entran siempre**, aunque lo guardado no las traiga. Sin el código no se sabe qué
 *     fila es, y sin el estado ni la nota la tabla no sirve para lo que se entra aquí. Una lista
 *     guardada antes de que una de ellas fuera fija dejaría una pantalla inútil sin decir por qué.
 *
 * Se devuelven **en el orden de esa persona** (`ordenDeColumnasDePromos`), que sin orden guardado es
 * el del catálogo. Hasta D-385 era siempre el del catálogo —«el orden de las columnas es del
 * diseño»— y el dueño pidió moverlas: *«make it to where I can move the place of the columns»*. Lo
 * que NO cambia es que el orden de `guardadas` no cuenta: esa lista es un conjunto y sale en el
 * orden en que se pulsaron las casillas. El orden va aparte, como en Órdenes (D-332).
 *
 * **Y una tercera regla, que sale del orden (D-385): una columna que esa persona NO CONOCÍA entra
 * con el defecto.** El orden guardado lista TODAS las columnas que había cuando guardó, visibles o
 * no; así que una que no está en él es nueva para esa persona —casi siempre, una tienda que trae el
 * libro de este mes— y no puede haberla escondido. Sin esto, quien guardó sus columnas en septiembre
 * no vería nunca la tienda nueva de octubre, aunque las de tienda sean «para vista de todos» (D-375).
 * Una que SÍ conocía y no marcó, sigue escondida: eso sí lo decidió.
 */
export function columnasVisiblesDePromos(
  guardadas: readonly string[] | null | undefined,
  disponibles: readonly ColumnaDePromos[],
  orden?: readonly string[] | null,
): string[] {
  // Sin nada guardado, EL MISMO defecto que calcula `columnasDePromosPorDefecto` —que desde D-375
  // incluye las de tienda— y no la lista estática. Escrito así porque ya divergieron una vez: al
  // añadir las de tienda al defecto, esta función seguía devolviendo el defecto viejo, y quien no
  // hubiera guardado columnas nunca las habría visto. Un defecto en dos sitios acaba siendo dos.
  const porDefecto = disponibles.filter((c) => COLUMNAS_DE_PROMOS_POR_DEFECTO.includes(c.key) || c.tienda).map((c) => c.key);
  const elegidas = new Set(guardadas ?? porDefecto);
  if (guardadas && orden) {
    const conocidas = new Set(orden);
    for (const k of porDefecto) if (!conocidas.has(k)) elegidas.add(k);
  }
  for (const fija of COLUMNAS_FIJAS) elegidas.add(fija);
  return ordenDeColumnasDePromos(disponibles, orden).filter((k) => elegidas.has(k));
}

/** La que va **siempre primera y no se mueve**, como la `#` de Órdenes (D-332): identifica la fila. */
export const COLUMNA_PRIMERA = "code";

/**
 * El ORDEN de todas las columnas para esta persona (D-385), visibles o no — el de ⚙ Columnas.
 *
 * Es el mismo mecanismo que Órdenes (`orden-de-columnas`, D-332): el orden se guarda **aparte** de
 * qué columnas se ven, en la mitad `_orden` de la misma fila de `user_prefs`, así que esconder una
 * columna y volver a mostrarla no le hace perder su sitio. Tres diferencias, las tres por el libro:
 *
 *   · **Una clave guardada que ya no existe se cae**, igual que allí. Aquí pasa cada mes: las de
 *     tienda (`qoh_XXX`) son las que trae el libro de esa ronda.
 *   · **Una columna que el orden guardado no conoce entra detrás de su vecina del catálogo**, no al
 *     final. En Órdenes una columna nueva es rara y el final vale; aquí la nueva es casi siempre
 *     una tienda que trae el libro del mes que viene, y al final —detrás de la nota— se perdería.
 *     Detrás de su vecina queda con las otras tiendas. Sin nada guardado, esto da el catálogo tal
 *     cual: es el mismo camino, no un caso aparte.
 *   · **`code` va siempre primera.** Aunque lo guardado diga otra cosa.
 */
export function ordenDeColumnasDePromos(
  disponibles: readonly ColumnaDePromos[],
  guardado: readonly string[] | null | undefined,
): string[] {
  const catalogo = disponibles.map((c) => c.key);
  const existen = new Set(catalogo);
  const out = [...new Set(guardado ?? [])].filter((k) => existen.has(k) && k !== COLUMNA_PRIMERA);
  for (let i = 0; i < catalogo.length; i++) {
    const k = catalogo[i];
    if (k === COLUMNA_PRIMERA || out.includes(k)) continue;
    let sitio = 0;
    for (let j = i - 1; j >= 0; j--) {
      const p = out.indexOf(catalogo[j]);
      if (p >= 0) { sitio = p + 1; break; }
    }
    out.splice(sitio, 0, k);
  }
  return existen.has(COLUMNA_PRIMERA) ? [COLUMNA_PRIMERA, ...out] : out;
}

/**
 * Sube (-1) o baja (+1) una columna un puesto entre las visibles: la `mueveColumna` de Órdenes, con
 * `code` fuera del juego — ni se mueve ni nadie se le pone delante.
 */
export function mueveColumnaDePromos(
  orden: readonly string[],
  clave: string,
  delta: -1 | 1,
  visibles?: readonly string[],
): string[] {
  if (clave === COLUMNA_PRIMERA) return [...orden];
  const resto = orden.filter((k) => k !== COLUMNA_PRIMERA);
  const movido = mueveColumna(resto, clave, delta, visibles);
  return orden.includes(COLUMNA_PRIMERA) ? [COLUMNA_PRIMERA, ...movido] : movido;
}

/**
 * El filtro de tienda (D-385): elegida una tienda, **fuera los productos con menos de este número
 * de existencias en ELLA**. El dueño: *«if the item in existencia in the store has less than 10 then
 * that will not be included in the list»*. 10 justo se queda.
 */
export const MINIMO_EN_LA_TIENDA = 10;

/**
 * Las filas que quedan con el filtro de tienda puesto.
 *
 * · **Sin dato cuenta como 0**, y queda fuera: una celda vacía en la columna de esa tienda es que
 *   el libro no le apunta existencias, y ofrecer en promoción lo que no se sabe si hay es peor que
 *   no enseñarlo.
 * · **Una tienda que esta ronda no trae no filtra nada.** Es la elegida en otra ronda: con el libro
 *   de este mes no significa nada, y aplicarla dejaría la tabla vacía sin decir por qué.
 * · **Es por columna del libro, no por grupo.** El libro trae existencias por tienda (`qoh_by_store`)
 *   y el grupo de promociones es de Ajustes, y **no hay ningún cruce guardado** entre las dos cosas:
 *   el libro llama a una tienda como diga su encabezado y Ajustes la llama por su nombre.
 */
export function filtraPorTienda<F extends Pick<FilaDePromo, "porTienda">>(
  filas: readonly F[],
  tienda: string | null | undefined,
  clavesDeTienda: readonly string[],
): F[] {
  if (!tienda || !clavesDeTienda.includes(tienda)) return [...filas];
  return filas.filter((f) => (f.porTienda[tienda] ?? 0) >= MINIMO_EN_LA_TIENDA);
}

/**
 * Las claves de tienda de una ronda, **en el orden del libro y sin repetir**.
 *
 * Se recorren todos los productos y no solo el primero: una fila a la que le faltara una tienda
 * dejaría esa columna fuera para toda la tabla.
 */
export function clavesDeTiendaDe(productos: readonly ProductoDeCatalogo[]): string[] {
  const out: string[] = [];
  const vistas = new Set<string>();
  for (const p of productos) {
    for (const k of Object.keys(p.qoh_by_store ?? {})) {
      if (vistas.has(k)) continue;
      vistas.add(k);
      out.push(k);
    }
  }
  return out;
}

/**
 * La fila que se pinta.
 *
 * **El dinero se redondea aquí**, con `redondeaDinero` (D-363): el costo llega de la base con toda
 * su precisión (`1.0472501936483345`, medido en el ensayo de la 140) y enseñarlo así no le sirve a
 * nadie. Se redondea **antes** de ordenar y filtrar a propósito: quien ordena, ordena por lo que
 * ve, y dos celdas que enseñan `1.05` tienen que empatar en vez de colocarse en un orden que la
 * pantalla no explica.
 */
export function filaDePromo(p: ProductoDeCatalogo, decision: DecisionDeGrupo | undefined): FilaDePromo {
  const dinero = (v: number | null | undefined) => (v == null ? null : redondeaDinero(v));
  return {
    code: p.code,
    description: p.description,
    supplier: p.supplier,
    size: p.size,
    qoh: p.qoh,
    porTienda: { ...(p.qoh_by_store ?? {}) },
    price: dinero(p.price),
    cost: dinero(p.private?.cost),
    diff: dinero(p.private?.diff),
    demand: p.private?.demand ?? null,
    mo: p.private?.months_of_stock ?? null,
    notes: p.private?.notes ?? null,
    sourceSheet: p.source_sheet,
    rowNo: p.row_no,
    estado: decision?.status ?? "pending",
    nota: decision?.note ?? null,
  };
}

/** Todas las filas de la ronda, casadas con las decisiones del grupo que se está mirando. */
export function filasDePromo(
  productos: readonly ProductoDeCatalogo[],
  decisiones: readonly DecisionDeGrupo[],
  grupo: string | null,
): FilaDePromo[] {
  const porCodigo = new Map<string, DecisionDeGrupo>();
  for (const d of decisiones) {
    // Sin grupo —un vendedor sin tienda, o el admin antes de elegir uno— no hay decisión que casar:
    // todo sale como pendiente en vez de coger la de un grupo cualquiera.
    if (grupo !== null && d.group_code === grupo) porCodigo.set(d.code, d);
  }
  return productos.map((p) => filaDePromo(p, porCodigo.get(p.code)));
}

/** Lo que una columna saca de una fila para ordenar y filtrar (`orden-y-filtro`, D-360). */
export function valorDeColumna(fila: FilaDePromo, clave: string): ValorDeCelda {
  if (clave.startsWith("qoh_")) return fila.porTienda[clave.slice(4)] ?? null;
  switch (clave) {
    case "code": return fila.code;
    case "description": return fila.description;
    case "supplier": return fila.supplier;
    case "size": return fila.size;
    case "qoh": return fila.qoh;
    case "price": return fila.price;
    case "cost": return fila.cost;
    case "diff": return fila.diff;
    case "demand": return fila.demand;
    case "mo": return fila.mo;
    case "notes": return fila.notes;
    case "estado": return fila.estado;
    default: return null;
  }
}

/**
 * Lo mismo, con los argumentos **al revés**: es la forma que pide `filtraFilas` y `opcionesDeFiltro`
 * de `orden-y-filtro`, que reciben `(clave, fila)`.
 *
 * Existe para que nadie tenga que acordarse de invertirlos. Dos funciones con los mismos dos
 * argumentos en distinto orden es un fallo que compila —las dos son `(a, b)` de tipos distintos,
 * así que aquí `tsc` sí lo caza, pero en un `any` no— y sobre todo es un fallo que se lee bien.
 */
export const valorParaFiltrar = (clave: string, fila: FilaDePromo): ValorDeCelda => valorDeColumna(fila, clave);

/** Cuántos hay de cada estado. Es lo que llevan los chips del filtro por estado. */
export function cuentaPorEstado(filas: readonly FilaDePromo[]): Record<EstadoDeDecision, number> {
  const out: Record<EstadoDeDecision, number> = { pending: 0, approved: 0, rejected: 0 };
  for (const f of filas) out[f.estado] += 1;
  return out;
}

/**
 * Quién decide: el admin en cualquier grupo; Gerente de Oficina y Oficina, en el suyo.
 *
 * **Gemelo de `promo_is_decider()` (140)**, con la misma trampa que `grupoDeLaTienda`: si los dos
 * lados no dijeran lo mismo, la pantalla ofrecería el botón y la RLS rechazaría el `update` con
 * **cero filas y sin error**. Un `insert` sí da error; un `update` que no pasa la política, no.
 *
 * Lo que NO tiene gemelo es «puede ver las cinco columnas privadas», y a propósito: eso se lee del
 * DATO —si `promo_catalog.private` llegó nulo, no puede— en vez de volver a calcularlo aquí. Un
 * dato medido no puede discrepar de la base; una regla copiada, sí.
 */
export function esDecisorDePromos(opts: { rol: string | null | undefined; grupo: string | null }): boolean {
  if (opts.rol === "admin") return true;
  return (opts.rol === "manager" || opts.rol === "accounting") && opts.grupo !== null;
}

/**
 * **Una sola función decide si se puede decidir**, y la usan el botón de una fila, el de bloque y
 * el selector de estado. Si cada uno lo calculara por su cuenta, uno de ellos acabaría ofreciendo
 * una acción que la base rechaza — y el rechazo de una ronda cerrada es una EXCEPCIÓN del
 * disparador (140), o sea un error crudo en pantalla.
 */
export function puedeDecidir(opts: { esDecisor: boolean; grupo: string | null; rondaCerrada: boolean }): boolean {
  return opts.esDecisor && opts.grupo !== null && !opts.rondaCerrada;
}

/** Por qué no se puede, para decírselo en vez de dejar un botón apagado sin explicación. */
export function motivoParaNoDecidir(opts: { esDecisor: boolean; grupo: string | null; rondaCerrada: boolean }): { en: string; es: string } | null {
  if (puedeDecidir(opts)) return null;
  if (opts.rondaCerrada) {
    return { en: "This round is closed. An admin can reopen it.", es: "Esta ronda está cerrada. Un administrador puede reabrirla." };
  }
  if (!opts.esDecisor) {
    return { en: "Only the store's Office Manager or Office decides.", es: "Solo el Gerente de Oficina o la Oficina de la tienda decide." };
  }
  return {
    en: "Your store has no promo group yet. An admin sets it in Data → Stores.",
    es: "Tu tienda todavía no tiene grupo de promociones. Un administrador lo pone en Datos → Tiendas.",
  };
}

export interface FilaDeDecision {
  round_id: string;
  code: string;
  group_code: string;
  status: EstadoDeDecision;
  /** **Ausente a propósito** cuando no se está cambiando la nota. Ver abajo. */
  note?: string | null;
}

/**
 * Las filas que se escriben al decidir, en bloque o de una en una — **es la misma operación**.
 *
 * Van por `upsert` sobre la clave primaria `(round_id, code, group_code)`: un producto sin decidir
 * todavía no tiene fila, y uno ya decidido la tiene. Distinguir los dos casos en la pantalla sería
 * un `if` que se puede equivocar; la base ya sabe cuál es cuál.
 *
 * `decided_by` y `decided_at` **no se mandan**: los pisa el disparador de la 140 con `auth.uid()` y
 * `now()`. Mandarlos sería escribir algo que va a ser ignorado, y leerlo de vuelta como si lo
 * hubiéramos puesto nosotros.
 *
 * ---
 *
 * **LA NOTA SOLO VIAJA CUANDO LA NOTA ES LO QUE SE CAMBIA**, y esto es un arreglo, no una
 * preferencia. La primera versión mandaba `note: null` siempre que la llamada no traía nota, así
 * que **aprobar veinte productos en bloque borraba la nota de los que la tuvieran** — en silencio.
 * La regla del dueño, escrita en su propia hoja, es *«MANAGERS CAN … WRITE DOWN NOTES (EX.
 * DISCONTINUED ITEM)»*: la nota es lo único que el gerente aporta además del sí o el no, y el uso
 * natural —anotar «descontinuado» en tres, rechazarlos, y luego aprobar todo lo pendiente de
 * golpe— era justo el que la borraba.
 *
 * Al omitir la clave, el `on conflict do update` que arma PostgREST **solo toca las columnas que
 * van en el lote**, así que la nota existente se queda como está y una fila nueva la recibe vacía
 * por el defecto de la columna. Por eso **todas las filas de una misma llamada llevan las mismas
 * claves**: PostgREST saca las columnas del lote entero, y mezclar filas con `note` y sin `note`
 * en el mismo `upsert` es otra trampa. Aquí sale solo porque la decisión se toma una vez, fuera
 * del bucle.
 */
export function cambioEnBloque(opts: {
  roundId: string;
  grupo: string;
  codigos: readonly string[];
  estado: EstadoDeDecision;
  /** Sin este argumento, la nota **no se toca**. Con él, se escribe (vacía = se borra). */
  nota?: string | null;
}): FilaDeDecision[] {
  const cambiaLaNota = opts.nota !== undefined;
  const nota = cambiaLaNota ? (opts.nota ?? "").trim() || null : null;
  const vistos = new Set<string>();
  const out: FilaDeDecision[] = [];
  for (const code of opts.codigos) {
    if (vistos.has(code)) continue;
    vistos.add(code);
    const fila: FilaDeDecision = {
      round_id: opts.roundId,
      code,
      group_code: opts.grupo,
      status: opts.estado,
    };
    if (cambiaLaNota) fila.note = nota;
    out.push(fila);
  }
  return out;
}

/** El tope de la nota, copiado de `promo_decisions_nota_tamano` (140). */
export const LARGO_DE_NOTA = 500;
