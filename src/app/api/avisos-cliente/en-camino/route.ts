import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ejecutarEnCamino, origenPublico } from "@/lib/avisos-cliente-envio";
import { proveedorDelEntorno } from "@/lib/mensajeria";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Aviso «en camino» (D-416, 150). La app lo pide, sin esperar respuesta, justo después de que el chofer recoge o
 * entrega una orden (`setStage` y la cola offline de data-provider). La ruta NO se fía de lo que diga el navegador:
 * solo recibe el id, y `ejecutarEnCamino` rehace la ruta del chofer desde la base y decide si la siguiente parada se
 * avisa. Pedirlo dos veces no manda dos avisos (registro con clave orden+tipo+día).
 *
 * Con sesión (cualquier usuario: quien cierra la parada es el chofer, o quien lo hace por él). Usa la llave de
 * servicio porque el chofer no puede leer ni escribir el registro ni las bajas (RLS de la 150: solo admin lee).
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!UUID.test(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  let db;
  try { db = createAdminClient(); } catch { return NextResponse.json({ error: "not configured" }, { status: 500 }); }
  const informe = await ejecutarEnCamino({ db, proveedor: proveedorDelEntorno(), origen: origenPublico(req.url) }, id);
  return NextResponse.json(informe, { status: informe.ok ? 200 : 502 });
}
