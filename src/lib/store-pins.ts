// ============================================================
// Las tiendas en el mapa del selector de pin (D-NEXT).
//
// Pedido del dueño: «donde se pone set location, pon los puntos donde están las tiendas siempre,
// para referencia». Al soltar el pin de una entrega no había ningún punto conocido con el que
// compararlo: el mapa enseñaba calles y un pin, y de dónde sale el camión no se veía.
//
// Aquí vive lo puro: qué papel tiene cada tienda, con qué estilo se dibuja, y **la geometría del
// dibujo**. Los dos motores (Google y Leaflet) piden cosas distintas —una URL `data:` el primero,
// HTML dentro de un `divIcon` el segundo— pero los dos aceptan el MISMO SVG, así que el marcador
// se escribe una vez y no dos. `MapView` conmuta según haya llave de navegador (D-219), y una
// tienda que se viera en un motor y no en el otro dejaría media producción sin el arreglo.
// ============================================================

/**
 * Qué es esta tienda para el pedido que se está editando.
 *
 *  - `origen`: la tienda de `d.store`, desde la que se cuentan las millas. Es el dato que convierte
 *    el mapa en «de aquí a aquí», así que se dibuja destacada y con su nombre siempre visible.
 *  - `otra`: las demás, apagadas. Están para dar referencia, no para competir con la entrega.
 *
 * `undefined` (el campo ausente) es el tercer caso y **no está en esta unión a propósito**: es el
 * marcador rojo clásico de los mapas de despacho, que esta rama no toca. Ver `TIENDA_CLASICA`.
 */
export type PapelTienda = "origen" | "otra";

/**
 * Los nombres se comparan **normalizados**: sin espacios de sobra ni mayúsculas.
 *
 * `d.store` es una cadena y `settings.stores` otra lista de cadenas; nadie garantiza que un
 * nombre guardado hace meses tenga exactamente los mismos espacios que el de Ajustes hoy. Una
 * comparación estricta fallaría **en silencio**: el destacado simplemente no aparecería y nadie
 * sabría por qué. Es el mismo tipo de fallo mudo que el `catch {}` del geocodificado.
 */
export function nombreNormalizado(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** El papel de cada tienda para este pedido. Sin tienda elegida, todas son referencia. */
export function tiendasParaElMapa<T extends { name: string }>(
  tiendas: T[],
  tiendaDelPedido: string | null | undefined,
): (T & { papel: PapelTienda })[] {
  const buscada = nombreNormalizado(tiendaDelPedido);
  return tiendas.map((t) => ({
    ...t,
    papel: (buscada && nombreNormalizado(t.name) === buscada ? "origen" : "otra") as PapelTienda,
  }));
}

export interface EstiloTienda {
  /** Relleno del cuadrado. */
  fill: string;
  /** Lado del cuadrado en px. */
  lado: number;
  /** Grosor del borde blanco. */
  grosor: number;
  /** El nombre siempre a la vista, sin pasar el ratón. Solo la tienda del pedido. */
  etiquetaPermanente: boolean;
  /** Por encima de los pines de pedido, por debajo de los camiones en vivo. */
  zIndex: number;
}

/**
 * El azul y el gris, y por qué llevan un literal detrás.
 *
 * Ni Leaflet ni Google aceptan una variable CSS en sus opciones, igual que con el verde de la zona
 * (`delivery-zone.ts`). Se lee la variable del tema en tiempo de ejecución y el literal solo entra
 * si no hay DOM. **No son colores inventados**: son exactamente `--accent` y `--gray` de
 * `globals.css:9` y `:16`. Si alguien cambia el tema, el `getComputedStyle` gana.
 *
 * Y por qué **ni rojo ni verde**: el pin de la entrega es 📍, rojo, y la zona local es verde
 * (D-219). Una tienda roja al lado del pin rojo obliga a mirar dos veces para saber cuál es la
 * entrega — que es justo lo que el dueño no tiene que hacer.
 */
export const AZUL_ORIGEN_FALLBACK = "#2456c9"; // = --accent (globals.css:9)
export const GRIS_OTRA_FALLBACK = "#6b7686";   // = --gray  (globals.css:16)

export function colorTienda(papel: PapelTienda): string {
  const variable = papel === "origen" ? "--accent" : "--gray";
  const respaldo = papel === "origen" ? AZUL_ORIGEN_FALLBACK : GRIS_OTRA_FALLBACK;
  if (typeof document === "undefined") return respaldo;
  const v = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return v || respaldo;
}

/** Destacada: más grande, en azul y con el nombre puesto. Referencia: pequeña y gris. */
export function estiloTienda(papel: PapelTienda): EstiloTienda {
  return papel === "origen"
    ? { fill: colorTienda("origen"), lado: 26, grosor: 3, etiquetaPermanente: true, zIndex: 900 }
    : { fill: colorTienda("otra"), lado: 18, grosor: 2, etiquetaPermanente: false, zIndex: 800 };
}

/** Lo que un motor necesita para colocar el dibujo: el SVG y dónde cae su centro. */
export interface DibujoTienda {
  svg: string;
  ancho: number;
  alto: number;
  /** El punto del SVG que va sobre la coordenada — el centro del cuadrado, no el del lienzo. */
  anclaX: number;
  anclaY: number;
}

/** Un `&`, un `<` o un `>` en el nombre de una tienda romperían el SVG. Fuera, como en `pinIcon`. */
const sinMarcas = (s: string) => s.replace(/[<>&"]/g, "");

/**
 * El marcador: un **cuadrado** con una línea de toldo, no una gota.
 *
 * La forma es la mitad del trabajo. El pin de la entrega es una gota (📍) y los pines de pedido
 * son círculos; un cuadrado no se confunde con ninguno de los dos ni en blanco y negro, que es la
 * prueba de que la diferencia no depende solo del color.
 *
 * El nombre va **dentro del propio SVG**, sobre una pastilla blanca, y no como etiqueta del motor:
 * así los dos mapas enseñan exactamente lo mismo sin depender de una clase CSS que cada motor
 * coloca a su manera.
 */
export function dibujoTienda(estilo: EstiloTienda, nombre: string): DibujoTienda {
  const { lado, fill, grosor } = estilo;
  const texto = estilo.etiquetaPermanente ? sinMarcas(nombre) : "";
  // Ancho de la pastilla a ojo por caracter: una fuente de sistema a 11px ronda los 6.2px de avance.
  const anchoTexto = texto ? Math.ceil(texto.length * 6.2) + 14 : 0;
  const ancho = Math.max(lado + grosor * 2 + 2, anchoTexto);
  const alto = lado + grosor * 2 + 2 + (texto ? 20 : 0);
  const x = (ancho - lado) / 2;
  const y = grosor + 1;
  const anclaX = ancho / 2;
  const anclaY = y + lado / 2;

  const cuadrado =
    `<rect x="${x}" y="${y}" width="${lado}" height="${lado}" rx="${Math.round(lado / 5)}" ` +
    `fill="${fill}" stroke="#fff" stroke-width="${grosor}"/>` +
    // El toldo: dos tercios del ancho, a un tercio de la altura. Sugiere una fachada sin pedir
    // detalle que a 18px no se vería.
    `<path d="M${x + lado / 6} ${y + lado / 2.6}H${x + lado - lado / 6}" stroke="#fff" ` +
    `stroke-width="${Math.max(1.5, grosor - 0.5)}" stroke-linecap="round"/>`;

  const etiqueta = texto
    ? `<rect x="0" y="${alto - 18}" width="${ancho}" height="16" rx="8" fill="#fff" opacity="0.92"/>` +
      `<text x="${ancho / 2}" y="${alto - 6}" text-anchor="middle" font-family="sans-serif" ` +
      `font-size="11" font-weight="700" fill="${fill}">${texto}</text>`
    : "";

  return {
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}" ` +
      `viewBox="0 0 ${ancho} ${alto}">${cuadrado}${etiqueta}</svg>`,
    ancho,
    alto,
    anclaX,
    anclaY,
  };
}

/** El mismo dibujo como URL `data:`, que es lo que quiere un `Marker` de Google. */
export function dibujoTiendaUrl(estilo: EstiloTienda, nombre: string): DibujoTienda & { url: string } {
  const d = dibujoTienda(estilo, nombre);
  return { ...d, url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(d.svg)}` };
}

/**
 * El marcador rojo de siempre, el de los mapas de despacho — aquí para que deje de estar escrito
 * dos veces (una en cada motor) y no para cambiarlo.
 *
 * El `#e11414` **no** es una variable del tema y no se toca en esta rama: cuatro pantallas
 * (Mapa, Rutas, Mi ruta y Rastreo) llevan meses con ese rojo, y cambiarlo aquí sería colar un
 * cambio visual en cuatro sitios dentro de un encargo que pedía otra cosa. Queda dicho, con su
 * valor a la vista, para que quien lo cambie algún día sepa que toca los cuatro a la vez.
 */
export const TIENDA_CLASICA = { fill: "#e11414", diametro: 24, borde: "#fff", grosor: 3 } as const;
