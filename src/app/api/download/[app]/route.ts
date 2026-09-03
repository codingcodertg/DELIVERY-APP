import { NextResponse } from "next/server";

// ============================================================
// Descarga de las apps que se instalan (D-168).
//
// El hub enlaza aquí en vez de a un fichero concreto, y el motivo es que **el nombre del
// instalador lleva la versión dentro** (`TimeTracker-Setup-0.0.45.exe`). Un enlace fijo a
// ese nombre funciona hoy y da un 404 en la siguiente publicación — y da igual que sea un
// 404: lo que ve la persona es que la app de la empresa no se puede descargar, y no tiene
// forma de saber que solo hay que cambiar un número.
//
// Así que aquí se le pregunta a GitHub cuál es la última y se redirige a ella. La lista de
// versiones vive en un solo sitio (el repositorio que publica), que es donde ya estaba.
//
// **Con respaldo, no a ciegas.** Si GitHub no contesta —su API sin credenciales permite 60
// peticiones por hora y por IP, y las de Vercel son compartidas— se redirige a la página de
// publicaciones del repositorio. Un clic de más es mucho mejor que un error.
// ============================================================

export const runtime = "nodejs";

type Fuente = {
  repo: string;
  /** Cómo se reconoce el instalador entre los otros activos (hay .yml y .blockmap al lado). */
  esElInstalador: (nombre: string) => boolean;
};

const FUENTES: Record<string, Fuente> = {
  // La ventana del hub para Windows (D-166).
  hub: {
    repo: "codingcodertg/DELIVERY-APP",
    esElInstalador: (n) => n.startsWith("RDZ-Hub-Setup") && n.endsWith(".exe"),
  },
  // El cliente de escritorio de Time Tracker, que vive en su propio repositorio y publica
  // ahí desde antes de todo esto. No se toca: solo se lee cuál es la última.
  timetracker: {
    repo: "codingcodertg/timetracker",
    esElInstalador: (n) => n.startsWith("TimeTracker-Setup") && n.endsWith(".exe"),
  },
};

export async function GET(_req: Request, ctx: { params: Promise<{ app: string }> }) {
  const { app } = await ctx.params;
  const fuente = FUENTES[app];
  if (!fuente) return NextResponse.json({ error: "unknown app" }, { status: 404 });

  const pagina = `https://github.com/${fuente.repo}/releases/latest`;

  try {
    const r = await fetch(`https://api.github.com/repos/${fuente.repo}/releases/latest`, {
      headers: { "User-Agent": "rdz-hub", Accept: "application/vnd.github+json" },
      // Se cachea una hora. Sin esto, cada persona que abre el hub gasta una petición del
      // cupo de sesenta por hora, y el día que veinte personas descarguen a la vez el cupo
      // se acaba para todos los demás.
      next: { revalidate: 3600 },
    });
    if (!r.ok) return NextResponse.redirect(pagina, 302);

    const rel = (await r.json()) as { assets?: { name: string; browser_download_url: string }[] };
    const activo = (rel.assets ?? []).find((a) => fuente.esElInstalador(a.name));
    return NextResponse.redirect(activo?.browser_download_url ?? pagina, 302);
  } catch {
    return NextResponse.redirect(pagina, 302);
  }
}
