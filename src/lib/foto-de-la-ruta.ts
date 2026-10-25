import type { MapLine, MapPoint } from "@/components/LeafletMap";
import { PREFIJO_HECHA, rutaDeLaLinea } from "@/lib/mapa-de-rutas";
import type { ParadaFisica } from "@/lib/gestor/paradas-numeradas";
import { facturasDeLaOrden } from "@/lib/agregar-material";
import { fmtWindows, orderLabel } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

// ============================================================
// «📸 PNG para el chofer» en el Gestor (D-536, 2026-10-12). El dueño: «crea una opcion para crear una imagen png del
// schedule y el mapa con su ruta en el mapa parfa mandarlo al driver».
//
// Una imagen por ruta: la cabecera (chofer, día, paradas, pallets), la lista de paradas en el orden de la ruta y el
// mapa con SOLO esa ruta (su base, sus marcas numeradas y su trazo). Se fotografía con `snapdom` (el mismo de la
// captura de Ayuda, D-513: los mosaicos de Leaflet salen enteros) y se descarga o se comparte (WhatsApp, etc.).
//
// Aquí van las reglas puras: qué marcas y qué líneas del mapa del Gestor son de esa ruta, cómo se encuadra, las filas
// de la lista y el nombre del fichero. El componente (`FotoDeLaRuta.tsx`) solo pinta y fotografía.
// ============================================================

export interface CarrilParaLaFoto { id: string; key: string }

/** Lo que hace falta para numerar la foto de una ruta que el mapa del Gestor deja sin números (D-678). */
export interface NumerosDeLaFoto {
  /** Las paradas del DÍA de la ruta (`diaDe(...).paradas`): los números de la tabla. */
  paradas: readonly ParadaFisica[];
  /** El color del chofer, para las recogidas que hay que añadir. */
  color: string;
  coordsDeTienda: (nombre: string | null) => { lat: number; lng: number } | null;
}

/**
 * Las marcas del mapa del Gestor que son de ESTA ruta: su base (`__depot__<id>`), su fin si termina en otra tienda
 * (`__fin__<id>`), sus recogidas en tienda (`__parada__<key>__N`), sus entregas (el id de la orden) y lo ya hecho de esas
 * órdenes (`__hecha__<id>`, D-678). Todas encendidas: en la foto no hay otras rutas que atenuar. Sin `offset`: el abanico
 * era para no taparse con las demás rutas.
 *
 * D-678 (el dueño, 2026-10-24, con la foto de Maximo Garza: «no se miran los numeros»): una ruta que aún no tiene orden
 * guardado (`route_seq` vacío en todas) sale en el mapa del Gestor sin números —un punto por entrega y ninguna recogida—,
 * pero su tabla sí los lleva. Con `numeros`, la foto se numera como la tabla: cada entrega con el número de su parada y
 * cada recogida con su marca en la tienda. Solo si el mapa no trae ya ningún número, para no pisar los del Gestor.
 */
export function puntosDeLaRuta(points: readonly MapPoint[], carril: CarrilParaLaFoto, ordenes: ReadonlySet<string>, numeros?: NumerosDeLaFoto): MapPoint[] {
  const deParada = `__parada__${carril.key}__`;
  const idDeLaOrden = (id: string) => (id.startsWith(PREFIJO_HECHA) ? id.slice(PREFIJO_HECHA.length) : id);
  const out = points
    .filter((p) =>
      p.id === `__depot__${carril.id}` || p.id === `__fin__${carril.id}` || p.id.startsWith(deParada) || ordenes.has(idDeLaOrden(p.id)))
    .map((p) => { const { offset: _o, ...resto } = p; return { ...resto, dimmed: false }; });
  if (!numeros || out.some((p) => p.id.startsWith(deParada) || (ordenes.has(idDeLaOrden(p.id)) && !!p.badge))) return out;
  const numerosDe = new Map<string, number[]>();
  for (const p of numeros.paradas) {
    if (p.tipo !== "D") continue;
    for (const id of p.ordenes) numerosDe.set(id, [...(numerosDe.get(id) ?? []), p.numero]);
  }
  const numeradas = out.map((p) => {
    const n = ordenes.has(idDeLaOrden(p.id)) ? numerosDe.get(idDeLaOrden(p.id)) : undefined;
    return n ? { ...p, badge: n.join("·") } : p;
  });
  const recogidas: MapPoint[] = numeros.paradas.flatMap((p) => {
    const tienda = p.tipo === "P" ? numeros.coordsDeTienda(p.lugar) : null;
    return tienda ? [{ id: `${deParada}${p.numero}`, lat: tienda.lat, lng: tienda.lng, color: numeros.color, badge: String(p.numero), label: `${p.etiquetas.join(", ")} · ${p.lugar}`, dimmed: false }] : [];
  });
  // Las recogidas detrás de la base: así la «P» de la base no tapa su número (Leaflet pinta encima lo último).
  const [bases, resto] = [numeradas.filter((p) => p.id.startsWith("__depot__") || p.id.startsWith("__fin__")), numeradas.filter((p) => !p.id.startsWith("__depot__") && !p.id.startsWith("__fin__"))];
  return [...bases, ...recogidas, ...resto];
}

/** Las líneas de ESTA ruta: su trazo medido (`line:`/`ret:`) o el de su plan publicado (`plan:`). Encendidas, sin desplazar. */
export function lineasDeLaRuta(lines: readonly MapLine[], laneKey: string): MapLine[] {
  return lines
    .filter((l) => rutaDeLaLinea(l.id) === laneKey || l.id === `plan:${laneKey}`)
    .map((l) => ({ ...l, dimmed: false, offset: 0 }));
}

/** Lo que el mapa de la foto encuadra: todas sus marcas y todo su trazo. Vacío si no hay nada (el mapa se queda como está). */
export function encuadreDeLaFoto(points: readonly MapPoint[], lines: readonly MapLine[]): [number, number][] {
  const out: [number, number][] = points.map((p) => [p.lat, p.lng]);
  for (const l of lines) for (const pos of l.positions) out.push(pos);
  return out;
}

export interface FilaDeLaFoto { n: number; orden: string; cuenta: string; direccion: string; ventana: string; pallets: string }

/** Las filas de la lista, en el orden de la ruta: lo mismo que la hoja de carga (`htmlDeLasHojasDeCarga`), sin la columna de referencias. */
export function filasDeLaFoto(stops: readonly Delivery[]): FilaDeLaFoto[] {
  return stops.map((d, i) => ({
    n: i + 1,
    orden: facturasDeLaOrden(d).join(", ") || `#${orderLabel(d)}`,
    cuenta: d.account || d.delivery_name || "—",
    direccion: d.delivery_address || "—",
    ventana: fmtWindows(d.delivery_windows),
    pallets: String(d.actual_pallets ?? d.est_pallets ?? "—"),
  }));
}

/**
 * Cuántos pallets lleva la ruta, como lo cuenta la hoja de carga: confirmados o estimados. Redondeado a centésimas
 * (D-678): 0.2 + 0.25 + … daba «12.399999999999999 pallets» en la cabecera de la foto.
 */
export function palletsDeLaFoto(stops: readonly Delivery[]): number {
  const n = stops.reduce((s, d) => s + Number(d.actual_pallets ?? d.est_pallets ?? 0), 0);
  return Math.round(n * 100) / 100;
}

/** `ruta-maximo-garza-2026-10-12.png`: sin acentos ni espacios, para que llegue igual por WhatsApp o correo. */
export function nombreDelPng(chofer: string, fecha: string): string {
  const limpio = chofer.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "ruta";
  return `ruta-${limpio}-${fecha.slice(0, 10)}.png`;
}

/**
 * D-636: el ancho de la tabla del Gestor que entra en la foto: entera menos la última columna, la de las flechas y
 * acciones (al chofer no le sirven). Si la medida no tiene sentido (sin columna o más ancha que la tabla), la tabla entera.
 */
export function anchoSinAcciones(anchoDeLaTabla: number, anchoDeLaUltima: number): number {
  if (!(anchoDeLaUltima > 0) || anchoDeLaUltima >= anchoDeLaTabla) return anchoDeLaTabla;
  return anchoDeLaTabla - anchoDeLaUltima;
}

/** D-636: lo que no sale en la foto de la tabla del Gestor: las casillas de marcar y las asas de ancho (se esconden sin mover nada). */
export const FUERA_DE_LA_TABLA = ['input[type="checkbox"]', ".col-resizer"] as const;

/** ¿El navegador puede compartir un fichero (la hoja de compartir del teléfono: WhatsApp, correo…)? En escritorio casi nunca. */
export function puedeCompartirFicheros(nav: Pick<Navigator, "canShare" | "share"> | undefined, fichero: File): boolean {
  return !!nav && typeof nav.share === "function" && typeof nav.canShare === "function" && nav.canShare({ files: [fichero] });
}
