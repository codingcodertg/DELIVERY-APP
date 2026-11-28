import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { extensionDeLaPersona } from "@/lib/ringcentral-choferes/mi-extension";

// ============================================================
// GET /api/ringcentral/mi-extension (D-1212): la extensión de RingCentral de QUIEN PREGUNTA, si es un chofer marcado en
// RingCentral → Choferes (`rc_driver_extensions`, activa). Con ella, la ficha del chofer enseña «📞 RingCentral», que abre
// la app de RingCentral del teléfono y llama al cliente desde su propia extensión. Solo devuelve la suya: la tabla es
// solo de admin y se lee aquí con la llave del servidor, emparejando por nombre con su perfil.
// ============================================================

export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ extension: null }, { status: 401 });
  const { data: perfil } = await sb.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  if (!perfil?.full_name) return NextResponse.json({ extension: null });
  const { data, error } = await createAdminClient().from("rc_driver_extensions").select("extension_number, name").eq("active", true);
  if (error) return NextResponse.json({ extension: null });
  return NextResponse.json({ extension: extensionDeLaPersona(perfil.full_name, data ?? []) }, { headers: { "Cache-Control": "private, max-age=300" } });
}
