import { grosorDelRecuadro, type Rect, type Tamano } from "@/lib/help-captura";

/**
 * Varios recuadros sobre la misma captura, cada uno con su número y su problema (D-NEXT).
 *
 * El dueño (2026-10-18): «help buttom make it possible that from the same screen being screenshot add
 * multiple request por ejemplo en una osla pagia hay 3 cosa que arreglar […] que el en el mismo
 * screenshot pueda hacer muktiple boxes showing an error y ahi el pueda por cada box describir un
 * problema».
 *
 * Hasta D-513 el editor admitía UN recuadro: arrastrar otra vez lo reemplazaba. Aquí vive lo que se
 * decide sin navegador: la lista (añadir, quitar, renumerar), el texto de cada punto, el mensaje
 * compuesto «1) … 2) …» que viaja en la solicitud, y dónde y de qué tamaño se pinta el número sobre
 * la imagen. El lienzo y los eventos del puntero siguen en `CapturaDeAyuda.tsx`.
 *
 * **Una solicitud, no N.** Los tres puntos son la misma pantalla y el mismo momento: van en una
 * solicitud con una captura anotada, y el admin los ve juntos en un solo hilo (D-311). Partirlos en
 * tres solicitudes repartiría una misma foto en tres hilos y tres correos.
 */

export type RecuadroNumerado = { n: number; rect: Rect; texto: string };

/** Más de esto no se lee en una captura: los números se tapan unos a otros y la lista deja de ser una
 *  lista. Nueve es lo que cabe en un dígito, que es lo que la etiqueta pinta cómoda. */
export const MAX_RECUADROS = 9;

/** Los números son 1..N en el orden de la lista, siempre: quitar el 2 convierte al 3 en 2. Un hueco en
 *  la numeración haría que la imagen dijera «3» y el texto no tuviera 3. */
export function renumera(lista: readonly RecuadroNumerado[]): RecuadroNumerado[] {
  return lista.map((r, i) => ({ ...r, n: i + 1 }));
}

/** Añade un recuadro al final, con el siguiente número y sin texto. Al llegar al tope la lista no cambia. */
export function agregaRecuadro(lista: readonly RecuadroNumerado[], rect: Rect): RecuadroNumerado[] {
  if (lista.length >= MAX_RECUADROS) return [...lista];
  return renumera([...lista, { n: 0, rect, texto: "" }]);
}

/** Quita el recuadro `n` y renumera los que quedan. */
export function quitaRecuadro(lista: readonly RecuadroNumerado[], n: number): RecuadroNumerado[] {
  return renumera(lista.filter((r) => r.n !== n));
}

/** El texto del punto `n`; los demás no se tocan. */
export function escribeProblema(lista: readonly RecuadroNumerado[], n: number, texto: string): RecuadroNumerado[] {
  return lista.map((r) => (r.n === n ? { ...r, texto } : r));
}

/** La lista «1) … 2) …», una línea por recuadro. Un punto sin texto se dice, no se omite: en la imagen
 *  está el número y el admin tiene que poder buscarlo en el texto. */
export function listaDeProblemas(lista: readonly RecuadroNumerado[], t: (en: string, es: string) => string): string {
  return lista
    .map((r) => `${r.n}) ${r.texto.trim() || t("(no description)", "(sin descripción)")}`)
    .join("\n");
}

/** El mensaje que se manda: lo que ya había escrito la persona y, debajo, la lista. Sin recuadros, el
 *  mensaje tal cual; sin mensaje, la lista sola (así «Enviar» se enciende con solo señalar). */
export function mensajeConProblemas(mensaje: string, lista: readonly RecuadroNumerado[], t: (en: string, es: string) => string): string {
  const puntos = listaDeProblemas(lista, t);
  const base = mensaje.trim();
  if (!puntos) return mensaje;
  if (!base) return puntos;
  return `${base}\n\n${puntos}`;
}

/** Dónde y de qué tamaño va la etiqueta con el número, en píxeles del fotograma: un cuadrado pegado a
 *  la esquina superior izquierda del recuadro, **por dentro**, que es donde siempre cabe (fuera se
 *  saldría de la imagen en un recuadro pegado al borde). El lado escala con el grosor del borde para que
 *  se lea igual en 800 que en 1920. */
export function etiquetaDelRecuadro(rect: Rect, fotograma: Tamano): { x: number; y: number; lado: number; fuente: number } {
  const lado = grosorDelRecuadro(fotograma) * 7;
  return { x: rect.x, y: rect.y, lado, fuente: Math.round(lado * 0.7) };
}

/** La misma etiqueta, en porcentajes, para el `<div>` encima de la imagen que se reescala con la ventana. */
export function porcentajesDeLaEtiqueta(rect: Rect, fotograma: Tamano): { left: string; top: string; width: string; height: string } {
  const e = etiquetaDelRecuadro(rect, fotograma);
  const pc = (v: number, total: number) => `${total > 0 ? (v / total) * 100 : 0}%`;
  return { left: pc(e.x, fotograma.ancho), top: pc(e.y, fotograma.alto), width: pc(e.lado, fotograma.ancho), height: pc(e.lado, fotograma.alto) };
}
