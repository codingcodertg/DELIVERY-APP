/**
 * La «Input Date» corta de la tabla de Órdenes (Roberto, 11 nov): «11/09/26 1:15pm» en vez de «Nov 09 2026».
 * `input_date` es YYYY-MM-DD y `input_time` es HHMM (p. ej. "1315"); sin hora sale solo la fecha.
 */
export function fmtCaptura(fecha: string | null | undefined, hora: string | null | undefined): string {
  if (!fecha || !/^\d{4}-\d{2}-\d{2}/.test(fecha)) return "—";
  const [a, m, d] = fecha.slice(0, 10).split("-");
  const dia = `${m}/${d}/${a.slice(2)}`;
  const h = (hora ?? "").replace(/\D/g, "");
  if (h.length < 3) return dia;
  const hh = Number(h.slice(0, h.length - 2));
  const mm = h.slice(-2);
  if (!Number.isFinite(hh) || hh > 23 || Number(mm) > 59) return dia;
  const sufijo = hh < 12 ? "am" : "pm";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${dia} ${h12}:${mm}${sufijo}`;
}
