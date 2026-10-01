import { createClient } from "@/lib/clockin/supabase/client";
import { compressImage } from "@/lib/clockin/image";
import { rutaDeFoto } from "@/lib/clockin/visitas";

/**
 * Subir una foto de fichaje, de salida o de visita (D-NEXT la saca de PunchPanel para que las
 * fotos de visita y de parada suban EXACTAMENTE igual que la del fichaje, no «parecido»).
 *
 * Lo que se conserva de D-125, porque no es adorno:
 *   · se comprime antes: una foto de móvil son 8–12 MB y con mala cobertura se queda colgada;
 *   · la subida lleva su propio límite de 30 s, porque no trae ninguno de serie — ese fue el
 *     «hice la foto y no pasó nada» del original;
 *   · mismo bucket y misma forma de ruta (`rutaDeFoto`).
 *
 * No lanza: devuelve por qué falló, y quien llama decide con qué palabras decirlo.
 */
export type SubidaDeFoto =
  | { ok: true; path: string }
  | { ok: false; motivo: "timeout" }
  | { ok: false; motivo: "error"; message: string };

export async function subirFotoDeFichaje(
  file: File,
  quien: { companyId: string | null; userId: string },
): Promise<SubidaDeFoto> {
  const supabase = createClient();
  const body = await compressImage(file);
  const path = rutaDeFoto(quien.companyId, quien.userId, Date.now());
  const r = await Promise.race([
    supabase.storage.from("exception-photos").upload(path, body, { contentType: "image/jpeg", upsert: false }),
    new Promise<"timeout">((res) => setTimeout(() => res("timeout"), 30000)),
  ]);
  if (r === "timeout") return { ok: false, motivo: "timeout" };
  if (r.error) return { ok: false, motivo: "error", message: r.error.message };
  return { ok: true, path };
}
