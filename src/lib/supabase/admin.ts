import { createClient } from "@supabase/supabase-js";
import { fetchDeEnsenanzaDeLaPeticion } from "@/lib/ensenanza-servidor";

/**
 * Service-role Supabase client — SERVER ONLY. Never import this into a client
 * component. Uses the secret key, so it bypasses RLS. Guard every caller with
 * an explicit admin check.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (server env var).");
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    // Modo enseñanza (D-626): si la petición trae la cookie, lo que escribe no llega a la base (salvo el chat, la
    // ayuda y el registro de seguridad: `TABLAS_QUE_SIGUEN`). Un cron no la trae.
    global: { fetch: fetchDeEnsenanzaDeLaPeticion() },
  });
}
