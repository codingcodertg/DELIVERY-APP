// ============================================================
// «📸 Varias fotos» (D-637): la cámara dentro de la app, para sacar varias fotos seguidas y entregarlas todas de una vez.
//
// El dueño, 2026-10-22: los choferes dicen que la cámara de «Entregado» no les sirve. La cámara nativa del teléfono
// (`<input type="file" capture>`) devuelve UNA foto por vez —en Android, `ACTION_IMAGE_CAPTURE`—, así que cada foto era
// abrir la cámara, disparar, aceptar y volver. Aquí la cámara se abre con `getUserMedia` y se queda abierta: cada toque
// del disparador saca una foto del vídeo, y «✅ Listo» las entrega todas.
//
// Lo puro está aquí para probarlo sin navegador: las medidas de la compresión (las mismas de `compress` de
// `PhotoUpload`), el tope de fotos, abrir y parar la cámara (con un `navigator` que se pasa por parámetro), y qué se
// entrega al cerrar. El componente es `src/components/CamaraDeVariasFotos.tsx`.
// ============================================================

/** El lado mayor de una foto comprimida, en píxeles. Lo usan `compress` (fichero elegido) y la ráfaga (vídeo). */
export const LADO_MAXIMO = 1280;
/** La calidad JPEG de una foto comprimida. */
export const CALIDAD_JPEG = 0.7;

/** Las medidas a las que se reduce una imagen de `ancho`×`alto`: el lado mayor a `LADO_MAXIMO` como mucho; nunca se agranda. */
export function medidasComprimidas(ancho: number, alto: number): { w: number; h: number } {
  const escala = Math.min(1, LADO_MAXIMO / Math.max(ancho, alto));
  return { w: Math.round(ancho * escala), h: Math.round(alto * escala) };
}

/**
 * Dibuja `fuente` (una imagen ya decodificada, o el `<video>` de la cámara) en un lienzo reducido con
 * `medidasComprimidas` y lo devuelve como `data:` JPEG a `CALIDAD_JPEG`. Una sola implementación para `compress` de
 * `PhotoUpload` y para la ráfaga. Solo en el navegador (usa `document`); lanza si no hay contexto 2D.
 */
export function jpegComprimido(fuente: CanvasImageSource, ancho: number, alto: number): string {
  const { w, h } = medidasComprimidas(ancho, alto);
  const lienzo = document.createElement("canvas");
  lienzo.width = w;
  lienzo.height = h;
  const ctx = lienzo.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(fuente, 0, 0, w, h);
  return lienzo.toDataURL("image/jpeg", CALIDAD_JPEG);
}

/** Cuántas fotos caben aún: `max` menos las que ya hay, nunca negativo. */
export function huecoDeFotos(yaHay: number, max: number): number {
  return Math.max(0, max - yaHay);
}

/** Añade una foto a la ráfaga si cabe; si ya está llena, la ráfaga queda igual. */
export function agregarALaRafaga(fotos: readonly string[], foto: string, max: number): string[] {
  if (fotos.length >= max) return [...fotos];
  return [...fotos, foto];
}

/** Quita la foto `i` de la ráfaga (la ✕ de su miniatura). */
export function quitarDeLaRafaga(fotos: readonly string[], i: number): string[] {
  return fotos.filter((_, x) => x !== i);
}

/** Cómo se cierra la ráfaga: «✅ Listo» con las fotos sacadas, o «Cancelar». */
export type FinDeRafaga = { tipo: "listo"; fotos: readonly string[] } | { tipo: "cancelar" };

/**
 * Qué fotos se entregan al cerrar la ráfaga: con «Listo», TODAS las sacadas (hasta el hueco que quede en el sitio donde
 * se usa); con «Cancelar», ninguna.
 */
export function fotosAlCerrarLaRafaga(fin: FinDeRafaga, hueco: number): string[] {
  if (fin.tipo !== "listo") return [];
  return fin.fotos.slice(0, Math.max(0, hueco));
}

// ---------- Abrir y parar la cámara ----------

/** Lo mínimo de un `MediaStream` que hace falta aquí: sus pistas, para pararlas. */
export type FlujoDeCamara = { getTracks: () => { stop: () => void }[] };
/** Lo mínimo de `navigator` que hace falta aquí. */
export type NavegadorConCamara = {
  mediaDevices?: { getUserMedia?: (c: { video: unknown; audio: boolean }) => Promise<FlujoDeCamara> };
};

/** ¿Este navegador sabe abrir la cámara dentro de la página? En una página sin https, o en un WebView viejo, no. */
export function hayCamaraEnVivo(nav: NavegadorConCamara | undefined | null): boolean {
  return typeof nav?.mediaDevices?.getUserMedia === "function";
}

/** La cámara trasera; `ideal` nunca hace fallar la petición, y la foto se reduce después a `LADO_MAXIMO`. */
export const PETICION_DE_CAMARA = {
  video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  audio: false,
} as const;

export type AperturaDeCamara = { ok: true; flujo: FlujoDeCamara } | { ok: false; motivo: "sin-camara" | "negada" | "cerrada" };

/** Para todas las pistas de la cámara (la luz del teléfono se apaga). Sin flujo, no hace nada. */
export function pararCamara(flujo: FlujoDeCamara | null | undefined): void {
  for (const pista of flujo?.getTracks() ?? []) pista.stop();
}

/**
 * Una sesión de cámara: `abrir()` la pide y `cerrar()` la para. Si se cierra ANTES de que el navegador conteste (el chofer
 * pulsó «Cancelar» mientras salía el permiso, o la pantalla se desmontó), la cámara que llegue tarde se para en el acto y
 * `abrir()` responde `cerrada`: sin esto se quedaba encendida, sin vídeo en ninguna parte.
 */
export function sesionDeCamara(nav: NavegadorConCamara | undefined | null) {
  let flujo: FlujoDeCamara | null = null;
  let cerrada = false;
  return {
    async abrir(): Promise<AperturaDeCamara> {
      if (!hayCamaraEnVivo(nav)) return { ok: false, motivo: "sin-camara" };
      let f: FlujoDeCamara;
      try {
        f = await nav!.mediaDevices!.getUserMedia!(PETICION_DE_CAMARA);
      } catch {
        return { ok: false, motivo: "negada" };
      }
      if (cerrada) { pararCamara(f); return { ok: false, motivo: "cerrada" }; }
      flujo = f;
      return { ok: true, flujo: f };
    },
    cerrar(): void {
      cerrada = true;
      pararCamara(flujo);
      flujo = null;
    },
  };
}

/** El aviso de una línea cuando la cámara de la app no se abre (permiso negado, la app de Android de antes de la cámara). */
export const AVISO_SIN_CAMARA = {
  en: "This version of the app can't use the camera here: use 📷 One photo or 🖼 Gallery, or update the app.",
  es: "Esta versión de la app no deja usar la cámara aquí: use 📷 Una foto o 🖼 Galería, o actualice la app.",
} as const;
