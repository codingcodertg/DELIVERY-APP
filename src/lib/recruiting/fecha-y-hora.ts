/* ---- El selector de fecha y hora amable (D-NEXT, 2026-10-20) ----
 * El dueño: «esa forma de meter el calendario para entrevista presencial … no me gusta, se mira medio feo y voy bien poco
 * … quiero que me mejores ese tipo de calendario, que sea más user friendly». Hasta aquí era un `<input type="datetime-local">`
 * pelado (el del navegador). Ahora: fichas de DÍA (Hoy, Mañana y los cinco siguientes con su nombre, más «Otro día» con
 * el calendario del navegador) y fichas de HORA (de 8:00 a 6:00 p.m. cada media hora, más «Otra hora»). El valor sigue
 * siendo el mismo texto `YYYY-MM-DDTHH:mm` (hora local) que ya guardaban los diálogos: nada cambia detrás. */

export interface FichaDeDia { fecha: string; etiqueta: string; sub: string }
export interface FichaDeHora { hora: string; etiqueta: string }

const dosDigitos = (n: number) => String(n).padStart(2, "0");
export const fechaLocal = (d: Date): string => `${d.getFullYear()}-${dosDigitos(d.getMonth() + 1)}-${dosDigitos(d.getDate())}`;

/** Hoy, mañana y los cinco días siguientes: «Hoy · mar 20», «Mañana · mié 21», «jue · 22 oct»… en el idioma de quien mira. */
export function fichasDeDia(lang: "en" | "es", hoy: Date = new Date(), cuantos = 7): FichaDeDia[] {
  const locale = lang === "es" ? "es-MX" : "en-US";
  const out: FichaDeDia[] = [];
  for (let i = 0; i < cuantos; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + i);
    const dia = d.toLocaleDateString(locale, { weekday: "short" }).replace(".", "");
    const num = d.toLocaleDateString(locale, { day: "numeric", month: "short" }).replace(".", "");
    const etiqueta = i === 0 ? (lang === "es" ? "Hoy" : "Today") : i === 1 ? (lang === "es" ? "Mañana" : "Tomorrow") : dia;
    out.push({ fecha: fechaLocal(d), etiqueta, sub: i < 2 ? `${dia} ${num}` : num });
  }
  return out;
}

/** De las 8:00 a las 6:00 p.m., cada media hora. */
export function fichasDeHora(lang: "en" | "es", desde = 8, hasta = 18, pasoMin = 30): FichaDeHora[] {
  const out: FichaDeHora[] = [];
  for (let m = desde * 60; m <= hasta * 60; m += pasoMin) {
    const h = Math.floor(m / 60), mm = m % 60;
    const hora = `${dosDigitos(h)}:${dosDigitos(mm)}`;
    const etiqueta = lang === "es"
      ? `${h % 12 === 0 ? 12 : h % 12}:${dosDigitos(mm)} ${h < 12 ? "a.m." : "p.m."}`
      : `${h % 12 === 0 ? 12 : h % 12}:${dosDigitos(mm)} ${h < 12 ? "AM" : "PM"}`;
    out.push({ hora, etiqueta });
  }
  return out;
}

/** Parte un `YYYY-MM-DDTHH:mm` en fecha y hora (vacío si no viene o no tiene esa forma). */
export function parteDeFechaYHora(valor: string | null | undefined): { fecha: string; hora: string } {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(valor ?? "");
  return m ? { fecha: m[1], hora: m[2] } : { fecha: "", hora: "" };
}

/** Junta fecha y hora en el valor de siempre; sin una de las dos, vacío (el diálogo sigue pidiendo las dos). */
export function juntaFechaYHora(fecha: string, hora: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(fecha) && /^\d{2}:\d{2}$/.test(hora) ? `${fecha}T${hora}` : "";
}

/** ¿La hora está entre las fichas? Si no (p. ej. 7:45), el selector enseña «Otra hora» con ese valor. */
export const horaEntreLasFichas = (hora: string, fichas: readonly FichaDeHora[]): boolean => fichas.some((f) => f.hora === hora);
export const diaEntreLasFichas = (fecha: string, fichas: readonly FichaDeDia[]): boolean => fichas.some((f) => f.fecha === fecha);
