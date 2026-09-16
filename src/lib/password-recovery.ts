/**
 * «¿Olvidaste tu contraseña?» que funciona abriendo el correo en CUALQUIER equipo (D-NEXT).
 *
 * EL FALLO. El login pedía el correo con el cliente del navegador, que es PKCE: el verificador del
 * código se queda en las cookies del navegador que lo pidió. Quien abría el correo en otro sitio
 * —Gmail en el móvil, otro navegador— llegaba a `/auth/callback` sin ese verificador, el canje
 * fallaba, y el guardián de rutas, al ver una sesión abierta, lo mandaba al hub tragándose el error.
 * El dueño lo contó así: «me manda el correo pero al ingresar solo me lleva al RTG Hub lobby».
 *
 * EL ARREGLO (opción B, decidida por el orquestador). El reset se pide desde el servidor con un
 * cliente de flujo **implícito**. Supabase sigue mandando su correo, con su plantilla y su propio
 * límite de envíos, pero el enlace ya no depende de nada guardado en el navegador de origen: vuelve a
 * `/reset-password` con la sesión en el fragmento de la URL, y la pantalla la toma allí.
 *
 * Se descartó mandar el correo nosotros (`generateLink` + Resend): una ruta pública que envía correos
 * sin limitador dejaría lanzar correos sin tope a cualquier empleado, y montar un limitador pide tabla
 * y migración. Con B el límite lo sigue poniendo Supabase.
 *
 * Aquí vive lo que decide, sin red, para probarlo con datos.
 */

/** Lo único que la ruta contesta cuando el correo tiene forma de correo, exista o no la cuenta. */
export const RESPUESTA_OLVIDO = { ok: true } as const;

/** Un correo con forma mínima de correo, recortado. Null si no la tiene. */
export function correoParaRecuperar(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const limpio = v.trim();
  // Lo mínimo para no mandar basura a Supabase: algo, una arroba, y algo con un punto detrás.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpio) ? limpio : null;
}

/** A dónde vuelve el enlace del correo: la pantalla que lee el fragmento, en el mismo origen. */
export function destinoDelEnlace(origen: string): string {
  return new URL("/reset-password", origen).toString();
}

export type EnviarRecuperacion = (correo: string, redirectTo: string) => Promise<{ error: unknown } | void>;

/**
 * El núcleo de la ruta. **Contesta lo mismo exista o no la cuenta, y pase lo que pase al enviar**,
 * para que la ruta no sirva para averiguar qué correos están dados de alta.
 *
 * Eso incluye el límite de envíos: el de Supabase por usuario solo salta para cuentas que existen, así
 * que devolver un «demasiados intentos» contaría precisamente eso. El coste es que quien choque con el
 * límite no se entera; se acepta, porque lo contrario es una puerta para enumerar la plantilla.
 *
 * Solo un correo sin forma de correo recibe otra respuesta: eso no dice nada de ninguna cuenta.
 */
export async function pideRecuperacion(
  entrada: unknown,
  origen: string,
  enviar: EnviarRecuperacion,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const correo = correoParaRecuperar(entrada);
  if (!correo) return { status: 400, body: { error: "invalid_email" } };
  try {
    await enviar(correo, destinoDelEnlace(origen));
  } catch {
    // Mismo silencio que con un error devuelto: la respuesta no puede depender de lo que pasó.
  }
  return { status: 200, body: { ...RESPUESTA_OLVIDO } };
}

export type LecturaDelFragmento =
  | { kind: "sesion"; access_token: string; refresh_token: string }
  | { kind: "error"; mensaje: string }
  | { kind: "nada" };

/**
 * Lo que trae el fragmento con el que Supabase devuelve al usuario a `/reset-password`.
 *
 * Solo se acepta una sesión **de recuperación** (`type=recovery`) con los dos tokens: un fragmento con
 * otro tipo —un enlace mágico, una confirmación de alta— no abre esta pantalla para cambiar la
 * contraseña de nadie. Y si trae un error, se devuelve para enseñarlo en vez de dejar la pantalla muda.
 */
export function leeFragmentoRecuperacion(hash: string | null | undefined): LecturaDelFragmento {
  const crudo = (hash ?? "").replace(/^#/, "");
  if (!crudo) return { kind: "nada" };
  const p = new URLSearchParams(crudo);
  const error = p.get("error_description") || p.get("error") || p.get("error_code");
  if (error && error.trim()) return { kind: "error", mensaje: error.trim() };
  const access = p.get("access_token")?.trim();
  const refresh = p.get("refresh_token")?.trim();
  if (p.get("type") === "recovery" && access && refresh) {
    return { kind: "sesion", access_token: access, refresh_token: refresh };
  }
  return { kind: "nada" };
}
