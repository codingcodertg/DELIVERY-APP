/**
 * Los datos fijos de la tarjeta, copiados del `index.html` del contratista (Axen), uno por uno: marca, tiendas,
 * horario, redes, reseñas y mapas. Son los que el dueño debe confirmar. Lo que cambie por persona (nombre, rol,
 * tienda, teléfonos, correo, fotos) NO vive aquí: va en la tabla `business_cards`.
 */

export const CLAVES_DE_TIENDA = ["brownsville", "pharr", "mcallen", "edinburg", "mission", "weslaco"] as const;
export type ClaveDeTienda = (typeof CLAVES_DE_TIENDA)[number];

export function esClaveDeTienda(valor: unknown): valor is ClaveDeTienda {
  return typeof valor === "string" && (CLAVES_DE_TIENDA as readonly string[]).includes(valor);
}

export interface Tienda {
  clave: ClaveDeTienda;
  ciudad: string;
  direccion: string;
  /** Id del lugar en Google (para la reseña y el mapa). */
  placeId: string;
  /** Fotos del showroom, en `public/tarjetas/stores/`. Sin fotos, sin carrusel. */
  fotos: readonly string[];
}

/** Marca y enlaces de siempre. Una red en "" no se enseña. */
export const MARCA = {
  nombre: "Rodriguez Tile Group",
  web: "https://rdztilegroup.com",
  youtube: "https://www.youtube.com/watch?v=svAk4OJ_84k",
  facebook: "https://www.facebook.com/profile.php?id=100063856577819",
  instagram: "https://www.instagram.com/rodrigueztilegroup",
  tiktok: "https://www.tiktok.com/@rodrigueztilegroup",
} as const;

/** Horario mostrado en cada tienda. El contratista lo marcó como pendiente de confirmar («TODO: Jose confirma»). */
export const HORARIO = {
  es: "Lun–Sáb 8 AM – 6 PM · Dom cerrado",
  en: "Mon–Sat 8 AM – 6 PM · Sun closed",
} as const;

export const TIENDAS: Readonly<Record<ClaveDeTienda, Tienda>> = {
  weslaco: {
    clave: "weslaco",
    ciudad: "Weslaco",
    direccion: "1102 W Expressway, Weslaco, TX 78599",
    placeId: "ChIJZyEwJKB3ZYYRGP7nOUt2j7U",
    fotos: [1, 2, 3, 4, 5, 6].map((n) => `/tarjetas/stores/weslaco-${n}.jpg`),
  },
  brownsville: {
    clave: "brownsville",
    ciudad: "Brownsville",
    direccion: "3913 North Expy, Brownsville, TX 78520",
    placeId: "ChIJ-9kC47uWb4YR1qU7LnqFXAU",
    // El original pedía también brownsville-7.jpg, que no está en assets/stores: se quita.
    fotos: [9, 2, 3, 4, 5, 6, 10, 8].map((n) => `/tarjetas/stores/brownsville-${n}.jpg`),
  },
  mcallen: {
    clave: "mcallen",
    ciudad: "McAllen",
    direccion: "4301 W US Business 83, McAllen, TX 78501",
    placeId: "ChIJfZ-tE6GnZYYRZkSoag-EiQc",
    fotos: [1, 2, 3, 4].map((n) => `/tarjetas/stores/mcallen-${n}.jpg`),
  },
  pharr: {
    clave: "pharr",
    ciudad: "Pharr",
    direccion: "1120 E Expressway 83, Pharr, TX 78577",
    placeId: "ChIJ-7Sw2mWgZYYR5jJeYPWP8Jg",
    fotos: [1, 2, 3, 4, 5, 6, 7].map((n) => `/tarjetas/stores/pharr-${n}.jpg`),
  },
  mission: {
    clave: "mission",
    ciudad: "Mission",
    direccion: "4105 N Conway Ave, Palmhurst, TX 78573",
    placeId: "ChIJb2Zal5CoZYYRD2YhYZxt1X0",
    fotos: [1, 2, 3, 4, 5, 6].map((n) => `/tarjetas/stores/mission-${n}.jpg`),
  },
  edinburg: {
    clave: "edinburg",
    ciudad: "Edinburg",
    direccion: "4201 W University Dr, Edinburg, TX 78539",
    placeId: "ChIJTeIcybejZYYRrFbNApAcf6I",
    fotos: [],
  },
};

/** Enlace a la página de reseña de Google de la tienda. */
export function enlaceDeResena(tienda: Tienda): string {
  return `https://search.google.com/local/writereview?placeid=${tienda.placeId}`;
}

/** Enlace al mapa de la tienda (la búsqueda de la marca con la dirección, fijada al lugar de Google). */
export function enlaceDeMapa(tienda: Tienda): string {
  const q = encodeURIComponent(`${MARCA.nombre} ${tienda.direccion}`);
  return `https://www.google.com/maps/search/?api=1&query=${q}&query_place_id=${tienda.placeId}`;
}

/** El id del video de YouTube de la marca (para la miniatura y el reproductor). */
export function idDeVideo(url: string): string | null {
  const m = /(?:youtu\.be\/|v=|shorts\/|embed\/|live\/)([\w-]{11})/.exec(url);
  return m ? m[1] : null;
}
