import { NextResponse } from "next/server";
import { limita, respuesta429 } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { clienteAnonimo } from "@/lib/tarjetas/servidor";
import { BUCKET_DE_TARJETAS, TAMANO_MAX_FOTO, esClaseDeFoto, esFirmaDeImagen, extensionDeFoto, rutaDeFoto, urlPublicaDeFoto } from "@/lib/tarjetas/fotos";
import { tokenValido } from "@/lib/tarjetas/token";

// ============================================================
// POST /api/tarjetas/foto: la persona sube la foto (o la portada) de SU tarjeta con su enlace privado. Sin sesión.
// Orden: límite por IP → token (exacto, de una tarjeta activa) → clase → tipo y tamaño → firma del archivo → subida
// a la carpeta de la tarjeta (su id) → `business_card_set_media` con el token. Si la base rechaza la ruta, se borra
// el archivo subido. El token nunca sale en una respuesta ni en un registro.
// ============================================================

export async function POST(req: Request) {
  const limite = await limita(req, { clave: "tarjetas-foto", max: 30, ventanaSeg: 3600 });
  if (!limite.ok) return respuesta429(limite.reset);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const tokenCrudo = form.get("token");
  const token = typeof tokenCrudo === "string" ? tokenCrudo : null;
  const clase = form.get("clase");
  const archivo = form.get("archivo");

  if (!token || !tokenValido(token)) return NextResponse.json({ error: "link" }, { status: 404 });
  if (typeof clase !== "string" || !esClaseDeFoto(clase)) return NextResponse.json({ error: "bad request" }, { status: 400 });
  if (!(archivo instanceof File) || archivo.size === 0) return NextResponse.json({ error: "file" }, { status: 400 });
  if (archivo.size > TAMANO_MAX_FOTO) return NextResponse.json({ error: "too-big" }, { status: 413 });
  const ext = extensionDeFoto(archivo.type);
  if (!ext) return NextResponse.json({ error: "type" }, { status: 415 });

  const bytes = new Uint8Array(await archivo.arrayBuffer());
  if (!esFirmaDeImagen(bytes, archivo.type)) return NextResponse.json({ error: "type" }, { status: 415 });

  const admin = createAdminClient();
  const { data: fila, error: errorFila } = await admin
    .from("business_cards").select("id, active").eq("edit_token", token).maybeSingle();
  if (errorFila) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  if (!fila || !fila.active) return NextResponse.json({ error: "link" }, { status: 404 });

  const ruta = rutaDeFoto(fila.id as string, clase, ext, Date.now());
  const subida = await admin.storage.from(BUCKET_DE_TARJETAS).upload(ruta, bytes, { contentType: archivo.type, upsert: false, cacheControl: "3600" });
  if (subida.error) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const { data, error } = await clienteAnonimo().rpc("business_card_set_media", {
    p_token: token,
    p_photo_path: clase === "foto" ? ruta : null,
    p_cover_path: clase === "portada" ? ruta : null,
  });
  if (error || data !== true) {
    await admin.storage.from(BUCKET_DE_TARJETAS).remove([ruta]);
    return NextResponse.json({ error: "link" }, { status: error ? 503 : 404 });
  }
  return NextResponse.json({ ok: true, url: urlPublicaDeFoto(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", ruta) });
}
