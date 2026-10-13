import type { MapLine, MapPoint } from "@/components/LeafletMap";
import { rutaDeLaLinea } from "@/lib/mapa-de-rutas";
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

/**
 * Las marcas del mapa del Gestor que son de ESTA ruta: su base (`__depot__<id>`), su fin si termina en otra tienda
 * (`__fin__<id>`), sus recogidas en tienda (`__parada__<key>__N`) y sus entregas (el id de la orden). Todas encendidas:
 * en la foto no hay otras rutas que atenuar. Sin `offset`: el abanico era para no taparse con las demás rutas.
 */
export function puntosDeLaRuta(points: readonly MapPoint[], carril: CarrilParaLaFoto, ordenes: ReadonlySet<string>): MapPoint[] {
  return points
    .filter((p) =>
      p.id === `__depot__${carril.id}` || p.id === `__fin__${carril.id}` || p.id.startsWith(`__parada__${carril.key}__`) || ordenes.has(p.id))
    .map((p) => { const { offset: _o, ...resto } = p; return { ...resto, dimmed: false }; });
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

/** Cuántos pallets lleva la ruta, como lo cuenta la hoja de carga: confirmados o estimados. */
export function palletsDeLaFoto(stops: readonly Delivery[]): number {
  return stops.reduce((n, d) => n + (d.actual_pallets ?? d.est_pallets ?? 0), 0);
}

/** `ruta-maximo-garza-2026-10-12.png`: sin acentos ni espacios, para que llegue igual por WhatsApp o correo. */
export function nombreDelPng(chofer: string, fecha: string): string {
  const limpio = chofer.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "ruta";
  return `ruta-${limpio}-${fecha.slice(0, 10)}.png`;
}

/** ¿El navegador puede compartir un fichero (la hoja de compartir del teléfono: WhatsApp, correo…)? En escritorio casi nunca. */
export function puedeCompartirFicheros(nav: Pick<Navigator, "canShare" | "share"> | undefined, fichero: File): boolean {
  return !!nav && typeof nav.share === "function" && typeof nav.canShare === "function" && nav.canShare({ files: [fichero] });
}
