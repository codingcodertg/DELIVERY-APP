/* ---- Abrir un texto en RingCentral con el texto también en el portapapeles (D-604, 2026-10-19) ----
 * El dueño: «le doy enviar y se abre ring central pero no aparece nada». El enlace `rcapp://r/sms?…&text=…` lleva el texto
 * en la URL; el de «¿te puedo llamar?» (~250 letras) aparece y el de la cita (~330, y la plantilla del dueño es más larga
 * y con saltos de línea) llega en blanco. No se ha medido el límite exacto de la app, así que no se adivina: el texto va
 * en el enlace Y en el portapapeles, en el mismo clic (el navegador solo deja copiar dentro del gesto), y el aviso dice
 * «si RingCentral se abre vacío, pégalo». */

export type ResultadoDeAbrir = { copiado: boolean };

/** Copia `texto` al portapapeles (si el navegador deja) y abre `enlace`. Se llama DENTRO del clic, antes de cualquier `await`. */
export function abrirSmsEnRingCentral(enlace: string, texto: string, nav: { copiar?: (t: string) => Promise<void>; copiarAhora?: (t: string) => boolean; abrir: (url: string) => void }): ResultadoDeAbrir {
  let copiado = false;
  // D-717: primero la copia SÍNCRONA (execCommand), que dice de verdad si copió y no depende del permiso del portapapeles;
  // la asíncrona va detrás por si la otra no existe. El dueño: «si ya estoy en el mismo chat … no se copia el mensaje»:
  // RingCentral, con ese chat ya abierto, no cambia el texto que lleva el enlace; lo único que llega es lo pegado.
  if (nav.copiarAhora) {
    try { copiado = nav.copiarAhora(texto); } catch { copiado = false; }
  }
  if (nav.copiar) {
    try {
      // Sin `await`: la navegación va en el mismo gesto. La promesa falla en silencio si el permiso no está.
      void nav.copiar(texto).catch(() => {});
      copiado = true;
    } catch {
      /* la síncrona ya dijo lo suyo */
    }
  }
  nav.abrir(enlace);
  return { copiado };
}

/** El navegador de verdad: `navigator.clipboard` (si existe) y `window.location.href`. */
export function navegadorReal(): { copiar?: (t: string) => Promise<void>; copiarAhora?: (t: string) => boolean; abrir: (url: string) => void } {
  const cb = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  return {
    copiar: cb && typeof cb.writeText === "function" ? (t) => cb.writeText(t) : undefined,
    copiarAhora: (t) => {
      if (typeof document === "undefined") return false;
      const ta = document.createElement("textarea");
      ta.value = t; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { return document.execCommand("copy"); } catch { return false; } finally { ta.remove(); }
    },
    abrir: (url) => { window.location.href = url; },
  };
}

/** Lo que se le dice a quien manda, según si se pudo copiar. */
export function avisoTrasAbrir(r: ResultadoDeAbrir, lang: "en" | "es"): string {
  if (r.copiado) {
    return lang === "es"
      ? "Texto abierto en RingCentral y copiado: si RingCentral se abre vacío o ya tenías ese chat abierto, pégalo (Ctrl+V)"
      : "Text opened in RingCentral and copied: if RingCentral opens empty or that chat was already open, paste it (Ctrl+V)";
  }
  return lang === "es" ? "Texto abierto en RingCentral" : "Text opened in RingCentral";
}
