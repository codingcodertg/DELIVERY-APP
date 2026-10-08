/**
 * La escala de la pestaña «📅 Horario» del Gestor de Rutas y de «Ruta de hoy» (D-503). Solo decide QUÉ TRAMO del día se
 * pinta, CUÁNTOS píxeles lleva cada minuto, qué texto cabe en cada barra y qué filas salen. No toca el motor ni las horas:
 * las barras siguen saliendo de `barrasDeLaRuta` (D-417) con la misma hora de salida.
 *
 * El dueño, 2026-10-08, con una captura del Horario: «mira que fe se  mira si todos estan concentados ahi pues que se haga un
 * zoom y si stevene no tiene nada que no salga». En la captura el eje iba de 07:00 a 19:00 con desplazamiento lateral, todas
 * las paradas apretadas entre 08:30 y 10:00, las etiquetas cortadas («99», «14», «#!») y una fila «Steven» vacía.
 *
 * - **El tramo** es el de las paradas (de la primera llegada al último fin de descarga), con 30 min de margen a cada lado y
 *   redondeado a la media hora. Las ventanas NO lo estiran: una ventana de 08:00 a 17:00 deshacía el zoom entero; su raya se
 *   corta en el borde y la ventana entera sigue en el `title` de la barra. La salida de la base (08:00) tampoco: con la
 *   primera parada a las 14:00 (esperando a que abra su ventana), la mañana entera sería pista vacía.
 * - **La escala** llena el ancho que hay (sin desplazamiento lateral en una pantalla grande). Con pocas paradas muy juntas
 *   el minuto crece, hasta un tope (8 px/min); pasado el tope, el tramo se abre por los dos lados para seguir llenando el
 *   ancho. En el teléfono (pista de menos de 480 px) no baja de 2 px/min: una descarga de 15 min mide 30 px, y la línea se
 *   desplaza de lado, como antes (D-417).
 * - **＋ / － / Ajustar**: el zoom es un factor sobre lo ajustado (1 = ajustado). ＋ acerca hasta 24 px/min (con
 *   desplazamiento lateral); － aleja hasta ver 12 horas (o el tramo entero, si es más largo); «Ajustar» vuelve al 1.
 */

export const MARGEN_MIN = 30;
/** El tramo se redondea a esto, hacia fuera. */
export const REDONDEO_MIN = 30;
/** Sin ninguna parada que pintar (no debería pintarse nada, pero por si acaso): el día de antes, 07:00–19:00. */
export const TRAMO_SIN_PARADAS: Tramo = { inicio: 7 * 60, fin: 19 * 60 };
export const DIA_MIN = 24 * 60;
/** Tope de píxeles por minuto al AJUSTAR: con dos paradas juntas no se hace una barra de media pantalla. */
export const PX_POR_MIN_AJUSTE_MAX = 8;
/** Tope de ＋. */
export const PX_POR_MIN_MAX = 24;
/** Lo más lejos que lleva －: 12 horas a la vista (o el tramo entero, si es más largo). */
export const ALEJADO_MAX_MIN = 12 * 60;
/** Por debajo de este ancho de pista (el teléfono), el ajuste no baja de `PX_POR_MIN_ESTRECHO`. */
export const PISTA_ESTRECHA_PX = 480;
export const PX_POR_MIN_ESTRECHO = 2;
export const PASO_DE_ZOOM = 1.5;
/** Etiqueta de hora: como mucho una cada tanto, para que no se pisen («08:30» mide ~30 px a 11 px). */
export const SEPARACION_DE_MARCAS_PX = 56;
const PASOS_DE_MARCA = [15, 30, 60, 120, 180, 240] as const;

export interface Tramo { inicio: number; fin: number }

/** El tramo del día con paradas, con margen y redondeado hacia fuera. Solo cuentan las barras: ni las ventanas ni la salida. */
export function tramoDelHorario(barras: readonly { llegadaMin: number; finMin: number }[]): Tramo {
  if (!barras.length) return { ...TRAMO_SIN_PARADAS };
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of barras) {
    lo = Math.min(lo, b.llegadaMin);
    hi = Math.max(hi, b.finMin, b.llegadaMin);
  }
  const inicio = Math.max(0, Math.floor((lo - MARGEN_MIN) / REDONDEO_MIN) * REDONDEO_MIN);
  const fin = Math.min(DIA_MIN, Math.ceil((hi + MARGEN_MIN) / REDONDEO_MIN) * REDONDEO_MIN);
  return { inicio, fin: Math.max(fin, inicio + REDONDEO_MIN) };
}

export interface VistaDelEje {
  /** El minuto del borde izquierdo y el del derecho de la pista. */
  inicio: number;
  fin: number;
  pxPorMin: number;
  /** Ancho de la pista en px: igual al disponible al ajustar; mayor al acercar (se desplaza de lado). `null` sin medir. */
  anchoPista: number | null;
  /** El zoom de verdad, ya dentro de sus topes (lo que se guarda). */
  zoom: number;
  puedeAcercar: boolean;
  puedeAlejar: boolean;
}

const limita = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Píxeles por minuto al ajustar: el tramo llena el ancho, con su tope; en el teléfono, con su mínimo. */
export function pxPorMinAjustado(tramo: Tramo, anchoDisponible: number): number {
  const lleno = anchoDisponible / Math.max(1, tramo.fin - tramo.inicio);
  const minimo = anchoDisponible < PISTA_ESTRECHA_PX ? PX_POR_MIN_ESTRECHO : 0;
  return limita(lleno, minimo, PX_POR_MIN_AJUSTE_MAX);
}

/**
 * Qué se ve con este ancho y este zoom (1 = ajustado). Al alejar (o al topar el ajuste), el tramo se abre por los dos lados,
 * sin salirse del día, para que la pista siga llenando el ancho; al acercar, la pista es más ancha que lo que hay y se
 * desplaza de lado.
 */
export function vistaDelEje(tramo: Tramo, anchoDisponible: number, zoom: number): VistaDelEje {
  if (!(anchoDisponible > 0)) return { ...tramo, pxPorMin: 0, anchoPista: null, zoom: 1, puedeAcercar: false, puedeAlejar: false };
  const span = tramo.fin - tramo.inicio;
  const ajuste = pxPorMinAjustado(tramo, anchoDisponible);
  const pxMin = Math.min(ajuste, anchoDisponible / Math.max(ALEJADO_MAX_MIN, span));
  const pxMax = Math.max(ajuste, PX_POR_MIN_MAX);
  const px = limita(ajuste * (zoom > 0 ? zoom : 1), pxMin, pxMax);
  const visible = Math.max(span, anchoDisponible / px);
  let inicio = tramo.inicio - (visible - span) / 2;
  let fin = inicio + visible;
  if (inicio < 0) { fin -= inicio; inicio = 0; }
  if (fin > DIA_MIN) { inicio = Math.max(0, inicio - (fin - DIA_MIN)); fin = DIA_MIN; }
  return {
    inicio, fin, pxPorMin: px, anchoPista: Math.floor((fin - inicio) * px + 1e-6), zoom: px / ajuste,
    puedeAcercar: px < pxMax - 1e-9, puedeAlejar: px > pxMin + 1e-9,
  };
}

/** El zoom tras pulsar ＋ o －, ya dentro de sus topes (así, pasado el tope, el botón contrario responde a la primera). */
export function siguienteZoom(tramo: Tramo, anchoDisponible: number, zoom: number, hacia: "mas" | "menos"): number {
  const actual = vistaDelEje(tramo, anchoDisponible, zoom);
  return vistaDelEje(tramo, anchoDisponible, hacia === "mas" ? actual.zoom * PASO_DE_ZOOM : actual.zoom / PASO_DE_ZOOM).zoom;
}

/** Posición de un minuto en la pista, en % (0 a 100, sin salirse). */
export function porcentajeEnElEje(vista: Pick<VistaDelEje, "inicio" | "fin">, min: number): number {
  return limita(((min - vista.inicio) / Math.max(1, vista.fin - vista.inicio)) * 100, 0, 100);
}

/** Qué minuto hay bajo una x de la pista (0 = borde izquierdo). Para soltar al arrastrar. */
export function minutoEnLaPista(vista: Pick<VistaDelEje, "inicio" | "fin">, x: number, anchoPista: number): number {
  return vista.inicio + limita(x / Math.max(1, anchoPista), 0, 1) * (vista.fin - vista.inicio);
}

export interface MarcaDelEje { min: number; texto: string; pct: number; alinea: "inicio" | "centro" | "fin" }

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;

/**
 * Las marcas de hora del eje: cada 15, 30, 60… min, el paso más corto con el que dos etiquetas no se pisan. La de un borde
 * se alinea hacia dentro, para no salirse de la pista (la «19:» cortada de antes, y su desplazamiento lateral).
 */
export function marcasDelEje(vista: Pick<VistaDelEje, "inicio" | "fin" | "pxPorMin">): MarcaDelEje[] {
  const px = vista.pxPorMin > 0 ? vista.pxPorMin : 1;
  const paso = PASOS_DE_MARCA.find((p) => p * px >= SEPARACION_DE_MARCAS_PX) ?? PASOS_DE_MARCA[PASOS_DE_MARCA.length - 1];
  const out: MarcaDelEje[] = [];
  const borde = 20 / px; // ~20 px en minutos
  // La tolerancia: un borde que cae en punto por aritmética (300,0000001) sigue llevando su marca.
  for (let m = Math.ceil((vista.inicio - 1e-3) / paso) * paso; m <= vista.fin + 1e-3; m += paso) {
    const alinea = m - vista.inicio < borde ? "inicio" : vista.fin - m < borde ? "fin" : "centro";
    out.push({ min: m, texto: hhmm(m), pct: porcentajeEnElEje(vista, m), alinea });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// La etiqueta de cada barra: completa si cabe; si no, una forma corta; nunca cortada a la mitad.

/** Relleno de la barra (6 px por lado) más 2 px de holgura. */
export const RELLENO_DE_BARRA_PX = 14;

/**
 * Ancho estimado del texto en Inter 700 a 11 px, por lo alto (si se queda corto, el texto se cortaría): para cuando no hay
 * lienzo donde medir (pruebas, servidor). En el navegador se mide de verdad.
 */
export function anchoEstimado(s: string): number {
  let w = 0;
  for (const ch of s) {
    if (ch === "⚠") w += 13;
    else if (" .,:;|!'/-()1iIlj".includes(ch)) w += 4.5;
    else if ("MWmw@%".includes(ch)) w += 10.5;
    else if (/[A-Z#…+]/.test(ch)) w += 8.5;
    else w += 7.5;
  }
  return w;
}

/**
 * Las formas de la etiqueta, de la más larga a la más corta. `principal` es lo que nombra la barra (la factura, o el ID sin
 * factura, D-456). Varias facturas («17938 / 17942»): la primera y cuántas más («17938 +1»). Luego los últimos 4 y 3
 * caracteres de la primera, con «…» delante («…7938», «…938»). Luego el NÚMERO DE PARADA (`parada`, el de la tabla y del
 * mapa, D-485): «3». La que llega tarde lleva «⚠» delante en todas, y al final queda «⚠» sola. La última forma es la vacía:
 * una barra donde no cabe nada no dice nada, y lo dice todo al pasar el ratón.
 */
export function formasDeLaEtiqueta(principal: string, tarde: boolean, parada: number | null = null): string[] {
  const p = principal.trim();
  const partes = p.split(/\s*[/,]\s*/).filter(Boolean);
  const primera = partes[0] ?? p;
  const formas: string[] = [p];
  if (partes.length > 1) formas.push(`${primera} +${partes.length - 1}`);
  const limpia = primera.replace(/^#/, "");
  for (const k of [4, 3]) if (limpia.length > k) formas.push(`…${limpia.slice(-k)}`);
  if (parada != null) formas.push(String(parada));
  const conAviso = (s: string) => (tarde ? `⚠${s}` : s);
  const out = [...new Set(formas.map(conAviso))];
  if (tarde) out.push("⚠");
  out.push("");
  return out;
}

/** La forma más larga que cabe en `anchoPx` (el ancho de la barra, o hasta la siguiente si se pisan). */
export function etiquetaQueCabe(
  principal: string, tarde: boolean, anchoPx: number, mide: (s: string) => number = anchoEstimado, parada: number | null = null,
): string {
  for (const f of formasDeLaEtiqueta(principal, tarde, parada)) if (f === "" || mide(f) + RELLENO_DE_BARRA_PX <= anchoPx) return f;
  return "";
}

/**
 * El número de PARADA de cada entrega (D-485: el de la tabla y el del mapa, que cuenta también la parada en la tienda), a
 * partir de las filas de la lectura de la ruta y del número de cada fila (`paradasDeLaRuta(...).deFila`). Una orden con dos
 * filas D (repartida en dos cargas) se queda con la primera.
 */
export function paradaDeCadaEntrega(filas: readonly ({ tipo: "P" } | { tipo: "D"; orden: string })[], deFila: readonly number[]): Map<string, number> {
  const out = new Map<string, number>();
  filas.forEach((f, i) => { if (f.tipo === "D" && deFila[i] != null && !out.has(f.orden)) out.set(f.orden, deFila[i]); });
  return out;
}

/** El ancho para el texto de cada barra de una fila: el suyo, o hasta donde empieza la siguiente si la pisa. En px. */
export function anchosParaElTexto(barras: readonly { id: string; izquierda: number; ancho: number }[]): Map<string, number> {
  const orden = [...barras].sort((a, b) => a.izquierda - b.izquierda);
  const out = new Map<string, number>();
  orden.forEach((b, i) => {
    const siguiente = orden[i + 1];
    out.set(b.id, siguiente ? Math.max(0, Math.min(b.ancho, siguiente.izquierda - b.izquierda)) : b.ancho);
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Quién sale y dónde se queda el desplazamiento.

/**
 * Las filas del horario: solo las rutas con alguna parada que pintar ese día, y que pasan el filtro de choferes del panel
 * (D-488). Antes el Gestor pintaba también las vacías para poder soltar en ellas (D-417); el dueño: «si stevene no tiene nada
 * que no salga». A un chofer sin nada se le asigna desde «Sin asignar», «Asignar a…» o el tablero.
 */
export function filasDelHorario<T extends { key: string; barras: readonly unknown[] }>(filas: readonly T[], pasaFiltro: (ruta: string) => boolean): T[] {
  return filas.filter((f) => f.barras.length > 0 && pasaFiltro(f.key));
}

/** El minuto que está en el centro de lo que se ve de la pista (para que ＋/－ acerquen sobre él, sin saltar al principio). */
export function minutoEnElCentro(vista: Pick<VistaDelEje, "inicio" | "pxPorMin">, desplazamiento: number, anchoVisible: number): number {
  return vista.inicio + (desplazamiento + anchoVisible / 2) / (vista.pxPorMin || 1);
}

/** El desplazamiento que deja `minuto` en el centro de lo que se ve, sin pasarse de los bordes. */
export function desplazamientoParaCentrar(vista: Pick<VistaDelEje, "inicio" | "pxPorMin" | "anchoPista">, minuto: number, anchoVisible: number): number {
  const max = Math.max(0, (vista.anchoPista ?? 0) - anchoVisible);
  return Math.round(limita((minuto - vista.inicio) * vista.pxPorMin - anchoVisible / 2, 0, max));
}
