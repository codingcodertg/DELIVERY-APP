import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { errorAlCliente } from "@/lib/api-error";
import { filasDeIngesta, verificaLlaveDeGps } from "@/lib/gps-token";

// D-838: donde la app Android sube las posiciones SOLA, sin la página (que Android congela con el teléfono bloqueado).
// Sin sesión: se autentica con la llave del turno (`/api/gps/token`), que solo deja escribir posiciones de su chofer.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// D-990: cliente de servicio CRUDO, no el cliente admin envuelto. Este punto se autentica con la llave del turno del chofer
// (no con la sesión del navegador), así que la cookie del modo enseñanza no tiene nada que decir aquí. Con el cliente
// envuelto, un teléfono que se quedó en práctica perdía TODAS sus posiciones (403 «ENSENANZA» que la app reintentaba sin
// fin: 486 rechazos en 3 h el 11 nov, Ernesto).
function servicio() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const llave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !llave) throw new Error("Missing Supabase service configuration.");
  return createClient(url, llave, { auth: { autoRefreshToken: false, persistSession: false } });
}

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
    const { error } = await servicio().from("driver_locations").insert(filas);
    // 5xx = la app lo reintenta; nunca 400 por un fallo nuestro, que la app tiraría el lote.
    if (error) return errorAlCliente("gps/ingest", error, 503, "Could not save locations.");
  } catch (e) {
    return errorAlCliente("gps/ingest", e, 503, "Could not save locations.");
  }
  return NextResponse.json({ ok: true, n: filas.length });
}
