"use strict";

// ============================================================
// Qué pantallas de RTG Hub no se pueden capturar (1.5.0).
//
// Esta ventana muestra en negro en las capturas y grabaciones SOLO mientras está en una de estas
// rutas: las que tienen datos que no deben salir en una foto (cotizaciones, RR. HH., ERP, clientes).
// En el resto del hub no se protege, a propósito: el cliente de Time Tracker toma capturas para
// los registros de pago, y si todo el hub estuviera en negro, cronometrar aquí dejaría de servir.
//
// La misma lista está en la web, `src/lib/pantallas-protegidas.ts`. La prueba
// `src/lib/desktop-protegidas.test.ts` obliga a que coincidan: si se añade una app, hay que
// ponerla en las dos.
//
// No depende de Electron, así que se prueba sola.
// ============================================================

const RUTAS_PROTEGIDAS = Object.freeze(["/estimator", "/recruiting", "/erp", "/customers"]);

/** ¿Esta URL es una de las pantallas protegidas? Compara por segmentos: `/erp` sí, `/erpista` no. */
function estaProtegida(url) {
  let ruta;
  try {
    ruta = new URL(url).pathname;
  } catch {
    return false;
  }
  return RUTAS_PROTEGIDAS.some((r) => ruta === r || ruta.startsWith(r + "/"));
}

module.exports = { RUTAS_PROTEGIDAS, estaProtegida };
