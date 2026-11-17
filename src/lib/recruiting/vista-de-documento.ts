/**
 * La vista del documento de ingreso para revisar: el HTML que sale de `mammoth` con sus campos convertidos en chips.
 *
 * Cómo llegan los campos al HTML: `mammoth` tira el resaltado amarillo, así que el campo no se puede reconocer después
 * de convertir. Por eso, ANTES de convertir, cada campo amarillo del .docx se cambia por un marcador ⟦Fn⟧ (ver
 * `marcaCamposDocx`). Aquí, ya con el HTML, cada marcador se cambia por su chip. El marcador va en un solo run, así que
 * siempre llega entero al HTML; y el número `n` dice de qué campo es (el mismo orden que `camposDeXml`).
 *
 * Todo puro: lo que se prueba está aquí, el DOM y `mammoth` van en `imprimir-documento.ts`.
 */

import { claveDeEntrada, etiquetasDeCampos, type CampoDetectado } from "./campos-de-documento";

/** Escapa texto para ponerlo dentro de HTML (valores que escribe RR. HH.). */
export function escapaHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const RE_MARCADOR = /⟦F(\d+)⟧/g;

/**
 * Cambia cada marcador ⟦Fn⟧ del HTML por su chip:
 *   · con valor → `<span class="docs-campo">valor</span>`, el valor que el formulario tiene para esa clave;
 *   · sin valor → un hueco punteado con la etiqueta del campo (`docs-campo-vacio`); en la impresión no se ve.
 * `data-entrada` lleva la clave de entrada, para que un clic en el chip enfoque su casilla del formulario.
 * Un marcador sin campo (no debería haber) se quita, para no dejar basura en el documento.
 */
export function sustituyeMarcadores(html: string, campos: readonly CampoDetectado[], valores: Record<string, string>): string {
  // Las etiquetas por clave: un campo compartido («Applies to» y «Position») muestra las dos, separadas por «/».
  const etiquetaDeEntrada = new Map<string, string>();
  for (const c of campos) {
    const k = claveDeEntrada(c);
    if (!etiquetaDeEntrada.has(k)) etiquetaDeEntrada.set(k, etiquetasDeCampos(campos.filter((x) => claveDeEntrada(x) === k)).join(" / "));
  }
  return html.replace(RE_MARCADOR, (_m, num: string) => {
    const campo = campos[Number(num) - 1];
    if (!campo) return "";
    const entrada = claveDeEntrada(campo);
    const valor = (valores[entrada] ?? "").trim();
    if (valor) {
      return `<span class="docs-campo" data-entrada="${escapaHtml(entrada)}" title="${escapaHtml(etiquetaDeEntrada.get(entrada) ?? "")}">${escapaHtml(valor)}</span>`;
    }
    return `<span class="docs-campo docs-campo-vacio" data-entrada="${escapaHtml(entrada)}"><span class="docs-campo-rotulo">${escapaHtml(etiquetaDeEntrada.get(entrada) ?? "")}</span></span>`;
  });
}

/** Los marcadores que el HTML trae, en orden (solo para pruebas y diagnóstico). */
export function numerosDeMarcadores(html: string): number[] {
  return [...html.matchAll(RE_MARCADOR)].map((m) => Number(m[1]));
}

/** Fecha «MM/DD/YYYY» (como se guarda en el valor) → «YYYY-MM-DD» (lo que pide `<input type="date">»). Vacío si no encaja. */
export function isoDeMDY(mdy: string): string {
  const m = (mdy ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : "";
}

/** Lo contrario: «YYYY-MM-DD» del calendario → «MM/DD/YYYY» que va al documento. Vacío si no hay fecha. */
export function mdyDeIso(iso: string): string {
  const m = (iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "";
}

/** Pago que escribe RR. HH. («11») → el texto del documento («$11»). Vacío si no hay nada. */
export function pagoConSigno(entrada: string): string {
  const limpio = (entrada ?? "").trim().replace(/^\$\s*/, "");
  return limpio ? `$${limpio}` : "";
}

/** El pago guardado («$11») → lo que se ve en la casilla, sin el signo (el «$» va como adorno). */
export function pagoSinSigno(valor: string): string {
  return (valor ?? "").trim().replace(/^\$\s*/, "");
}

/** Lo que se pide en la casilla de cada clave: la pista corta que va debajo del campo. */
export function ayudaDeCampo(clave: CampoDetectado["clave"], t: (en: string, es: string) => string): string {
  switch (clave) {
    case "start_date": return t("Shown as MM/DD/YYYY in the document.", "Se muestra como MM/DD/AAAA en el documento.");
    case "position": return t("Use the exact position name.", "Use el nombre exacto del puesto.");
    case "weekly_hours": return t("Hours per week. Typed by hand each time; not taken from the file.", "Horas por semana. Se escriben a mano cada vez; no vienen del expediente.");
    case "pay_rate": return t("Hourly pay. Typed by hand each time; not taken from the file.", "Pago por hora. Se escribe a mano cada vez; no viene del expediente.");
    case "employee_name": return t("Taken from the employee file. Change it if needed.", "Viene del expediente del empleado. Cámbielo si hace falta.");
    case "store": return t("Taken from the employee file. Change it if needed.", "Viene del expediente del empleado. Cámbielo si hace falta.");
    default: return t("Shown exactly as typed.", "Se muestra tal cual se escribe.");
  }
}

/** Para la barra de progreso: cuántas claves de entrada ya tienen valor, de cuántas. */
export function progresoDeCampos(entradas: readonly string[], valores: Record<string, string>): { hechos: number; total: number } {
  const hechos = entradas.filter((k) => (valores[k] ?? "").trim() !== "").length;
  return { hechos, total: entradas.length };
}
