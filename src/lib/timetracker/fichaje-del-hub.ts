// ============================================================
// Fichar desde el HUB, en la app de escritorio (2026-11-25). Parte pura, sin React ni Supabase.
//
// El dueño: «que cuando abran el Hub haya un ícono verde o rojo; al entrar dice "¿Quieres fichar?" y lo
// aprietan ahí en vez de ir a la app de Time Tracker». Las reglas que aquí viven (la pantalla y el servidor
// las llaman; ninguno decide por su cuenta):
//  · Estados: fuera (no ha fichado), en_turno (fichado) y en_break (el almuerzo, «Take a break»).
//  · Qué acción vale en cada estado (`accionesValidas`, `siguienteEstado`).
//  · Quién ve el botón (`seVeElBoton`): solo en la app de escritorio, a quien tiene el interruptor, nunca
//    mientras un admin «ve como» a otra persona, y solo en pantallas de al menos 700 px.
//  · Lo que se lee del servidor: si falla la lectura se conserva lo último que se supo (`reconciliaLectura`);
//    nunca se bloquea ni se desbloquea por una lectura fallida.
//  · Textos de tiempo: el saludo por hora de Texas, «3 h 12 min» y el cronómetro «00:14:27».
// ============================================================

import { formateadorDeFecha } from "@/lib/formateador";
import { effWorkerType } from "@/lib/timetracker/helpers";

export type EstadoDelHub = "fuera" | "en_turno" | "en_break";
export type AccionDelHub = "entrar" | "empezar_break" | "volver_del_break" | "terminar_turno";

/** Lo que el servidor contesta sobre la persona que mira (`estadoDelHub`). `uid` es para la memoria de la tienda del día. */
export type DatosDelHub = {
  sesion: boolean;
  activo: boolean;
  estado: EstadoDelHub;
  /** Hora de entrada (en_turno) o de inicio del almuerzo (en_break), ISO. */
  desde: string | null;
  nombre: string;
  uid: string;
  /** Solo quien va en varias tiendas (350): la lista para el desplegable. */
  multiTienda: boolean;
  tiendas: { id: string; name: string }[];
  /** La tienda de la entrada abierta, si la hay. */
  tiendaDeHoy: string | null;
};

/** Zona de Brownsville (Texas): la misma que usa el resto del Time Tracker. */
export const ZONA_DEL_HUB = "America/Chicago";
/** Por encima de la barra de arriba, la burbuja de Ayuda y cualquier ventana de la app. */
export const Z_BLOQUEO_DEL_HUB = 100000;
/** Por debajo de este ancho el componente no se monta (es solo de escritorio). */
export const ANCHO_MINIMO_DEL_HUB = 700;

const ORDEN_DE_ACCIONES: AccionDelHub[] = ["entrar", "empezar_break", "volver_del_break", "terminar_turno"];

/**
 * El estado siguiente si la acción vale en ese estado, o null si no vale.
 *  · fuera → entrar → en_turno
 *  · en_turno → empezar_break → en_break; en_break → volver_del_break → en_turno
 *  · en_turno y en_break → terminar_turno → fuera (en_break: se cierra el almuerzo antes, en el servidor)
 */
export function siguienteEstado(estado: EstadoDelHub, accion: AccionDelHub): EstadoDelHub | null {
  switch (accion) {
    case "entrar": return estado === "fuera" ? "en_turno" : null;
    case "empezar_break": return estado === "en_turno" ? "en_break" : null;
    case "volver_del_break": return estado === "en_break" ? "en_turno" : null;
    case "terminar_turno": return estado === "fuera" ? null : "fuera";
  }
}

/** Las acciones que tienen sentido en ese estado, en el orden de los botones. */
export function accionesValidas(estado: EstadoDelHub): AccionDelHub[] {
  return ORDEN_DE_ACCIONES.filter((a) => siguienteEstado(estado, a) !== null);
}

/**
 * ¿Se ve el botón del hub? Solo en la app de escritorio, con el interruptor de la persona puesto, sin un admin
 * «viendo como» a otra persona (nunca se ficha por otro), y en una pantalla de al menos 700 px.
 */
export function seVeElBoton(args: { escritorio: boolean; activo: boolean; viendoComo: boolean; ancho: number }): boolean {
  return args.escritorio && args.activo && !args.viendoComo && args.ancho >= ANCHO_MINIMO_DEL_HUB;
}

/** ¿Está la app en modo demo del hub de escritorio? Solo con modo local Y la variable de la demo (las dos
 *  booleanas las pasa quien llama leyendo `process.env.NEXT_PUBLIC_*` literal, para que Next las incruste). */
export function demoDelHub(modoLocal: boolean, demo: boolean): boolean {
  return modoLocal && demo;
}

/**
 * Lo que la pantalla hace con una lectura del servidor. Si la lectura falla (`ok: false`), se conserva lo último
 * que se supo, y si nunca se supo nada, nada. Así una lectura caída nunca bloquea ni desbloquea a nadie.
 */
export function reconciliaLectura(
  anterior: DatosDelHub | null,
  lectura: { ok: true; datos: DatosDelHub } | { ok: false },
): DatosDelHub | null {
  return lectura.ok ? lectura.datos : anterior;
}

/** Por qué el servidor NO deja fichar desde el hub (para el registro y las pruebas). */
export type CausaDeNoActivo = "error_de_lectura" | "sin_ajustes" | "sin_columna" | "interruptor_apagado" | "inactiva" | "no_presencial";

/**
 * La decisión del SERVIDOR (hub.ts) de si una persona puede fichar desde el hub. Cierra por defecto: si la lectura
 * falló, si no hay fila de ajustes, si la base aún no tiene la columna (351 sin aplicar), si el interruptor está
 * apagado, si la persona no está activa o no es presencial, se niega. Solo pasa con todo a favor.
 */
export function puedeFicharDesdeElHub(q: {
  /** La lectura de la base falló. */
  error: boolean;
  /** La fila de employee_settings de la persona; null si no tiene fila. */
  ajustes: { tipo: string | null; activa: boolean; hubClock: boolean } | null;
  /** ¿La base tiene la columna hub_clock (351 aplicada)? */
  columnaDisponible: boolean;
}): { ok: true } | { ok: false; causa: CausaDeNoActivo } {
  if (q.error) return { ok: false, causa: "error_de_lectura" };
  if (!q.ajustes) return { ok: false, causa: "sin_ajustes" };
  if (!q.columnaDisponible) return { ok: false, causa: "sin_columna" };
  if (!q.ajustes.hubClock) return { ok: false, causa: "interruptor_apagado" };
  if (!q.ajustes.activa) return { ok: false, causa: "inactiva" };
  if (effWorkerType({ workerType: q.ajustes.tipo }) !== "inhouse") return { ok: false, causa: "no_presencial" };
  return { ok: true };
}

/** Qué hace el bloqueo con una tecla. Escape NO cierra el bloqueo (es un descanso, no un menú); Tab se queda dentro. */
export function accionDeTeclaEnBloqueo(tecla: string): "atrapar_foco" | "ignorar" {
  return tecla === "Tab" ? "atrapar_foco" : "ignorar";
}

// --- Tiempo ----------------------------------------------------------------

/** La hora (0-23) de un instante, en la zona de Texas. */
export function horaDeTexas(fecha: Date): number {
  const h = formateadorDeFecha("en-US", { hour: "numeric", hour12: false, timeZone: ZONA_DEL_HUB }).format(fecha);
  return Number(h) % 24;
}

/** La fecha de hoy en Texas, como YYYY-MM-DD (la clave de la tienda del día). */
export function fechaDeTexas(fecha: Date): string {
  const partes = formateadorDeFecha("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: ZONA_DEL_HUB }).format(fecha);
  return partes;
}

/** El saludo: mañana (antes de las 12), tarde (antes de las 18) y noche. Por hora de Texas. */
export function saludoDe(hora: number): "manana" | "tarde" | "noche" {
  if (hora < 12) return "manana";
  if (hora < 18) return "tarde";
  return "noche";
}

/** «8:02 AM» (o «8:02 a. m.» no: el mismo formato en los dos idiomas), en hora de Texas. */
export function horaCorta(iso: string, lang: "en" | "es"): string {
  return formateadorDeFecha(lang === "es" ? "es-MX" : "en-US", {
    hour: "numeric", minute: "2-digit", timeZone: ZONA_DEL_HUB,
  }).format(new Date(iso));
}

/** «3 h 12 min», «12 min» o «0 min». Un tiempo negativo (reloj de otra máquina) cuenta como cero. */
export function formatoTranscurrido(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return `${h} h ${m} min`;
}

/** El cronómetro del almuerzo: «00:14:27» (las horas pueden pasar de 99 sin romper el formato). */
export function formatoCronometro(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${dos(h)}:${dos(m)}:${dos(s)}`;
}

/** La tienda que se recuerda para la jornada: la de hoy si hay una entrada abierta; si no, la del último uso hoy. */
export function tiendaPorDefecto(args: {
  tiendaDeHoy: string | null;
  recordada: string | null;
  tiendas: { id: string }[];
}): string | null {
  const existe = (id: string | null) => !!id && args.tiendas.some((t) => t.id === id);
  if (existe(args.tiendaDeHoy)) return args.tiendaDeHoy;
  if (existe(args.recordada)) return args.recordada;
  return args.tiendas[0]?.id ?? null;
}
