/**
 * Marcas que caen en el MISMO punto: se abren en abanico alrededor de él (D-NEXT).
 *
 * El problema, medido en el navegador el 2026-09-23 sobre el Gestor: con todas las rutas a la vez, 18 pares de marcas se
 * solapaban sobre 8, y 6 seguían solapadas eligiendo un solo chofer. Dos entregas en la misma dirección, o una entrega y la
 * recogida de otra orden en la misma tienda, se tapan enteras: la de abajo no se ve y no se puede pulsar.
 *
 * **Por qué en abanico y no fundiéndolas en una:** el dueño usa el mapa para ver por dónde va cada ruta, así que lo que no se
 * puede perder es el COLOR (de qué chofer es) ni el CLIC (qué orden es). Una marca fundida tiene un solo color y un solo id.
 *
 * **Qué se paga, y hay que decirlo:** el pin deja de estar exactamente sobre su dirección. El desplazamiento es en PÍXELES, así
 * que se ve igual a cualquier zoom, pero en metros vale lo que valga el píxel: mucho al alejar, poco al acercar. Nadie navega
 * con este mapa —el chofer lleva su ruta por calles en «Mi ruta»—, pero es una mentira pequeña y consciente.
 *
 * **Solo se separa lo que está EXACTAMENTE en el mismo punto.** Dos marcas a un metro no se tocan: al acercar el mapa se
 * separan solas, y moverlas las dejaría mal colocadas justo cuando se ven bien. Lo que nunca se separa por sí solo, a ningún
 * zoom, es lo que comparte coordenada — y eso es lo que aquí se abre.
 *
 * Puro y sin React: decide POR ENCIMA de `MapView`, que es lo que hace que los dos motores no tengan que saber nada. Cada uno
 * solo suma el desplazamiento al ancla de su icono; un punto sin `offset` se pinta donde se pintaba.
 */

export interface Desplazamiento { x: number; y: number }

/** Lo que hace falta de una marca para repartirla. */
interface Marca { id: string; lat: number; lng: number }

/** Lo que mide un pin de lado. Lo que se quiere es que dos vecinas no compartan centro, no que no se rocen. */
export const LADO_DEL_PIN = 30;
/** Tope del radio: más lejos la mentira pesa más que el estorbo. A partir de ahí las vecinas vuelven a rozarse, a sabiendas. */
export const RADIO_MAXIMO = 40;

/**
 * El radio en píxeles para `n` marcas en el mismo punto. Lo que separa dos vecinas no es el arco sino la CUERDA,
 * `2r·sen(π/n)`, y se quiere que valga al menos un pin: `r ≥ (LADO/2) / sen(π/n)`. Con dos marcas da 15 —una a cada lado, 30
 * de centro a centro—; con ocho pediría 40. Por encima de `RADIO_MAXIMO` se deja de crecer.
 */
export function radioDelAbanico(n: number): number {
  if (n < 2) return 0;
  return Math.min(RADIO_MAXIMO, Math.ceil((LADO_DEL_PIN / 2) / Math.sin(Math.PI / n)));
}

/** La clave de agrupación: la coordenada con seis decimales, que es ~0,1 m — por debajo de cualquier diferencia real. */
const mismoPunto = (m: Marca) => `${m.lat.toFixed(6)},${m.lng.toFixed(6)}`;

/**
 * El desplazamiento de cada marca, por id. Las que están solas en su punto no salen en el mapa devuelto: no se mueven.
 *
 * El reparto es un círculo que empieza ARRIBA y gira en el sentido del reloj, en el orden en que llegan las marcas — así dos
 * pantallas con los mismos datos pintan lo mismo, y añadir una marca nueva no baraja las demás más de lo justo.
 */
export function abanicoDeMarcas(marcas: readonly Marca[]): Map<string, Desplazamiento> {
  const grupos = new Map<string, Marca[]>();
  for (const m of marcas) {
    if (!Number.isFinite(m.lat) || !Number.isFinite(m.lng)) continue;
    const k = mismoPunto(m);
    const g = grupos.get(k);
    if (g) g.push(m); else grupos.set(k, [m]);
  }
  const salida = new Map<string, Desplazamiento>();
  for (const g of grupos.values()) {
    if (g.length < 2) continue;
    const r = radioDelAbanico(g.length);
    g.forEach((m, i) => {
      const angulo = -Math.PI / 2 + (2 * Math.PI * i) / g.length;
      salida.set(m.id, { x: Math.round(r * Math.cos(angulo)), y: Math.round(r * Math.sin(angulo)) });
    });
  }
  return salida;
}

/** Los metros que mide un píxel en un mapa web a ese zoom y esa latitud. Para poder decir en metros lo que se desplaza. */
export function metrosPorPixel(latitud: number, zoom: number): number {
  return (156543.03392 * Math.cos((latitud * Math.PI) / 180)) / Math.pow(2, zoom);
}
