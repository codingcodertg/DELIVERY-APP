import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { errorAlCliente } from "@/lib/api-error";
import { filasDeIngesta, verificaLlaveDeGps } from "@/lib/gps-token";

// D-838: donde la app Android sube las posiciones SOLA, sin la página (que Android congela con el teléfono bloqueado).
// Sin sesión: se autentica con la llave del turno (`/api/gps/token`), que solo deja escribir posiciones de su chofer.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const driverId = verificaLlaveDeGps(auth.startsWith("Bearer ") ? auth.slice(7).trim() : null);
  // 401 = la app guarda la cola y espera una llave nueva (la pide al volver al frente).
  if (!driverId) return NextResponse.json({ error: "Invalid or expired GPS key." }, { status: 401 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad JSON." }, { status: 400 }); }
  const filas = filasDeIngesta(driverId, body);
  if (!filas.length) return NextResponse.json({ ok: true, n: 0 });
  try {
    const { error } = await createAdminClient().from("driver_locations").insert(filas);
    // 5xx = la app lo reintenta; nunca 400 por un fallo nuestro, que la app tiraría el lote.
    if (error) return errorAlCliente("gps/ingest", error, 503, "Could not save locations.");
  } catch (e) {
    return errorAlCliente("gps/ingest", e, 503, "Could not save locations.");
  }
  return NextResponse.json({ ok: true, n: filas.length });
}
