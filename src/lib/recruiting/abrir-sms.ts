/* ---- Abrir un texto en RingCentral con el texto también en el portapapeles (D-604, 2026-10-19) ----
 * El dueño: «le doy enviar y se abre ring central pero no aparece nada». El enlace `rcapp://r/sms?…&text=…` lleva el texto
 * en la URL; el de «¿te puedo llamar?» (~250 letras) aparece y el de la cita (~330, y la plantilla del dueño es más larga
 * y con saltos de línea) llega en blanco. No se ha medido el límite exacto de la app, así que no se adivina: el texto va
 * en el enlace Y en el portapapeles, en el mismo clic (el navegador solo deja copiar dentro del gesto), y el aviso dice
 * «si RingCentral se abre vacío, pégalo». */

export type ResultadoDeAbrir = { copiado: boolean };

/** Copia `texto` al portapapeles (si el navegador deja) y abre `enlace`. Se llama DENTRO del clic, antes de cualquier `await`. */
export function abrirSmsEnRingCentral(enlace: string, texto: string, nav: { copiar?: (t: string) => Promise<void>; abrir: (url: string) => void }): ResultadoDeAbrir {
  let copiado = false;
  if (nav.copiar) {
    try {
      // Sin `await`: la navegación va en el mismo gesto. La promesa falla en silencio si el permiso no está.
      void nav.copiar(texto).catch(() => {});
      copiado = true;
    } catch {
      copiado = false;
    }
  }
  nav.abrir(enlace);
  return { copiado };
}

/** El navegador de verdad: `navigator.clipboard` (si existe) y `window.location.href`. */
export function navegadorReal(): { copiar?: (t: string) => Promise<void>; abrir: (url: string) => void } {
  const cb = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  return {
    copiar: cb && typeof cb.writeText === "function" ? (t) => cb.writeText(t) : undefined,
    abrir: (url) => { window.location.href = url; },
  };
}

/** Lo que se le dice a quien manda, según si se pudo copiar. */
export function avisoTrasAbrir(r: ResultadoDeAbrir, lang: "en" | "es"): string {
  if (r.copiado) {
    return lang === "es"
      ? "Texto abierto en RingCentral y copiado: si RingCentral se abre vacío, pégalo (Ctrl+V)"
      : "Text opened in RingCentral and copied: if RingCentral opens empty, paste it (Ctrl+V)";
  }
  return lang === "es" ? "Texto abierto en RingCentral" : "Text opened in RingCentral";
}
