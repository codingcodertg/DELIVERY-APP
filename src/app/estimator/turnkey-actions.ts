"use server";

import { createClient } from "@/lib/supabase/server";
import { datosTurnkey } from "@/lib/estimator/turnkey-datos";
import type { DatosTurnkey } from "@/lib/estimator/turnkey";

/**
 * Los precios, planes y tasas de descuento de Turnkey (la plantilla del dueño). Solo el admin los recibe.
 *
 * El cliente nunca tiene el catálogo: la pestaña se carga con `next/dynamic` solo para el admin, y la pide aquí. La
 * comprobación es la misma que en `security/actions.ts`: la sesión de quien llama, y `profiles.role = 'admin'`. No hay
 * llave de servicio ni RLS que ablandar; si no es admin, esta función devuelve solo un mensaje.
 *
 * El demo (`NEXT_PUBLIC_LOCAL_MODE`) no tiene sesión, así que contesta con los datos de la plantilla. Solo corre en la
 * máquina del dueño; no hay demo desplegado. Si algún día se desplegara, esta rama habría que quitarla.
 */
const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

type R = { ok: true; datos: DatosTurnkey } | { ok: false; message: string };

export async function cargaTurnkey(): Promise<R> {
  if (LOCAL_MODE) return { ok: true, datos: datosTurnkey() };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };
  const { data: p } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (p?.role !== "admin") return { ok: false, message: "Only an admin can open Turnkey." };
  return { ok: true, datos: datosTurnkey() };
}
