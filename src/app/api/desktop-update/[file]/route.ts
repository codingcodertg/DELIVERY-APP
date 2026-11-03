import { NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { createClient } from "@/lib/supabase/server";
import { CABECERA_DISPOSITIVO, idDeDispositivoValido } from "@/lib/security/reglas";

// ============================================================
// Lo que la app de escritorio pregunta para actualizarse sola (D-811).
//
// `electron-updater` (proveedor «generic») pide `latest.yml` y, si la versión de ahí es más nueva que la instalada,
// el instalador que ese fichero nombra. Los dos viven en el mismo almacén privado de Blob que ya sirve
// `/api/download/hub` (D-170), con nombre ESTABLE:
//
//   apps/latest.yml           ← lo escribe electron-builder al compilar (versión, nombre del .exe, sha512, tamaño)
//   apps/RTG-Hub-Setup.exe    ← el instalador de esa misma compilación
//
// Se suben juntos con `scripts/publica-desktop.mjs`. Si no van juntos, el sha512 del yml no cuadra con el exe y la
// app descarta la descarga (es una comprobación de electron-updater, no nuestra): nunca instala algo distinto de lo
// que el yml prometió.
//
// QUIÉN PUEDE PEDIRLO. La app no tiene la sesión del hub en su proceso principal, así que no puede pasar por el login
// de `/api/download`. Lo que sí lleva es su cabecera de identidad (`x-rtg-device`, la misma de Security). Se acepta
// esa cabecera o una sesión. No es un secreto —el instalador estuvo en un repositorio público hasta D-170— pero
// convierte la URL en algo que no sirve pegada en un chat de fuera, que es lo que D-170 quería.
//
// `.blockmap` (la descarga diferencial) no se sirve: 404, y electron-updater baja el instalador entero. Es lo
// documentado y es lo que pasa hoy con cada publicación nueva.
// ============================================================

export const runtime = "nodejs";
export const maxDuration = 300;

const FICHEROS: Record<string, { blob: string; tipo: string }> = {
  "latest.yml": { blob: "apps/latest.yml", tipo: "text/yaml; charset=utf-8" },
};
const ES_INSTALADOR = /^RTG-Hub-Setup-[\w.-]+\.exe$/;

export async function GET(req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const fuente = FICHEROS[file] ?? (ES_INSTALADOR.test(file) ? { blob: "apps/RTG-Hub-Setup.exe", tipo: "application/octet-stream" } : null);
  if (!fuente) return NextResponse.json({ error: "unknown file" }, { status: 404 });

  // D-813: el aviso de «versión nueva» abre el instalador en el navegador del sistema, que no tiene la sesión ni la
  // cabecera; lleva el id del dispositivo en `?d=`. Vale lo mismo que la cabecera: no es un secreto, es lo que hace que
  // la URL no sirva pegada en un chat de fuera (D-170).
  const cabecera = req.headers.get(CABECERA_DISPOSITIVO) ?? new URL(req.url).searchParams.get("d");
  if (!idDeDispositivoValido(cabecera)) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  try {
    const r = await get(fuente.blob, { access: "private" });
    if (!r || r.statusCode !== 200 || !r.stream) return NextResponse.json({ error: "not published" }, { status: 404 });
    return new NextResponse(r.stream as unknown as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": fuente.tipo,
        "Cache-Control": "no-store",
        ...(file === "latest.yml" ? {} : { "Content-Disposition": `attachment; filename="${file}"` }),
      },
    });
  } catch {
    return NextResponse.json({ error: "store unavailable" }, { status: 503 });
  }
}
