// Captura de fallas del SERVIDOR: los envoltorios de las rutas /api, las acciones de servidor y los crons.
// Un envoltorio registra la falla y VUELVE A LANZAR el error: no cambia lo que ve quien llama. Registrar nunca lanza:
// si la base no tiene la 352 o la llamada tarda, la falla original sigue su camino igual.

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizarFalla, type OrigenDeFalla } from "./reglas";

/** Los orígenes del servidor: nunca «cliente», que solo llega desde el navegador por /api/fallas. */
export type OrigenDeServidor = Exclude<OrigenDeFalla, "cliente">;
import { anadirFallaDemo } from "./demo";

const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";
/** Tiempo máximo que el registro puede retrasar la respuesta. Pasado esto, se abandona la anotación. */
const TOPE_DE_REGISTRO_MS = 2000;

/** Marca de una falla ya anotada: el mismo error no se cuenta dos veces (envoltorio y gancho de Next). */
const REGISTRADA = Symbol.for("rtg.falla-registrada");
export function marcarRegistrada(error: unknown): void {
  if (error && typeof error === "object") {
    try { Object.defineProperty(error, REGISTRADA, { value: true, enumerable: false }); } catch { /* objeto congelado */ }
  }
}
export function yaRegistrada(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as Record<symbol, unknown>)[REGISTRADA] === true;
}

interface DatosDeFallaDelServidor {
  origen: OrigenDeServidor;
  /** Qué sitio falló: la ruta del handler o la de la acción, sin query. */
  ruta: string;
  /** Nombre corto de la función (el «componente» de la pantalla). */
  componente: string;
  app?: string | null;
  error: unknown;
}

/** El usuario de la sesión, si la hay. Nunca lanza: sin sesión, la falla queda sin usuario. */
async function usuarioDeLaSesion(): Promise<{ id: string; rol: string | null } | null> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: perfil } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    return { id: user.id, rol: (perfil?.role as string | undefined) ?? null };
  } catch {
    return null;
  }
}

/** Las redirecciones y los 404 de Next se lanzan como errores, pero no son fallas. */
export function esControlDeNext(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND") || digest.startsWith("NEXT_HTTP_ERROR"));
}

/** Escribe una falla del servidor. No lanza nunca. */
export async function registrarFallaDelServidor(datos: DatosDeFallaDelServidor): Promise<void> {
  try {
    if (esControlDeNext(datos.error)) return;
    const e = datos.error instanceof Error ? datos.error : null;
    const falla = normalizarFalla(
      {
        origen: datos.origen,
        ruta: datos.ruta,
        mensaje: e?.message || String(datos.error ?? "Error desconocido"),
        pila: e?.stack ?? "",
        componente: datos.componente,
      },
      { app: datos.app ?? null },
    );
    if (!falla) return;

    const trabajo = (async () => {
      const usuario = await usuarioDeLaSesion();
      if (LOCAL_MODE) {
        anadirFallaDemo(falla, usuario);
        return;
      }
      const admin = createAdminClient();
      await admin.rpc("registrar_falla", {
        p_origen: falla.origen,
        p_app: falla.app,
        p_ruta: falla.ruta,
        p_mensaje: falla.mensaje,
        p_pila: falla.pila,
        p_componente: falla.componente,
        p_rol: usuario?.rol ?? null,
        p_version: falla.version,
        p_navegador: null,
        p_escritorio: false,
        p_huella: falla.huella,
        p_usuario: usuario?.id ?? null,
      });
    })();

    let temporizador: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      trabajo.catch(() => undefined),
      new Promise<void>((resolver) => { temporizador = setTimeout(resolver, TOPE_DE_REGISTRO_MS); }),
    ]);
    if (temporizador) clearTimeout(temporizador);
  } catch {
    // Anotar una falla no puede causar otra falla.
  }
}

/**
 * Envuelve una función del servidor: si lanza, registra la falla (origen, sitio y nombre) y vuelve a lanzarla.
 * Úsalo en rutas /api, acciones de servidor y crons; el resultado de la función no cambia.
 */
export async function conRegistroDeFallas<T>(
  nombre: string,
  fn: () => Promise<T>,
  opciones: { origen?: OrigenDeServidor; ruta?: string; app?: string | null } = {},
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!yaRegistrada(error)) {
      marcarRegistrada(error);
      await registrarFallaDelServidor({
        origen: opciones.origen ?? "accion",
        ruta: opciones.ruta ?? `/${nombre}`,
        componente: nombre,
        app: opciones.app ?? null,
        error,
      });
    }
    throw error;
  }
}

/**
 * Para una ruta /api o un cron: `export const POST = registradaComo("/api/x", "POST", postDeX)`. Un `export async
 * function` no admite envoltorio sin cambiar su forma, así que la ruta se define aparte y se exporta envuelta.
 */
export function registradaComo<A extends unknown[], R>(
  ruta: string,
  nombre: string,
  fn: (...args: A) => Promise<R>,
  origen: OrigenDeServidor = "api",
  app: string | null = null,
): (...args: A) => Promise<R> {
  return (...args: A) => conRegistroDeFallas(`${nombre} ${ruta}`, () => fn(...args), { origen, ruta, app });
}
