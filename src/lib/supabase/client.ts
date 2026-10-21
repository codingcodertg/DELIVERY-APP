"use client";

import { createBrowserClient } from "@supabase/ssr";
import { ensenanzaDelNavegador, fetchDeEnsenanza } from "@/lib/ensenanza-general";

/** Supabase client for use in Client Components (browser). */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Modo enseñanza (D-626): con la cookie puesta, lo que escribe no sale del navegador.
      global: { fetch: fetchDeEnsenanza((i, o) => fetch(i, o), ensenanzaDelNavegador) },
    },
  );
}
