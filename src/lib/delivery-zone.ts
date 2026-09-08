import { pointInPolygon, type LatLng } from "@/lib/geo";

// ============================================================
// La zona local de entrega, decidida por DÓNDE está la entrega y no por cómo se escribió la
// dirección (D-219).
//
// Hasta ahora la zona salía del nombre de la ciudad: `cityFromAddress` sacaba una palabra de la
// dirección y se comparaba con una lista. Falla por lo que falla siempre sacar datos de texto
// libre: en las filas reales hay direcciones que terminan en «TX», en el código postal, o en
// minúsculas y sin comas, y ahí no hay ciudad que reconocer. Una entrega a dos calles del
// almacén podía salir NO LOCAL —y con eso, aprobación del gerente y la tarifa alta— porque
// alguien escribió la dirección de otra manera.
//
// El punto sí es fiable: el 91 % de los pedidos tienen `delivery_lat`/`delivery_lng` (medición
// del orquestador sobre producción, 2026-09-08: 102 de 112, de los cuales 97 geocodificados y 5
// puestos a mano). Así que la zona se decide con el punto cuando lo hay, y solo cuando no lo hay
// se cae al comportamiento de siempre.
//
// **El borde sur es el Río Grande**, y eso no es un detalle geométrico: es lo que pidió el dueño
// («obviamente north del río para que siga en el US»). Cualquier punto en México queda fuera por
// construcción, sin ninguna regla especial que mantener.
//
// Puro: sin React, sin red. El polígono entra como dato.
// ============================================================

/** Un vértice del contorno: `[lat, lng]`. */
export type Vertice = [number, number];

/**
 * El contorno de partida, siguiendo el que dibujó el dueño sobre el mapa del Valle: oeste en
 * Sullivan City, norte por encima de Edinburg y bajando hacia Combes/Rio Hondo, este por la costa
 * dejando DENTRO South Padre y Port Isabel y FUERA Raymondville y Port Mansfield, y el sur
 * siguiendo el río de Boca Chica a Los Ébanos.
 *
 * **Vive en el código a propósito, y esto tiene una consecuencia que hay que decir: mover el
 * contorno exige un despliegue.** Se valoró una columna en `settings` y se descartó — mientras
 * nadie pueda dibujar el contorno desde la pantalla, esa columna nace vacía y sin quien la
 * escriba, o sea código muerto con una migración incluida. El día que el dueño quiera moverlo
 * desde Ajustes, la columna y el editor entran en el mismo encargo. Los vértices van comentados
 * uno a uno para que se puedan mover a mano sin adivinar cuál es cuál.
 *
 * **El tramo del río se corrigió dos veces, y las dos por medición.**
 *
 * 1. El boceto de partida llevaba el borde sur por (25.84, −97.38) → (25.88, −97.55), y con ese
 *    trazado **Matamoros (25.880, −97.504) caía DENTRO**: justo lo que el dueño pidió que no
 *    pasara. Ahí el río separa dos ciudades pegadas —Brownsville a 25.902, unos 2,4 km— y un
 *    borde de dos vértices no puede pasar entre ellas.
 * 2. Con el arreglo, el cotejo contra los 112 pedidos reales (lo corrió el orquestador) encontró
 *    **dos entregas de Brownsville al norte del río que quedaban fuera**: (25.8804, −97.4112) y
 *    (25.8801, −97.4321). El motivo es que el cauce **baja hacia el este** y yo lo había trazado
 *    casi recto. Ahora el tramo tiene seis vértices y toca su punto más al sur (~25.852) frente a
 *    esas direcciones.
 *
 * Las dos restricciones se cumplen a la vez, que era lo difícil: en lng −97.50 el borde va por
 * ~25.89 (Matamoros fuera, Brownsville dentro) y en lng −97.41/−97.43 por ~25.855 (esas dos
 * entregas dentro). El margen es de ~1 km, que es lo que da el terreno.
 */
export const LOCAL_ZONE_DEFAULT: Vertice[] = [
  // Norte y oeste: Sullivan City, por encima de Edinburg, bajando a Combes / Rio Hondo.
  [26.32, -98.58],
  [26.45, -98.55],
  [26.45, -97.95],
  [26.38, -97.70],
  [26.30, -97.45],
  [26.30, -97.30],
  // Costa: South Padre y Port Isabel dentro; Port Mansfield queda al norte, fuera.
  [26.16, -97.12],
  [25.96, -97.13],
  // El RÍO, de la desembocadura (Boca Chica) hacia el oeste. Es el tramo que más se ajustó, y
  // dos veces: ver la nota de abajo. El cauce BAJA hacia el este —hasta ~25.85 frente a
  // Brownsville— y vuelve a subir; por eso hacen falta seis vértices y no dos.
  [25.955, -97.145],
  [25.905, -97.28],
  [25.868, -97.35],
  [25.852, -97.41],  // el punto más al sur: aquí hay entregas reales a 25.880
  [25.862, -97.46],
  [25.892, -97.50],  // entre Brownsville (25.902) y Matamoros (25.880)
  [25.93, -97.57],
  [26.02, -97.75],   // Los Indios
  [26.06, -97.95],   // Progreso
  [26.10, -98.26],   // Hidalgo
  [26.12, -98.35],   // Mission
  [26.24, -98.56],   // Los Ébanos
];

/** Los vértices en la forma que quieren el mapa y `pointInPolygon`. */
export function comoLatLng(zona: Vertice[]): LatLng[] {
  return zona.map(([lat, lng]) => ({ lat, lng }));
}

/**
 * ¿Está el punto dentro de la zona local?
 *
 * `null` cuando no se puede decidir: sin coordenadas, con un polígono de menos de tres vértices
 * (que no es un área), o con el pin en **0,0**. Devolver `null` y no `false` es deliberado: quien
 * llama tiene que poder distinguir «está fuera» de «no lo sé», porque lo segundo se resuelve
 * cayendo al método viejo y lo primero no.
 *
 * **Lo de 0,0 no es puntillismo.** Es lo que escribe un geocodificador cuando falla, y cae en el
 * golfo de Guinea, que no es una dirección de reparto. Sin esta línea, un pin corrupto no sería
 * «no lo sé» sino «está fuera»: el pedido se saltaría el respaldo por ciudad y saldría NO LOCAL,
 * con 500 + millas y aprobación del gerente, en silencio y aunque la dirección dijera McAllen. Es
 * el mismo tipo de camino que arregla esta decisión —un dato malo decidiendo una tarifa— y hoy no
 * hay ninguna fila así (rango real medido: lat 25,88 → 32,53), o sea que se cierra antes de que
 * exista, no después.
 */
export function puntoEnZonaLocal(
  lat: number | null | undefined,
  lng: number | null | undefined,
  zona: Vertice[] = LOCAL_ZONE_DEFAULT,
): boolean | null {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  if (zona.length < 3) return null;
  return pointInPolygon(lat, lng, comoLatLng(zona));
}

/** El contorno listo para pintarlo: lo usan el mapa de la ficha y el de Ajustes. */
export const LOCAL_ZONE_LATLNG: LatLng[] = comoLatLng(LOCAL_ZONE_DEFAULT);

/**
 * El verde de la zona, y por qué no es `var(--green)` a secas.
 *
 * Ni Leaflet ni Google Maps aceptan una variable CSS en sus opciones: quieren un color literal.
 * Así que se lee la variable del tema en tiempo de ejecución y solo se cae al literal si no hay
 * DOM o la variable no está definida. El literal **no es un verde inventado**: es exactamente el
 * `--green` de `globals.css:12`, y si alguien cambia el tema, el `getComputedStyle` gana.
 */
export const VERDE_ZONA_FALLBACK = "#1f9d61"; // = --green (globals.css:12)

export function colorZona(): string {
  if (typeof document === "undefined") return VERDE_ZONA_FALLBACK;
  const v = getComputedStyle(document.documentElement).getPropertyValue("--green").trim();
  return v || VERDE_ZONA_FALLBACK;
}

/** El mismo trazo en los dos mapas: relleno tenue para no tapar calles, borde visible. */
export const ESTILO_ZONA = { fillOpacity: 0.12, strokeOpacity: 0.9, strokeWeight: 2 } as const;
