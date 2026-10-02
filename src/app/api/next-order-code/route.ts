import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { codeBand, nextOrderCode } from "@/lib/order-code";

/**
 * El siguiente código de orden (D-460), calculado con TODOS los códigos de la banda, no solo los que ve quien crea.
 *
 * El fallo: el código se calculaba en el navegador con las órdenes que la persona tiene a la vista. Desde que ventas ve
 * solo SUS órdenes (RLS), su «máximo + 1» ya estaba usado por otro, el índice único lo rechazaba, y el reintento volvía a
 * leer con la misma RLS: mismo número, mismo rechazo, cinco veces. El 2026-10-02 Everto Prado no podía crear órdenes
 * («duplicate key value violates unique constraint») y la secuencia de `order_no` saltó de 735 a 766.
 *
 * Aquí se lee con la llave de servicio (sin RLS) SOLO la columna `order_code` de la banda de la semana, y se devuelve el
 * siguiente. Exige sesión. No escribe nada: si dos personas piden a la vez, el índice único sigue decidiendo y quien
 * choca vuelve a pedir.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  let admin;
  try { admin = createAdminClient(); } catch { return NextResponse.json({ error: "Server not configured." }, { status: 500 }); }
  const band = codeBand(new Date());
  const { data, error } = await admin.from("deliveries")
    .select("order_code").eq("is_training", false)
    .gte("order_code", band.prefix + "000").lte("order_code", band.prefix + "999z");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const codes = ((data ?? []) as { order_code: string | null }[]).map((r) => r.order_code);
  return NextResponse.json({ code: nextOrderCode(codes, new Date()) });
}
