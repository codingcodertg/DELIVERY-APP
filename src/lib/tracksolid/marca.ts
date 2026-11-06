import type { EstadoDelCamion } from "./camiones";

// ============================================================
// El dibujo de un camión de TrackSolid en el mapa (D-NEXT). Un solo SVG para los DOS mapas (Leaflet lo
// mete en un divIcon, Google como data-URI), igual que `store-pins`: así no pueden decir cosas distintas.
//
// Cuadrado redondeado, a propósito distinto del círculo 🚚 de los teléfonos de los choferes: son dos
// fuentes (el rastreador del camión y el teléfono de la persona) y en el mapa se tienen que distinguir.
// La esquina dice el estado: verde en movimiento, ámbar detenido con motor, gris estacionado.
// Sin señal: gris, borde a rayas y un «!» rojo — es dónde ESTABA, no dónde está.
// ============================================================

/** Una marca de camión, lista para cualquiera de los dos mapas. La página decide los textos. */
export interface TruckMarker {
  /** IMEI: la clave estable de la marca. */
  id: string;
  lat: number;
  lng: number;
  color: string;
  estado: EstadoDelCamion;
  /** Bajo la marca, siempre visible («Juan · 40 mph»). */
  etiqueta: string;
  /** Cabecera de la tarjeta que se abre al tocarla. */
  titulo: string;
  /** Las líneas de la tarjeta. */
  lineas: string[];
}

export const LADO_DEL_CAMION = 36;
/** Por encima de los pines de las órdenes (500), por debajo del teléfono del chofer (1500). */
export const Z_CAMION = 1400;
const GRIS_SIN_SENAL = "#8b95a3";
const PUNTO: Record<Exclude<EstadoDelCamion, "stale">, string> = { moving: "#16a34a", idling: "#f59e0b", parked: "#64748b" };

export function svgDelCamion(color: string, estado: EstadoDelCamion): string {
  const sinSenal = estado === "stale";
  const relleno = sinSenal ? GRIS_SIN_SENAL : color.replace(/[^#\w(),.% -]/g, "");
  const esquina = sinSenal
    ? `<circle cx="29" cy="7" r="6.5" fill="#dc2626" stroke="#fff" stroke-width="1.5"/><text x="29" y="10.5" text-anchor="middle" font-family="sans-serif" font-size="10" font-weight="700" fill="#fff">!</text>`
    : `<circle cx="29" cy="7" r="5.5" fill="${PUNTO[estado]}" stroke="#fff" stroke-width="2"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${LADO_DEL_CAMION}" height="${LADO_DEL_CAMION}" viewBox="0 0 36 36">` +
    `<rect x="3" y="5" width="28" height="28" rx="7" fill="${relleno}" stroke="${sinSenal ? "#475569" : "#fff"}" stroke-width="${sinSenal ? 2 : 3}"${sinSenal ? ' stroke-dasharray="4 3"' : ""} opacity="${sinSenal ? 0.85 : 1}"/>` +
    `<text x="17" y="25" text-anchor="middle" font-size="16"${sinSenal ? ' opacity="0.55"' : ""}>🚛</text>${esquina}</svg>`;
}

const escapa = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** La tarjeta que se abre en el sitio al tocar el camión (ventana del propio mapa; no navega a ningún lado). */
export function tarjetaDelCamion(c: Pick<TruckMarker, "titulo" | "lineas" | "estado">): string {
  return `<div data-tarjeta-camion="${c.estado}" style="font:13px/1.45 system-ui,sans-serif;color:#111;min-width:190px;max-width:260px">` +
    `<div style="font-weight:700;margin-bottom:2px">🚛 ${escapa(c.titulo)}</div>` +
    c.lineas.map((l, i) => `<div style="${i === 0 && c.estado === "stale" ? "color:#b91c1c;font-weight:600" : i === 0 ? "font-weight:600" : "color:#475569"}">${escapa(l)}</div>`).join("") +
    `</div>`;
}

/** La etiqueta bajo la marca, para Leaflet (Google usa la suya, con la clase `etiqueta-camion`). */
export function etiquetaHtmlDelCamion(c: Pick<TruckMarker, "etiqueta" | "estado">): string {
  return `<div style="position:absolute;left:50%;top:${LADO_DEL_CAMION - 1}px;transform:translateX(-50%);white-space:nowrap;pointer-events:none;` +
    `font:700 11px/1.2 system-ui,sans-serif;color:${c.estado === "stale" ? "#475569" : "#0f172a"};` +
    `text-shadow:-1px -1px 0 #fff,1px -1px 0 #fff,-1px 1px 0 #fff,1px 1px 0 #fff,0 0 3px #fff">${escapa(c.etiqueta)}</div>`;
}
