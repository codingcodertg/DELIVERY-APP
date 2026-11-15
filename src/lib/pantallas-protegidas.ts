/**
 * Las pantallas de las apps sensibles: las que la ventana de escritorio protege contra capturas.
 *
 * La ventana de escritorio (`desktop/protegidas.js`) tiene su propia copia de esta lista, y
 * `desktop-protegidas.test.ts` obliga a que coincidan. Para añadir una app, cambia las dos.
 */
export const RUTAS_CON_MARCA: readonly string[] = [
  "/estimator",
  "/recruiting",
  "/erp",
  "/customers",
];
