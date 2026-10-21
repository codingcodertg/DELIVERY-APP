"use client";

import { createBrowserClient } from "@supabase/ssr";
import { fetchDePracticaDelNavegador } from "@/lib/practica/fetch-de-practica";

/** Supabase client for use in Client Components (browser). */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Modo enseñanza (D-626, D-628): con la cookie puesta, lo que escribe en una tabla se apunta en la práctica del
      // navegador y se ve como guardado; lo que no se puede practicar (funciones que escriben, archivos) se corta y avisa.
      global: { fetch: fetchDePracticaDelNavegador() },
    },
  );
}
