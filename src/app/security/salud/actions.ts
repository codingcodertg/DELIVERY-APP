"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { leerSalud, olvidaCacheDeSalud } from "@/lib/security/salud-servidor";

/** Salud del sistema (D-1012): solo el admin. La base lo vuelve a exigir dentro de las funciones de la 300. */
const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

type R = { ok: true } | { ok: false; message: string };

async function admin() {
  if (LOCAL_MODE) return { ok: false as const, message: "No disponible en el demo." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, message: "Sin sesión." };
  const { data: p } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (p?.role !== "admin") return { ok: false as const, message: "Solo el admin." };
  return { ok: true as const, supabase };
}

/** Vuelve a leer todo ya (sin esperar los 5 min de caché). También toma una muestra nueva del disco para el ritmo. */
export async function medirDeNuevo(): Promise<R> {
  const a = await admin();
  if (!a.ok) return a;
  olvidaCacheDeSalud();
  await leerSalud(a.supabase, true);
  revalidatePath("/security/salud");
  return { ok: true };
}

/** Reinicia pg_stat_statements: la próxima lectura mide el ritmo de escrituras de AHORA. */
export async function reiniciarEstadisticas(): Promise<R> {
  const a = await admin();
  if (!a.ok) return a;
  const { error } = await a.supabase.rpc("monitor_reiniciar_estadisticas");
  if (error) return { ok: false, message: /does not exist|PGRST202/i.test(error.message) ? "Falta aplicar la migración 300." : "No se pudo reiniciar." };
  olvidaCacheDeSalud();
  revalidatePath("/security/salud");
  return { ok: true };
}
