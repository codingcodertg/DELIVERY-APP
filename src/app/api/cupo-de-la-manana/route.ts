import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ocupadasPorVentana, reglasDeAprobacion, type FilaDeCupo } from "@/lib/aprobacion-por-hora-y-cupo";

/**
 * Cuántas órdenes hay ya en cada ventana con cupo de la mañana, en una fecha (D-639).
 *
 * Con la llave de servicio por lo mismo que `next-order-code` (D-460): ventas ve solo SUS órdenes (RLS), así que contadas
 * en el navegador el cupo nunca se llenaría para nadie. Exige sesión, lee solo cuatro columnas de ese día y devuelve los
 * números, no las órdenes. `excluir` es la propia orden, al enviarla desde borrador.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const url = new URL(req.url);
  const fecha = url.searchParams.get("fecha") ?? "";
  const excluir = url.searchParams.get("excluir");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return NextResponse.json({ error: "Bad date." }, { status: 400 });
  let admin;
  try { admin = createAdminClient(); } catch { return NextResponse.json({ error: "Server not configured." }, { status: 500 }); }
  // `*` y no la columna: sin la migración 190 la columna no existe, y pedirla por nombre rompería la lectura.
  const { data: ajustes } = await admin.from("settings").select("*").eq("id", 1).maybeSingle();
  const reglas = reglasDeAprobacion((ajustes as { approval_rules?: never } | null)?.approval_rules);
  const { data, error } = await admin.from("deliveries")
    .select("id, store, delivery_windows, stage, is_training")
    .eq("delivery_date", fecha); // todas: «todo el día» las suma (D-NEXT)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ocupadas: ocupadasPorVentana((data ?? []) as FilaDeCupo[], reglas, excluir) });
}
