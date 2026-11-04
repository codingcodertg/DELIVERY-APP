import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { firmaLlaveDeGps } from "@/lib/gps-token";

// D-838: la llave del turno para que la app Android suba posiciones sola. Solo un chofer, y solo para sí mismo.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { data: perfil } = await auth.supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (perfil?.role !== "driver") return NextResponse.json({ error: "Only drivers report positions." }, { status: 403 });
  try {
    const { token, expira } = firmaLlaveDeGps(auth.user.id);
    return NextResponse.json({ token, expira }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "GPS key unavailable." }, { status: 503 });
  }
}
