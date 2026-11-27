// =====================================================================================================================
// Avisos del respaldo (D-1205, auditoría 2026-11-27). El 26 nov el respaldo quedó a medias y el 27 no corrió, y nadie
// se enteró. Ahora:
//   · si una corrida falla (o baja archivos con fallas), sale un aviso en Windows Y queda una falla en el hub
//     (Administración → «Fallas de la app», app «respaldo»), vía public.registrar_falla (migración 352);
//   · `respaldo.mjs --revisa` (lo corre la tarea al iniciar sesión) mira el registro: si el último OK tiene más de
//     26 horas, avisa igual.
// Lo único que se escribe en Supabase es esa falla, con la llave de servicio, y solo cuando algo salió mal.
// =====================================================================================================================
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

/** Horas sin respaldo bueno pasadas las cuales se avisa (un día y un margen para que la tarea arranque tarde). */
export const HORAS_SIN_RESPALDO = 26;

/** La fecha del último «OK» del registro (una línea por corrida: `<ISO> OK …` o `<ISO> ERROR …`), o null si no hay. */
export function ultimoOk(registro) {
  let ultimo = null;
  for (const linea of String(registro ?? "").split(/\r?\n/)) {
    const m = linea.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z) OK\b/);
    if (m) { const t = Date.parse(m[1]); if (!Number.isNaN(t) && (ultimo === null || t > ultimo)) ultimo = t; }
  }
  return ultimo === null ? null : new Date(ultimo);
}

/** ¿Hay que avisar? Devuelve el texto del aviso, o null si el último respaldo bueno es reciente. */
export function motivoDeAviso(registro, ahora = new Date()) {
  const ok = ultimoOk(registro);
  if (!ok) return "No hay ningún respaldo bueno en el registro.";
  const horas = (ahora.getTime() - ok.getTime()) / 3_600_000;
  if (horas <= HORAS_SIN_RESPALDO) return null;
  return `El último respaldo bueno es de hace ${Math.floor(horas)} horas (${ok.toISOString().slice(0, 16).replace("T", " ")} UTC).`;
}

/** Huella de 16 hex que pide registrar_falla (misma falla = misma huella, así se agrupan). */
export function huella(texto) {
  return createHash("sha256").update(`cron|respaldo|${texto}`).digest("hex").slice(0, 16);
}

/** Aviso en la pantalla de Windows (un cuadro de mensaje que no bloquea al script). Si no se puede, no pasa nada. */
export function avisoEnWindows(texto) {
  if (process.platform !== "win32") return;
  try {
    const p = spawn("msg", ["*", "/TIME:0", `Respaldo del hub: ${texto}`], { stdio: "ignore", detached: true });
    p.on("error", () => {});
    p.unref();
  } catch { /* sin aviso de pantalla; queda el del hub */ }
}

/** Deja la falla en el hub. `cliente` es un cliente de Supabase con la llave de servicio. Nunca lanza. */
export async function avisoEnElHub(cliente, texto) {
  if (!cliente) return false;
  try {
    const primera = String(texto).split("\n")[0].slice(0, 300);
    const { error } = await cliente.rpc("registrar_falla", {
      p_origen: "cron", p_app: "respaldo", p_ruta: "scripts/respaldo/respaldo.mjs", p_mensaje: String(texto).slice(0, 2000),
      p_pila: null, p_componente: null, p_rol: null, p_version: null, p_navegador: null, p_escritorio: true,
      p_huella: huella(primera.replace(/\d+/g, "#")),
    });
    return !error;
  } catch {
    return false;
  }
}
