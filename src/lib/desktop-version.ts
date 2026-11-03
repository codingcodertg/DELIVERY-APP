// ============================================================
// La app de escritorio instalada y la que toca tener (D-813).
//
// La app pone `RTGHub/<versión>` al final de su agente de usuario (desde D-225). La web lo mira para UNA cosa: si la
// instalada es más vieja que `ESCRITORIO_MINIMO`, enseña «hay versión nueva» con el botón que baja el instalador.
// Hace falta porque la 1.1.1 (la que está en las tiendas) no lleva `electron-updater` (D-811): nadie puede mandarle
// nada desde fuera, pero sí carga esta web, y la web sí puede pedirle a la persona un clic. Desde la 1.2.1 ya no hace
// falta: se actualiza sola.
// ============================================================

/** La versión a partir de la cual la app se actualiza sola. Subirla aquí vuelve a enseñar el aviso a todo lo anterior. */
export const ESCRITORIO_MINIMO = "1.2.1";

/** El fichero que se baja. El nombre lleva la versión para que el navegador no reuse una descarga vieja. */
export const INSTALADOR_ESCRITORIO = `RTG-Hub-Setup-${ESCRITORIO_MINIMO}.exe`;

/** La versión que dice el agente, o null si no es la app de escritorio. */
export function versionDeEscritorio(userAgent: string | null | undefined): string | null {
  const m = /\bRTGHub\/(\d+\.\d+\.\d+)\b/.exec(userAgent ?? "");
  return m ? m[1] : null;
}

/** a < b, comparando número a número («1.2.0» < «1.10.0»). */
export function versionMenor(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

/** Si este agente es la app de escritorio Y es más vieja que la mínima. Un navegador nunca lo es. */
export function escritorioDesactualizado(userAgent: string | null | undefined, minimo = ESCRITORIO_MINIMO): boolean {
  const v = versionDeEscritorio(userAgent);
  return v !== null && versionMenor(v, minimo);
}
