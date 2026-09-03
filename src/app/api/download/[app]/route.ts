import { NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { createClient } from "@/lib/supabase/server";

// ============================================================
// Descarga de las apps que se instalan (D-168, movidas a Blob en D-170).
//
// El hub enlaza aquí y no a un fichero, por dos motivos distintos.
//
// **1. El nombre del instalador lleva la versión dentro** (`TimeTracker-Setup-0.0.45.exe`).
// Un enlace fijo funciona hoy y da 404 en la siguiente publicación — y da igual que sea un
// 404: lo que ve la persona es que la app de la empresa no se descarga, y no tiene forma de
// saber que solo había que cambiar un número.
//
// **2. Los instaladores no deberían ser públicos.** Estaban en un repositorio público de
// GitHub porque el almacenamiento de Supabase corta en 50 MB (plan gratuito) y pesan 78, así
// que se los podía bajar cualquiera. Ahora viven en un almacén **privado** de Vercel Blob y
// se sirven **a través de aquí**, comprobando la sesión: solo los descarga quien puede entrar.
//
// ---------------------------------------------------------------------------
// Con respaldo, y esa es la parte importante
// ---------------------------------------------------------------------------
// Si el almacén no está configurado —o falla— se redirige a GitHub, como antes. Esto no es
// pereza: es que hubo un rato entre "la ruta ya sirve desde Blob" y "los ficheros están
// subidos", y durante ese rato la descarga tenía que seguir funcionando. Y sigue valiendo
// para el día que Blob esté caído: una descarga por el camino largo es mejor que un error.
// ============================================================

export const runtime = "nodejs";
// Se transmite un fichero de 78 MB: la respuesta no cabe en la ventana por defecto.
export const maxDuration = 300;

type Fuente = {
  /** Dónde vive en el almacén privado. Nombre ESTABLE, sin versión: la versión la lleva
   *  dentro el instalador, y una URL que cambia con cada publicación es la que se rompe. */
  blob: string;
  /** Cómo se llama el fichero al guardarlo. */
  descarga: string;
  /** El respaldo público, por si el almacén no está o falla. */
  repo: string;
  esElInstalador: (nombre: string) => boolean;
};

const FUENTES: Record<string, Fuente> = {
  hub: {
    blob: "apps/RDZ-Hub-Setup.exe",
    descarga: "RDZ-Hub-Setup.exe",
    repo: "codingcodertg/DELIVERY-APP",
    esElInstalador: (n) => n.startsWith("RDZ-Hub-Setup") && n.endsWith(".exe"),
  },
  timetracker: {
    blob: "apps/TimeTracker-Setup.exe",
    descarga: "TimeTracker-Setup.exe",
    repo: "codingcodertg/timetracker",
    esElInstalador: (n) => n.startsWith("TimeTracker-Setup") && n.endsWith(".exe"),
  },
};

/** El respaldo: la última publicación del repositorio, o su página si GitHub no contesta. */
async function porGitHub(f: Fuente) {
  const pagina = `https://github.com/${f.repo}/releases/latest`;
  try {
    const r = await fetch(`https://api.github.com/repos/${f.repo}/releases/latest`, {
      headers: { "User-Agent": "rdz-hub", Accept: "application/vnd.github+json" },
      // Una hora. Sin esto, cada persona que descarga gasta una petición del cupo de sesenta
      // por hora de la API sin credenciales, y las IP de Vercel son compartidas.
      next: { revalidate: 3600 },
    });
    if (!r.ok) return NextResponse.redirect(pagina, 302);
    const rel = (await r.json()) as { assets?: { name: string; browser_download_url: string }[] };
    const activo = (rel.assets ?? []).find((a) => f.esElInstalador(a.name));
    return NextResponse.redirect(activo?.browser_download_url ?? pagina, 302);
  } catch {
    return NextResponse.redirect(pagina, 302);
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ app: string }> }) {
  const { app } = await ctx.params;
  const f = FUENTES[app];
  if (!f) return NextResponse.json({ error: "unknown app" }, { status: 404 });

  // Quien no ha entrado no descarga. El enlace sale del hub, que ya está detrás del login,
  // así que esto no le estorba a nadie — pero convierte la URL en algo que no sirve pegada
  // en un chat de fuera.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL(`/login?next=/home`, _req.url), 302);
  }

  try {
    // `get()` del SDK, no un `fetch` a la URL del fichero.
    //
    // Esto costó una prueba: en un almacén PRIVADO, la `downloadUrl` que devuelve `head()`
    // contesta **403 Forbidden** a secas. La URL no es la credencial — el fichero solo sale
    // autenticado, y eso es precisamente lo que se buscaba al hacerlo privado. Se vio porque
    // la comprobación miraba los dos primeros bytes esperando "MZ" (todo .exe de Windows
    // empieza así) y lo que llegaba era la palabra "Forbidden".
    //
    // `access: "private"` es obligatorio aquí: sin él el SDK ni lo intenta.
    // `get()` devuelve null si el fichero no está — de ahí el respaldo.
    const r = await get(f.blob, { access: "private" });
    if (!r || r.statusCode !== 200 || !r.stream) return porGitHub(f);

    // Se transmite tal cual llega, sin juntarlo en memoria: 78 MB en la memoria de una
    // función es la forma de tirarla, y además la descarga empieza al instante en vez de
    // después de que el servidor haya leído el fichero entero.
    return new NextResponse(r.stream, {
      headers: {
        "Content-Type": "application/octet-stream",
        ...(r.blob?.size ? { "Content-Length": String(r.blob.size) } : {}),
        // `attachment` para que el navegador lo GUARDE en vez de intentar abrirlo, y con el
        // nombre limpio: lo que se descarga tiene que llamarse como la app, no como la ruta.
        "Content-Disposition": `attachment; filename="${f.descarga}"`,
        // Privado y por sesión: que no se quede en una caché compartida.
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  } catch {
    return porGitHub(f);
  }
}
