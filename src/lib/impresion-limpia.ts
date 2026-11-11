/**
 * Impresión LIMPIA en toda la app (dueño, 10 nov: «todo lo printed nunca diga el url del app ni nada de información…
 * haz una auditoría»). El navegador pinta su cabecera y su pie (fecha, título, URL, «1/5») dentro del margen de la
 * página; con `@page { margin: 0 }` no le queda sitio y no los pinta. El margen lo pone el contenido (`padding`), y
 * `box-decoration-break: clone` lo repite en cada hoja cuando el documento ocupa varias.
 *
 * Mismo método que la cotización del Estimador (D-789). Va en `globals.css` (lo que se imprime dentro de la app) y en
 * cada documento que se abre en ventana aparte para imprimir (manifiesto, comprobantes, hojas de carga, talones,
 * exportaciones): esos no cargan `globals.css`, así que lo inyectan con esta constante.
 */
export const CSS_IMPRESION_LIMPIA =
  "@media print{@page{margin:0}html,body{margin:0}body{padding:12mm;-webkit-box-decoration-break:clone;box-decoration-break:clone}}";

/** La etiqueta `<style>` lista para ponerla antes de `</head>` en un documento de impresión. */
export const ESTILO_IMPRESION_LIMPIA = `<style>${CSS_IMPRESION_LIMPIA}</style>`;
