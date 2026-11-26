// Captura de fallas del NAVEGADOR. Informar nunca lanza ni vuelve a informar: si el envío falla, se olvida (una falla
// perdida es mejor que un bucle de fallas que se reportan a sí mismas). Las huellas repetidas se mandan una vez por
// minuto (`Desduplicador`), y lo que sale va en lotes a /api/fallas.

import { enAppDeEscritorio } from "@/lib/desktop-shell";
import { cabeEnElCuerpo, Desduplicador, LIMITES, normalizarFalla, type OrigenDeFalla } from "./reglas";

const RETRASO_DE_ENVIO_MS = 1500;
const desduplicador = new Desduplicador();
let cola: Record<string, unknown>[] = [];
let temporizador: ReturnType<typeof setTimeout> | null = null;

/** Ruidos del navegador que no son fallas de la app. */
const RUIDO = [/ResizeObserver loop/i, /^Script error\.?$/i];

function enviarCola(): void {
  temporizador = null;
  const lote = cola.splice(0, LIMITES.lote);
  if (lote.length === 0) return;
  try {
    const cuerpo = JSON.stringify({ fallas: lote });
    if (!cabeEnElCuerpo(cuerpo)) return;
    // keepalive: que el envío sobreviva si la pestaña se cierra o cambia de página.
    void fetch("/api/fallas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: cuerpo,
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => undefined);
  } catch {
    // Sin red o sin fetch: se pierde esta tanda, nada más.
  }
  // Si quedan más fallas que el lote, la siguiente tanda sale en otro envío.
  if (cola.length > 0) programarEnvio();
}

function programarEnvio(): void {
  if (temporizador !== null) return;
  temporizador = setTimeout(enviarCola, RETRASO_DE_ENVIO_MS);
}

/**
 * Informa una falla del navegador. `origen` es «cliente» (excepción no capturada, error de un componente) o «accion»
 * (una escritura que la base rechazó). Nunca lanza.
 */
export function informarFalla(
  error: unknown,
  extra: { origen?: OrigenDeFalla; componente?: string | null } = {},
): void {
  try {
    if (typeof window === "undefined") return;
    const e = error instanceof Error ? error : null;
    const mensaje = e?.message || (typeof error === "string" ? error : "") || "Error desconocido";
    if (RUIDO.some((r) => r.test(mensaje))) return;
    const falla = normalizarFalla(
      {
        origen: extra.origen ?? "cliente",
        ruta: window.location.pathname,
        mensaje,
        pila: e?.stack ?? "",
        componente: extra.componente ?? null,
      },
      {
        navegador: navigator.userAgent,
        escritorio: enAppDeEscritorio(window),
      },
    );
    if (!falla) return;
    if (!desduplicador.debeEnviarse(falla.huella)) return;
    cola.push({
      origen: falla.origen,
      ruta: falla.ruta,
      mensaje: falla.mensaje,
      pila: falla.pila,
      componente: falla.componente,
      escritorio: falla.escritorio,
    });
    if (cola.length > LIMITES.lote * 4) cola = cola.slice(-LIMITES.lote * 4);
    programarEnvio();
  } catch {
    // Informar una falla no puede causar otra.
  }
}

/** Una escritura que la base rechazó (el mismo error que ya muestra el aviso rojo). Nunca lanza. */
export function informarErrorDeEscritura(tabla: string, error: { message?: string } | null | undefined): void {
  if (!error) return;
  informarFalla(new Error(`No se pudo guardar en ${tabla}: ${error.message ?? "error"}`), {
    origen: "accion",
    componente: tabla,
  });
}

/** Envía lo que quede al salir de la página (pestaña oculta o cerrada). */
export function vaciarAlSalir(): void {
  if (temporizador !== null) {
    clearTimeout(temporizador);
    temporizador = null;
  }
  while (cola.length > 0) enviarCola();
}
