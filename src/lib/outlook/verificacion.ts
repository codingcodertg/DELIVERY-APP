/**
 * ¿El correo viene de verdad de Indeed? El campo From se puede falsificar; lo que el servidor de correo de destino
 * anota en `Authentication-Results` no. PURO: recibe las cabeceras, no toca red.
 *
 * Se acepta si: `dmarc=pass`, o `dkim=pass` con el dominio de firma (`header.d=` o `d=`) igual a un dominio de Indeed
 * o subdominio suyo. Cualquier otra cosa (spf solo, fail, none, sin cabecera, dominio parecido) se rechaza.
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

export function verificadoComoIndeed(cabeceras: readonly CabeceraDeCorreo[] | null | undefined): { ok: boolean; motivo: string } {
  const resultados = (cabeceras ?? []).filter((c) => c.name.toLowerCase() === "authentication-results");
  if (resultados.length === 0) return { ok: false, motivo: "sin Authentication-Results" };
  for (const h of resultados) {
    for (const parte of (h.value ?? "").slice(0, TOPE_CABECERA).split(";")) {
      const t = parte.trim().toLowerCase();
      if (/^dmarc=pass(\s|$|\()/.test(t)) return { ok: true, motivo: "dmarc=pass" };
      if (/^dkim=pass(\s|$|\()/.test(t)) {
        const d = /\bheader\.d=([a-z0-9.-]+)/.exec(t)?.[1] ?? /(?:^|\s)d=([a-z0-9.-]+)/.exec(t)?.[1];
        if (d && dominioDeIndeed(d)) return { ok: true, motivo: `dkim=pass d=${d}` };
      }
    }
  }
  return { ok: false, motivo: "no verificado: ni dmarc=pass ni dkim=pass de Indeed" };
}
