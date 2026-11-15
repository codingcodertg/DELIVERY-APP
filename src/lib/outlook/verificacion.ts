/**
 * ¿El correo viene de verdad de Indeed? El campo From se puede falsificar, y también se pueden mandar cabeceras
 * `Authentication-Results` de mentira desde fuera. PURO: recibe las cabeceras y la dirección From real, no toca red.
 *
 * Reglas (revisión de seguridad de D-1050):
 *   - Solo cuenta la cabecera `Authentication-Results` de ARRIBA: es la que estampa el servidor de Microsoft al recibir
 *     el correo. Las de más abajo pudo traerlas el remitente y se ignoran.
 *   - La dirección From (la de Graph, `from.emailAddress.address`, no el texto con el nombre) tiene que ser de Indeed.
 *   - Se acepta si en esa cabecera hay `dmarc=pass` con `header.from=` igual al dominio del From, o `dkim=pass` con el
 *     dominio de firma (`header.d=` o `d=`) de Indeed y el From de Indeed. Cualquier otra cosa se rechaza.
 */
import { DOMINIOS_INDEED } from "./config";

export interface CabeceraDeCorreo {
  name: string;
  value: string;
}

const TOPE_CABECERA = 4000;

function dominioDeIndeed(d: string): boolean {
  return (DOMINIOS_INDEED as readonly string[]).some((x) => d === x || d.endsWith(`.${x}`));
}

/** Dominio de una dirección, sin el nombre: «noreply@indeed.com» → «indeed.com». */
function dominioDe(direccion: string | null | undefined): string {
  const a = (direccion ?? "").trim().toLowerCase();
  const i = a.lastIndexOf("@");
  return i >= 0 ? a.slice(i + 1).replace(/[>\s]+$/, "") : "";
}

export function verificadoComoIndeed(
  cabeceras: readonly CabeceraDeCorreo[] | null | undefined,
  direccionFrom: string | null | undefined,
): { ok: boolean; motivo: string } {
  const domFrom = dominioDe(direccionFrom);
  if (!domFrom || !dominioDeIndeed(domFrom)) return { ok: false, motivo: "el From no es de Indeed" };
  const arriba = (cabeceras ?? []).find((c) => c.name.toLowerCase() === "authentication-results");
  if (!arriba) return { ok: false, motivo: "sin Authentication-Results" };
  for (const parte of (arriba.value ?? "").slice(0, TOPE_CABECERA).split(";")) {
    const t = parte.trim().toLowerCase();
    if (/^dmarc=pass(\s|$|\()/.test(t)) {
      const hf = /\bheader\.from=([a-z0-9.-]+)/.exec(t)?.[1];
      if (hf && hf === domFrom) return { ok: true, motivo: `dmarc=pass header.from=${hf}` };
    }
    if (/^dkim=pass(\s|$|\()/.test(t)) {
      const d = /\bheader\.d=([a-z0-9.-]+)/.exec(t)?.[1] ?? /(?:^|\s)d=([a-z0-9.-]+)/.exec(t)?.[1];
      if (d && dominioDeIndeed(d)) return { ok: true, motivo: `dkim=pass d=${d}` };
    }
  }
  return { ok: false, motivo: "no verificado: ni dmarc=pass del From ni dkim=pass de Indeed en la cabecera de Microsoft" };
}
