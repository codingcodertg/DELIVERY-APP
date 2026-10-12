import { createClient } from "@/lib/supabase/client";
import { CUBO_DE_ADJUNTOS, rutaDeAdjunto } from "@/lib/help-attachments";
import type { ContactoDeAyuda } from "@/lib/ayuda-flotante";
import { ROLE_INFO, roleLabel } from "@/lib/constants";
import type { UserRole } from "@/lib/types";

/**
 * Subir adjuntos y mandar una solicitud de ayuda, en un solo sitio (D-311).
 *
 * Vivía dentro de `HelpButton`. Salió de ahí porque «Mis solicitudes» del hub también abre
 * solicitudes, y el hub no monta el `DataProvider` de Entregas: aquí no se usa nada de él. Quien
 * llama decide qué decirle a la persona con el resultado.
 *
 * El correo de destino ya no lo trae quien llama (D-530): lo decide el servidor (`destinoDeAyuda`, en
 * `lib/ayuda-flotante.ts`), porque quien no tiene Entregas no puede leer `settings` y la burbuja de
 * Ayuda está ahora en todas las apps.
 */

export type AdjuntoSubido = { path: string; nombre: string };

/** Sube lo elegido a la carpeta de quien escribe. Si una subida falla devuelve el nombre del fichero:
 *  mejor no mandar nada que mandar algo diciendo que lleva unos adjuntos que no están. */
export async function subeAdjuntosDeAyuda(userId: string, ficheros: readonly File[]): Promise<{ subidos: AdjuntoSubido[] } | { fallo: string }> {
  if (!ficheros.length) return { subidos: [] };
  const almacen = createClient().storage.from(CUBO_DE_ADJUNTOS);
  const subidos: AdjuntoSubido[] = [];
  for (const f of ficheros) {
    const path = rutaDeAdjunto(userId, f.name, new Date());
    const { error } = await almacen.upload(path, f, { contentType: f.type || undefined, upsert: false });
    if (error) return { fallo: f.name };
    subidos.push({ path, nombre: f.name });
  }
  return { subidos };
}

export type ResultadoDeSolicitud =
  | { tipo: "enviada" }
  /** Guardada, pero el correo no está configurado: no se dice que llegó. */
  | { tipo: "sin-correo" }
  | { tipo: "subida"; fichero: string }
  | { tipo: "fallo" }
  | { tipo: "red" };

export async function enviaSolicitudDeAyuda(args: {
  userId: string; message: string; ficheros: readonly File[]; page: string;
  senderName: string | null; role: string; appVersion: string; lang: string;
}): Promise<ResultadoDeSolicitud> {
  try {
    const subida = await subeAdjuntosDeAyuda(args.userId, args.ficheros);
    if ("fallo" in subida) return { tipo: "subida", fichero: subida.fallo };
    const res = await fetch("/api/help", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: args.message, page: args.page, senderName: args.senderName,
        role: args.role, appVersion: args.appVersion, lang: args.lang, archivos: subida.subidos,
      }),
    });
    const b = await res.json().catch(() => ({}));
    if (b.ok) return { tipo: "enviada" };
    if (b.dryRun) return { tipo: "sin-correo" };
    return { tipo: "fallo" };
  } catch {
    return { tipo: "red" };
  }
}

/**
 * Lo que la burbuja de Ayuda necesita antes de mandar (D-530): el teléfono de ayuda y quién escribe. Lo contesta
 * `GET /api/help` con la sesión, igual desde cualquier app (ver `ContactoDeAyuda`). Sin sesión, o sin red, `null`:
 * la burbuja dice que no se pudo mandar en vez de mandar una solicitud sin dueño.
 */
export async function pideContactoDeAyuda(): Promise<ContactoDeAyuda | null> {
  try {
    const res = await fetch("/api/help", { method: "GET" });
    // Sin sesión contesta 401 con `{ error }`: sin id, y por eso sin dueño. No hace falta mirar `res.ok` aparte.
    const c = (await res.json()) as Partial<ContactoDeAyuda> | null;
    if (!c?.id) return null;
    return { id: c.id, telefono: c.telefono ?? null, nombre: c.nombre ?? null, rol: c.rol ?? null };
  } catch {
    return null;
  }
}

/**
 * El rol de quien escribe, en palabras, para el correo. Lo que llega de `profiles.role` es texto: si no es uno de los
 * roles que conoce el app, va tal cual en vez de romper `roleLabel`.
 */
export function rolDeQuienEscribe(rol: string | null, lang: "en" | "es"): string {
  if (!rol) return "";
  return rol in ROLE_INFO ? roleLabel(rol as UserRole, lang) : rol;
}
