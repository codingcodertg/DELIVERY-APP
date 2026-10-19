import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NamedLocation } from "@/lib/types";

// ============================================================
// GET /api/recruiting/stores (D-NEXT, 2026-10-19). Las tiendas de Datos → Tiendas de Entregas (`public.settings.stores`),
// solo nombre y dirección, para que el texto de la cita presencial lleve la dirección de la tienda donde se cita.
//
// Por qué una ruta: `public.settings` solo lo lee quien tiene el módulo de Entregas (`has_deliveries_access`, 100), y un
// reclutador puede no tenerlo. La puerta aquí es la sesión más el módulo de RR. HH.: se lee `recruiting.settings` con la
// sesión del usuario, que la RLS (`has_recruiting_access`, 100) deja vacía si no tiene el módulo → 403. Solo entonces el
// cliente de servicio lee las tiendas. No sale nada más de `settings` (ni ajustes, ni extensiones, ni coordenadas).
// ============================================================

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { data: rrhh, error } = await auth.supabase.schema("recruiting").from("settings").select("id").eq("id", 1).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 503 });
  if (!rrhh) return NextResponse.json({ error: "No HR access" }, { status: 403 });

  const { data, error: e2 } = await createAdminClient().from("settings").select("stores").eq("id", 1).maybeSingle();
  if (e2) return NextResponse.json({ error: e2.message }, { status: 503 });
  const stores = ((data?.stores ?? []) as NamedLocation[])
    .filter((s) => s.name?.trim() && s.address?.trim())
    .map((s) => ({ name: s.name.trim(), address: s.address.trim() }));
  return NextResponse.json({ stores });
}
