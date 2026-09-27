/**
 * 🔒 Rutas bloqueadas del Gestor de Rutas (D-NEXT): una ruta (un chofer o una ruta temporal) en un DÍA que las
 * herramientas automáticas no tocan — «Optimizar todas las rutas», su «Optimizar ruta», «Simular», el dibujo automático
 * al elegir un chofer, «✨ Auto-asignar» y «📍 Mejor lugar». Es el `lockType: ROUTES` de OptimoRoute
 * (docs/research-route-optimization.md §1.3). A mano sigue editable: flechas, «Asignar», quitar, mover de viaje.
 *
 * **Dónde vive: en ESTE navegador, por persona.** No hay en la base ningún sitio por ruta y día que logística pueda
 * escribir sin migración: `settings` la escribe solo el admin (130), `user_prefs` solo admite las claves de su lista
 * (136) y es de cada persona, `route_plans` son fotos de un plan con su guarda, y `driver_availability` significa «no
 * disponible» (usarla haría que el chofer saliera «no disponible» en el recuadro y en Auto-asignar). Lo que el equipo
 * entero vea necesita una tabla o una columna nueva: queda pedida, no escrita (hay otra migración en curso).
 *
 * Forma: `{ "<fecha>": ["<clave de ruta>", …] }` bajo `rtg_rutas_bloqueadas`. Se olvida lo de hace más de 14 días.
 */

export const LLAVE_DE_BLOQUEOS = "rtg_rutas_bloqueadas";
const DIAS_QUE_SE_GUARDAN = 14;

export type Bloqueos = Record<string, string[]>;

interface Almacen { getItem(k: string): string | null; setItem(k: string, v: string): void }

export function leeBloqueos(almacen: Almacen | null | undefined): Bloqueos {
  try {
    const crudo = almacen?.getItem(LLAVE_DE_BLOQUEOS);
    if (!crudo) return {};
    const v = JSON.parse(crudo) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Bloqueos = {};
    for (const [fecha, lista] of Object.entries(v as Record<string, unknown>)) {
      if (Array.isArray(lista)) out[fecha] = lista.filter((x): x is string => typeof x === "string");
    }
    return out;
  } catch {
    return {};
  }
}

export const estaBloqueada = (b: Bloqueos, fecha: string, ruta: string): boolean => (b[fecha] ?? []).includes(ruta);

/** Pone o quita el candado de una ruta en un día. Devuelve una copia; lo de más de 14 días antes de `hoy` se olvida. */
export function alternaBloqueo(b: Bloqueos, fecha: string, ruta: string, hoy: string): Bloqueos {
  const lista = b[fecha] ?? [];
  const nueva = lista.includes(ruta) ? lista.filter((x) => x !== ruta) : [...lista, ruta];
  const limite = new Date(`${hoy}T00:00:00Z`).getTime() - DIAS_QUE_SE_GUARDAN * 86_400_000;
  const out: Bloqueos = {};
  for (const [f, l] of Object.entries({ ...b, [fecha]: nueva })) {
    const t = new Date(`${f}T00:00:00Z`).getTime();
    if (l.length && (!Number.isFinite(t) || t >= limite)) out[f] = l;
  }
  return out;
}

export function guardaBloqueos(almacen: Almacen | null | undefined, b: Bloqueos): void {
  try { almacen?.setItem(LLAVE_DE_BLOQUEOS, JSON.stringify(b)); } catch { /* navegador sin almacén: el candado dura la visita */ }
}

/**
 * El bucle de optimizar varias rutas, sin las bloqueadas: la bloqueada NO se pide (ni una llamada al optimizador, que es
 * Google, de pago). Devuelve las que salieron bien —lo que ya devolvía `optimizaEstas` (D-401)—, las que se saltó por el
 * candado y las que fallaron. `optimizaUna` y `pausa` las pone quien llama (la pantalla: `computeRoute` + `applyPlan`,
 * y 400 ms entre una y otra).
 */
export async function optimizaSinLasBloqueadas<R extends { clave: string }>(args: {
  rutas: readonly R[];
  bloqueada: (clave: string) => boolean;
  optimizaUna: (r: R) => Promise<void>;
  alFallar?: (e: unknown) => void;
  pausa?: () => Promise<void>;
}): Promise<{ bien: string[]; saltadas: string[]; fallidas: string[] }> {
  const bien: string[] = [], saltadas: string[] = [], fallidas: string[] = [];
  for (const r of args.rutas) {
    if (args.bloqueada(r.clave)) { saltadas.push(r.clave); continue; }
    try {
      await args.optimizaUna(r);
      bien.push(r.clave);
    } catch (e) {
      fallidas.push(r.clave);
      args.alFallar?.(e);
    }
    if (args.pausa) await args.pausa();
  }
  return { bien, saltadas, fallidas };
}

/** «Se saltó N ruta(s) bloqueada(s): …», o nada si no se saltó ninguna. */
export function avisoDeSaltadas(saltadas: readonly string[]): { en: string; es: string } | null {
  if (!saltadas.length) return null;
  const quienes = saltadas.join(", ");
  return {
    en: `Skipped ${saltadas.length} locked route(s) 🔒: ${quienes}.`,
    es: `Se saltó ${saltadas.length} ruta(s) bloqueada(s) 🔒: ${quienes}.`,
  };
}
