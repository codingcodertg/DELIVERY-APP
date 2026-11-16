/**
 * Un QR por tienda (D-724). El dueño, 2026-10-28: «for the survey can it be a QR for each store?».
 *
 * El sitio público (D-449) es uno solo; lo que cambia por tienda es el enlace: `?tienda=<nombre>`, con el nombre de
 * la tienda tal cual está en Ajustes. El sitio lo lee, lo enseña en la cabecera y lo manda como `store`; la base lo
 * guarda (209). El QR se dibuja aquí, en el navegador, del enlace: no hay un PNG por tienda que mantener.
 */

/**
 * El enlace público de la encuesta (D-449: sitio aparte, `rtg-encuesta` en Vercel). D-777: con dominio propio,
 * `survey.rdztilegroup.com` (CNAME a Vercel, dado de alta el 2026-10-30; el dueño: «que no diga vercel en el url»).
 * La dirección vieja `rtg-encuesta.vercel.app` sigue viva: el QR general ya impreso (D-496) no cambia.
 */
export const ENLACE_DE_LA_ENCUESTA = "https://survey.rdztilegroup.com";
export const ENLACE_VIEJO_DE_LA_ENCUESTA = "https://rtg-encuesta.vercel.app";

/** El enlace de una tienda; sin tienda, el general. El nombre va codificado (espacios, acentos). */
export function enlaceDeTienda(tienda: string | null): string {
  const t = tienda?.trim();
  return t ? `${ENLACE_DE_LA_ENCUESTA}/?tienda=${encodeURIComponent(t)}` : ENLACE_DE_LA_ENCUESTA;
}

/** El nombre del PNG que se descarga: sin tienda, el de siempre; con ella, su nombre sin caracteres raros. */
export function archivoDelQr(tienda: string | null): string {
  const t = tienda?.trim();
  if (!t) return "RTG-encuesta-QR.png";
  const limpio = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `RTG-encuesta-QR-${limpio || "tienda"}.png`;
}

/** Los nombres de las tiendas de Ajustes, recortados, sin vacíos ni repetidos, en su orden. Una bodega (D-787) no es
 * una tienda: no lleva QR propio. */
export function nombresDeTiendas(tiendas: readonly { name?: string | null; bodega?: boolean }[] | null | undefined): string[] {
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const t of tiendas ?? []) {
    const n = (t?.name ?? "").trim();
    if (!n || vistos.has(n) || t?.bodega) continue;
    vistos.add(n);
    salida.push(n);
  }
  return salida;
}
