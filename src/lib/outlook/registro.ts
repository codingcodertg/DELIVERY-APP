/**
 * El registro de lo ya procesado (`recruiting.outlook_processed`): reclamar un elemento antes de tocar nada y cerrarlo
 * con su resultado. SOLO SERVIDOR.
 *
 * Lo usan el buzón de Outlook (`sincronizar.ts`) y el bot de Indeed (`indeed-bot.ts`). Son dos caminos de entrada que
 * tienen que compartir la misma garantía: el `message_id` es la clave primaria, así que un segundo intento con la misma
 * clave choca (23505) y se salta. Correo: `message_id` = id de Graph. Bot: `message_id` = `bot:` + externalId.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type ResultadoReclamo = "reclamado" | "ya-reclamado";

/** Reclama el elemento con `failed` + «en proceso». Si ya existe, no hace nada y lo dice. */
export async function reclamaRegistro(
  db: SupabaseClient,
  d: { messageId: string; receivedAt: string | null; subject: string; fromAddress: string },
): Promise<ResultadoReclamo> {
  const { error } = await db.schema("recruiting").from("outlook_processed").insert({
    message_id: d.messageId,
    received_at: d.receivedAt,
    subject: d.subject.slice(0, 300),
    from_address: d.fromAddress.slice(0, 200),
    result: "failed",
    error: "en proceso",
  });
  if (error) {
    if (error.code === "23505") return "ya-reclamado";
    throw new Error(`no se pudo reclamar el correo: ${error.message}`);
  }
  return "reclamado";
}

export interface CierreRegistro {
  result: "created" | "duplicate" | "noted" | "skipped" | "failed";
  candidateId: string | null;
  error: string | null;
  scheduledAt: string | null;
  detail: string | null;
}

/**
 * Anota el resultado final del elemento reclamado. Un fallo aquí no tumba la corrida (el alta ya se hizo): se registra
 * en el log, igual que antes de extraer esta función.
 */
export async function cierraRegistro(db: SupabaseClient, messageId: string, c: CierreRegistro): Promise<void> {
  const { error } = await db
    .schema("recruiting")
    .from("outlook_processed")
    .update({ result: c.result, candidate_id: c.candidateId, error: c.error, scheduled_at: c.scheduledAt, detail: c.detail })
    .eq("message_id", messageId);
  if (error) console.error(`[outlook] no se pudo anotar el resultado: ${error.message}`);
}
