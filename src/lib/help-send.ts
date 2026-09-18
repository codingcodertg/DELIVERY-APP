import { createClient } from "@/lib/supabase/client";
import { CUBO_DE_ADJUNTOS, rutaDeAdjunto } from "@/lib/help-attachments";

/**
 * Subir adjuntos y mandar una solicitud de ayuda, en un solo sitio (D-NEXT).
 *
 * Vivía dentro de `HelpButton`. Salió de ahí porque «Mis solicitudes» del hub también abre
 * solicitudes, y el hub no monta el `DataProvider` de Entregas: aquí no se usa nada de él. Quien
 * llama trae el correo de destino y decide qué decirle a la persona con el resultado.
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
  userId: string; message: string; ficheros: readonly File[]; to: string; page: string;
  senderName: string | null; role: string; appVersion: string; lang: string;
}): Promise<ResultadoDeSolicitud> {
  try {
    const subida = await subeAdjuntosDeAyuda(args.userId, args.ficheros);
    if ("fallo" in subida) return { tipo: "subida", fichero: subida.fallo };
    const res = await fetch("/api/help", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: args.message, to: args.to, page: args.page, senderName: args.senderName,
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
