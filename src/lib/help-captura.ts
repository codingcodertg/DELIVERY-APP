import { LIMITES_DE_ADJUNTOS, type FalloDeAdjunto, type FicheroElegido } from "@/lib/help-attachments";

/**
 * Capturar la pantalla desde Ayuda, y señalar dónde está el problema (D-NEXT).
 *
 * El dueño: «una opción de help que sea como un snipping tool para poder agregar screenshots directo de
 * la app, que aprieten eso y automáticamente, sin que la parte de help aparezca, le tomen foto y enfoquen
 * dónde está el problema, y se suba al help request».
 *
 * Aquí vive lo que se puede medir sin navegador: el rectángulo (normalizarlo, acotarlo, llevarlo al
 * fotograma y de ahí a porcentajes de CSS), el escalado del fotograma, el nombre del fichero, qué se
 * acepta, y **el orden en que se esconde Ayuda**. Lo que toca el navegador —`getDisplayMedia`, el
 * `<video>`, el lienzo y el blob— está en `src/components/CapturaDeAyuda.tsx`, porque no se puede medir
 * en vitest y no se finge con pruebas que no puedan fallar.
 *
 * **Se captura la pantalla de verdad, no el DOM.** Dibujar el DOM en un lienzo no pinta el mapa (Google
 * Maps y Leaflet pintan en su propio contexto), y el mapa es justo donde están la mitad de los problemas
 * de este app. El precio es que el navegador **exige un gesto de la persona y enseña su propio diálogo**
 * con la lista de pantallas y pestañas: eso no se puede rodear ni se intenta.
 */

export type Punto = { x: number; y: number };
/** Un rectángulo con ancho y alto **positivos**. Lo que llega del arrastre no lo es. */
export type Rect = { x: number; y: number; w: number; h: number };
export type Tamano = { ancho: number; alto: number };

/** El fotograma se encoge a 1920 por el lado largo. Una pantalla 4K en PNG se acerca a los 10 MB que
 *  acepta el cubo, y a 1920 el texto de la app sigue leyéndose, que es para lo que sirve la foto. */
export const MAX_LADO_DE_CAPTURA = 1920;

/** Un arrastre más corto que esto es un clic, no un recuadro: pulsar sin querer no deja una marca. */
export const LADO_MINIMO_DEL_RECUADRO = 8;

/** Lo que se sube es PNG. JPEG se acepta porque el cubo lo acepta y porque una captura reenviada por
 *  otra vía puede llegar así; la lista corta es la de imágenes de la 119. */
export const TIPO_DE_CAPTURA = "image/png";
export const TIPOS_DE_CAPTURA: readonly string[] = [TIPO_DE_CAPTURA, "image/jpeg"];

/** ¿Este navegador sabe capturar la pantalla? Un móvil o un navegador viejo no: entonces no se ofrece y
 *  queda el camino de siempre, adjuntar una imagen a mano. */
export function soportaCaptura(nav: { mediaDevices?: { getDisplayMedia?: unknown } } | undefined | null): boolean {
  return typeof nav?.mediaDevices?.getDisplayMedia === "function";
}

/** Qué falló. `cancelada` no es un error: es la persona cerrando el diálogo del navegador. */
export type FalloDeCaptura = "no-soportado" | "cancelada" | "sin-fotograma";

/** Cerrar el diálogo del navegador llega como `NotAllowedError`; `AbortError` cuando lo corta el sistema.
 *  Ninguno de los dos se cuenta como avería. */
export function esCancelacionDeCaptura(e: unknown): boolean {
  const nombre = (e as { name?: unknown } | null | undefined)?.name;
  return nombre === "NotAllowedError" || nombre === "AbortError";
}

/** De lo que se haya lanzado, qué decirle a la persona. Una cancelación se reconoce **primero**: lo que
 *  tira el navegador al cerrar su diálogo no es un `ErrorDeCaptura` nuestro, y contarla como avería
 *  mandaría a alguien a reportar un fallo que no existe. Lo que no se reconoce es «salió vacía». */
export function falloDeCaptura(e: unknown): FalloDeCaptura {
  if (esCancelacionDeCaptura(e)) return "cancelada";
  const fallo = (e as { fallo?: unknown } | null | undefined)?.fallo;
  if (fallo === "no-soportado" || fallo === "cancelada" || fallo === "sin-fotograma") return fallo;
  return "sin-fotograma";
}

/** El aviso. Los tres dicen lo mismo al final: la solicitud se puede mandar igual con una foto a mano. */
export function mensajeDeFalloDeCaptura(fallo: FalloDeCaptura, t: (en: string, es: string) => string): string {
  if (fallo === "no-soportado") {
    return t(
      "This browser can't capture the screen. Attach a photo instead.",
      "Este navegador no puede capturar la pantalla. Adjunte una foto en su lugar.",
    );
  }
  if (fallo === "cancelada") {
    return t(
      "Screenshot cancelled — nothing was captured.",
      "Captura cancelada — no se tomó ninguna foto.",
    );
  }
  return t(
    "The screenshot came back empty. Try again, or attach a photo instead.",
    "La captura salió vacía. Intente de nuevo, o adjunte una foto en su lugar.",
  );
}

/** El arrastre, normalizado: ancho y alto positivos **aunque se arrastre hacia arriba o a la izquierda**.
 *  Sin esto, arrastrar de abajo a la derecha hacia arriba a la izquierda da un rect de medidas negativas,
 *  que en CSS no se pinta y en el lienzo se pinta al revés. */
export function rectDeArrastre(a: Punto, b: Punto): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

/** Acotado a la imagen: un arrastre que se sale por un borde se recorta ahí, no pinta fuera. */
export function acotaRect(r: Rect, limites: Tamano): Rect {
  const pega = (v: number, max: number) => Math.min(Math.max(v, 0), Math.max(max, 0));
  const x = pega(r.x, limites.ancho);
  const y = pega(r.y, limites.alto);
  const x2 = pega(r.x + r.w, limites.ancho);
  const y2 = pega(r.y + r.h, limites.alto);
  return { x, y, w: x2 - x, h: y2 - y };
}

/** El recuadro que deja un arrastre, o `null` si no llega al mínimo: un clic suelto no deja marca. */
export function recuadroDelArrastre(a: Punto, b: Punto, limites: Tamano): Rect | null {
  const r = acotaRect(rectDeArrastre(a, b), limites);
  if (r.w < LADO_MINIMO_DEL_RECUADRO || r.h < LADO_MINIMO_DEL_RECUADRO) return null;
  return r;
}

/** De las coordenadas en que se dibujó —la imagen como se ve, que el modal encoge— a los píxeles del
 *  fotograma, que es donde se pinta de verdad. Sin medidas de vista no hay nada que escalar. */
export function alFotograma(r: Rect, vista: Tamano, fotograma: Tamano): Rect {
  if (vista.ancho <= 0 || vista.alto <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  const ex = fotograma.ancho / vista.ancho;
  const ey = fotograma.alto / vista.alto;
  return {
    x: Math.round(r.x * ex),
    y: Math.round(r.y * ey),
    w: Math.round(r.w * ex),
    h: Math.round(r.h * ey),
  };
}

/** Lo que va a medir el fotograma guardado. **Nunca agranda**: una ventana pequeña se queda como está. */
export function tamanoDeCaptura(fotograma: Tamano, maxLado = MAX_LADO_DE_CAPTURA): Tamano {
  const lado = Math.max(fotograma.ancho, fotograma.alto);
  if (!(lado > 0) || !(fotograma.ancho > 0) || !(fotograma.alto > 0)) return { ancho: 0, alto: 0 };
  const escala = Math.min(1, maxLado / lado);
  return {
    ancho: Math.max(1, Math.round(fotograma.ancho * escala)),
    alto: Math.max(1, Math.round(fotograma.alto * escala)),
  };
}

/** El recuadro en porcentajes del fotograma, que es como se coloca el div encima de la imagen. En
 *  porcentaje y no en píxeles **a propósito**: la imagen se reescala con la ventana y el modal, y un
 *  recuadro en píxeles de vista se iría de sitio al girar el teléfono. */
export function porcentajesDelRecuadro(r: Rect, fotograma: Tamano): { left: string; top: string; width: string; height: string } {
  const pc = (v: number, total: number) => `${total > 0 ? (v / total) * 100 : 0}%`;
  return {
    left: pc(r.x, fotograma.ancho),
    top: pc(r.y, fotograma.alto),
    width: pc(r.w, fotograma.ancho),
    height: pc(r.h, fotograma.alto),
  };
}

/** Lo gordo que se pinta el borde, en píxeles del fotograma: 2 px sobre una captura de 1920 no se ven. */
export function grosorDelRecuadro(fotograma: Tamano): number {
  return Math.max(2, Math.round(Math.max(fotograma.ancho, fotograma.alto) / 400));
}

/** El nombre con el que se sube. Lleva la hora porque en una solicitud caben varias capturas, y pasa
 *  intacto por `nombreSaneado`: lo que se ve en el correo es lo que se eligió aquí. */
export function nombreDeCaptura(cuando: Date): string {
  return `captura-${cuando.toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`;
}

/** Lo mismo que `validaAdjuntos` hace con lo elegido a mano, para lo que sale del lienzo: el cubo de la
 *  119 acepta 10 MB y, de imágenes, PNG y JPEG. Una captura que no pase por aquí la rechazaría el cubo
 *  después de subirla, con el mensaje de Storage en vez del nuestro. */
export function validaCaptura(fichero: FicheroElegido): FalloDeAdjunto | null {
  if (fichero.size > LIMITES_DE_ADJUNTOS.maxBytes) return { motivo: "tamano", fichero: fichero.name };
  if (!TIPOS_DE_CAPTURA.includes(fichero.type)) return { motivo: "tipo", fichero: fichero.name };
  return null;
}

/**
 * **Ayuda fuera de la foto.** Es la garantía que pidió el dueño, y es un orden, no un estilo: se esconde
 * Ayuda, se espera a que el navegador haya repintado sin ella, y solo entonces se captura. Volver a
 * enseñarla va en `finally`: si el diálogo se cancela o la captura revienta, Ayuda **vuelve igual**, o la
 * persona se queda sin el panel y con su mensaje a medio escribir dentro.
 */
export async function conAyudaOculta<T>(pasos: {
  esconde: () => void;
  esperaUnRepintado: () => Promise<void>;
  captura: () => Promise<T>;
  devuelve: () => void;
}): Promise<T> {
  pasos.esconde();
  await pasos.esperaUnRepintado();
  try {
    return await pasos.captura();
  } finally {
    pasos.devuelve();
  }
}
