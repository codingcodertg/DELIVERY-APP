import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { faltaLaTabla } from "@/lib/estimator/almacen";
import { CUBO_DE_COMPETENCIA } from "@/lib/estimator/competencia";
import { leerCompetencia, type ArchivoALeer } from "@/lib/estimator/lectura-servidor";

// ============================================================
// POST /api/estimator/leer-competencia  { fileId }
//
// Lee con Claude (visión) un estimado de la competencia YA subido al cubo privado (D-425, D-451) y devuelve la
// empresa, la fecha, el número, los productos y los totales. No guarda nada: la pantalla enseña lo leído en una
// tabla, el vendedor lo corrige y lo guarda él con su sesión (migración 161).
//
// Quién: sesión (D-172) + el módulo `estimator` + ser quien subió el archivo o admin. La fila del archivo se lee con
// la SESIÓN (su RLS decide si existe para quien pregunta); solo los BYTES se bajan con la llave de servicio, y la
// ruta dentro del cubo sale de esa fila, nunca del cliente.
//
// Sin `ANTHROPIC_API_KEY` contesta 503 `sin-llave` y la pantalla deja teclear a mano. Sin la migración 161, 503
// `sin-161`. Toda la lógica (topes, páginas, la llamada, el registro) está en `lib/estimator/lectura-servidor.ts`,
// probada con todo falso: aquí solo se cablea.
// ============================================================

export const runtime = "nodejs";
export const maxDuration = 120;

const TABLA_DE_REGISTRO = "estimator_competitor_reads";

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  let body: { fileId?: unknown };
  try {
    body = (await req.json()) as { fileId?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // La llave de servicio se pide tarde y una sola vez: sin ella la ruta dice qué falta en vez de reventar.
  let admin: ReturnType<typeof createAdminClient> | null = null;
  const servicio = () => (admin ??= createAdminClient());

  try {
    const r = await leerCompetencia(body.fileId, {
      env: {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        COMPETENCIA_LECTURAS_DIA: process.env.COMPETENCIA_LECTURAS_DIA,
        COMPETENCIA_MODELO: process.env.COMPETENCIA_MODELO,
      },
      usuario: { id: auth.user.id },
      async perfil() {
        const { data } = await auth.supabase.from("profiles").select("role, module_access, full_name").eq("id", auth.user.id).maybeSingle();
        return data ? { role: data.role ?? null, module_access: data.module_access ?? null, full_name: data.full_name ?? null } : null;
      },
      async archivo(fileId) {
        const { data } = await auth.supabase
          .from("estimator_competitor_files").select("id, path, file_name, mime_type, size_bytes, uploaded_by").eq("id", fileId).maybeSingle();
        return (data as ArchivoALeer | null) ?? null;
      },
      async lecturasDesde(desde) {
        const { count, error } = await servicio()
          .from(TABLA_DE_REGISTRO).select("id", { count: "exact", head: true }).gte("read_at", desde.toISOString());
        if (error) {
          if (faltaLaTabla(error)) return "sin-tabla";
          throw new Error(error.message);
        }
        return count ?? 0;
      },
      async descargar(path) {
        const { data, error } = await servicio().storage.from(CUBO_DE_COMPETENCIA).download(path);
        if (error || !data) return null;
        return new Uint8Array(await data.arrayBuffer());
      },
      async registrar(fila) {
        const { data, error } = await servicio().from(TABLA_DE_REGISTRO).insert(fila).select("id");
        if (error) return null;
        return ((data as { id: string }[] | null)?.[0]?.id) ?? null;
      },
      async cerrar(id, fin) {
        await servicio().from(TABLA_DE_REGISTRO).update(fin).eq("id", id);
      },
      pedir: fetch,
      ahora: () => new Date(),
    });
    return NextResponse.json(r.cuerpo, { status: r.status });
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: mensaje, codigo: "proveedor" }, { status: 500 });
  }
}
