/**
 * Marca de agua de las apps sensibles: el nombre de quien mira y la hora, en diagonal y casi invisible.
 *
 * Está para desanimar las capturas de pantalla. Quien tome una foto de una cotización o de un expediente
 * queda identificado en la foto. No impide nada: solo deja rastro.
 */

/**
 * Las apps que llevan la marca. Para añadir una, se pone aquí y se monta `<MarcaDeAgua />` en su layout.
 * La ventana de escritorio (`desktop/protegidas.js`) tiene su propia lista de rutas para la protección
 * contra capturas; `desktop-protegidas.test.ts` obliga a que coincidan.
 */
export const RUTAS_CON_MARCA: readonly string[] = [
  "/estimator",
  "/recruiting",
  "/erp",
  "/customers",
];

/** La fecha como en el ejemplo del encargo: `11/14/2026 2:05 PM` (mes/día/año, 12 horas). Hora local. */
export function fechaDeMarca(ahora: Date): string {
  const horas = ahora.getHours();
  const hora12 = horas % 12 === 0 ? 12 : horas % 12;
  const minutos = String(ahora.getMinutes()).padStart(2, "0");
  const periodo = horas < 12 ? "AM" : "PM";
  return `${ahora.getMonth() + 1}/${ahora.getDate()}/${ahora.getFullYear()} ${hora12}:${minutos} ${periodo}`;
}

/** El texto de una celda de la marca: `Nombre Apellido · 11/14/2026 2:05 PM`. Sin nombre, solo la fecha. */
export function textoDeMarca(nombre: string, ahora: Date): string {
  const quien = nombre.trim();
  const fecha = fechaDeMarca(ahora);
  return quien ? `${quien} · ${fecha}` : fecha;
}
