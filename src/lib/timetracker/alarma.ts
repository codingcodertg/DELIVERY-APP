"use client";

/**
 * El aviso sonoro y de sistema de «el reloj no se está guardando» (incidente del 2026-10-04).
 *
 * Todo aquí es **mejor esfuerzo** y nunca lanza: un navegador puede negar el audio sin un gesto
 * previo y las notificaciones sin permiso, y que la alarma no suene no puede romper el
 * cronómetro. El aviso que no falla es el visible, que pinta la pantalla.
 */

/** Tres pitidos cortos. En la app de escritorio (Electron) suena sin gesto previo. */
export function sonarAlarma(): void {
  try {
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctx = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const ahora = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gan = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 880;
      gan.gain.setValueAtTime(0.0001, ahora + i * 0.35);
      gan.gain.exponentialRampToValueAtTime(0.25, ahora + i * 0.35 + 0.02);
      gan.gain.exponentialRampToValueAtTime(0.0001, ahora + i * 0.35 + 0.25);
      osc.connect(gan);
      gan.connect(ctx.destination);
      osc.start(ahora + i * 0.35);
      osc.stop(ahora + i * 0.35 + 0.27);
    }
    setTimeout(() => { void ctx.close().catch(() => {}); }, 1500);
  } catch { /* sin audio: queda el aviso visible */ }
}

/**
 * Notificación del sistema, también en el escritorio.
 *
 * `notify()` del proveedor se la salta en el escritorio porque allí el cascarón pinta sus
 * propios avisos para «captura tomada» y «reloj arrancado». Para ESTO no pinta ninguno (la
 * 0.0.45 instalada no tiene ese canal), y es justo el aviso que tiene que llegar con la
 * ventana minimizada, así que se manda igual.
 */
export function avisoDeSistema(titulo: string, cuerpo: string): void {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    new Notification(titulo, { body: cuerpo, requireInteraction: true });
  } catch { /* ignore */ }
}
