// Genera `src/app/erp/preflight-erp.css`: el preflight REAL de Tailwind, palabra por palabra, acotado a
// `[data-app="erp"]` (D-788, 2026-11-01).
//
//   node scripts/css/genera-preflight-erp.mjs          → escribe el fichero
//   (la prueba `src/lib/preflight-solo-erp.test.ts` comprueba que lo escrito es lo que sale de aquí)
//
// Por que existe: erp.css importaba `tailwindcss` entero, preflight incluido, con la premisa de que Next solo carga
// esa hoja en /erp y /customers. Es verdad al ABRIR la pagina, pero al navegar dentro de la app la hoja ya cargada
// se queda: tras pasar por Clientes, el `* { border: 0 }` del preflight (capa `base`, por encima de la capa `app`
// de globals.css) dejaba sin borde ni esquinas todos los campos de Entregas y del Quote Builder. Medido en el demo.
//
// Por que generado y no a mano: D-090 ya pago un preflight «aproximado» escrito a mano (le faltaba `padding: 0`
// y el ERP salio sin espacios). Aqui no se aproxima nada: se toma el fichero de node_modules y solo se anida bajo
// el ancla. Al subir Tailwind, volver a correr esto; la prueba avisa si el generado y el instalado discrepan.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ORIGEN = join(RAIZ, "node_modules", "tailwindcss", "preflight.css");
export const DESTINO = join(RAIZ, "src", "app", "erp", "preflight-erp.css");
export const ANCLA = '[data-app="erp"]';

/** El preflight anidado bajo el ancla. `html, :host` pasa a ser el propio ancla (`&`): lo que Tailwind pone en
 *  `html` —interlineado, tipografía— lo hereda el arbol del ERP desde su raiz, y nada fuera de ella. */
export function generaPreflightErp(preflight, version) {
  const lf = preflight.replace(/\r\n/g, "\n");
  const cabecera = `/* GENERADO por scripts/css/genera-preflight-erp.mjs desde node_modules/tailwindcss/preflight.css (${version}).
   NO EDITAR A MANO: es el preflight de Tailwind tal cual, anidado bajo ${ANCLA} para que solo vista al ERP y a
   Clientes aunque la hoja siga cargada al navegar a otra pantalla (D-788). */
@layer base {
  ${ANCLA} {
`;
  const sinHtml = lf.replace(/^html,\n:host \{/m, "&,\n:host {");
  if (sinHtml === lf) throw new Error("preflight.css: no encuentro la regla `html, :host`; revisar el generador");
  const cuerpo = sinHtml.split("\n").map((l) => (l.trim() === "" ? "" : "    " + l)).join("\n").replace(/\n+$/, "");
  return `${cabecera}${cuerpo}\n  }\n}\n`;
}

export function versionInstalada() {
  return JSON.parse(readFileSync(join(RAIZ, "node_modules", "tailwindcss", "package.json"), "utf8")).version;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const salida = generaPreflightErp(readFileSync(ORIGEN, "utf8"), versionInstalada());
  writeFileSync(DESTINO, salida);
  console.log(`ok ${DESTINO} (${salida.split("\n").length} lineas)`);
}
