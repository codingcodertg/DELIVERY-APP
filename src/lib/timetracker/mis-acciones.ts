// ============================================================
// «Mis acciones ▾»: las acciones personales de fichar del ADMIN, en un desplegable (D-NEXT).
//
// El dueño, el 2026-10-11: «IN THE CLOCK IN THE PERSONAL ACTIONS BUTTOMS FOR THE ADMIN GOES INTO A
// DROPDOWN». En «Registrar tiempo › ⏰ Fichar» el admin ve SU tarjeta de fichar, con los mismos
// botones que el empleado: Registrar entrada / salida, Empezar almuerzo, Voy a salir, y durante una
// visita Tomar foto y Ya volví. Para el admin esos botones pasan a un solo «Mis acciones ▾»; el
// empleado y el gerente siguen con sus botones de siempre.
//
// Aquí, puro y sin React, lo que decide la pantalla (`PunchPanel`):
//   · `accionesEnMenu` — a quién le salen en el desplegable (solo al admin).
//   · `accionesPersonales` — QUÉ acciones hay ahora mismo. Son exactamente los botones que la tarjeta
//     pinta hoy, con las mismas condiciones (la prueba lo compara con las condiciones del JSX en
//     todas las combinaciones). Lo único que cambia es el orden: primero las del día, y registrar
//     la salida al final, en rojo y tras una raya, como el botón rojo que era.
//   · `textoDeAccion` — el texto de cada opción: la MISMA clave del botón, con su icono y su hora.
//   · `estadoDelFichaje` — lo que se ve sin abrir el menú. «Terminar almuerzo · 12:00» era a la vez
//     botón y estado; dentro del menú el estado se perdería, así que la pastilla de la tarjeta lo
//     dice: trabajando, almorzando, fuera o de viaje, y desde qué hora.
//
// Qué HACE cada acción no se decide aquí: la pantalla enchufa cada una a la misma función que usa
// el botón del empleado (`hacer`, un Record que no compila si falta una).
// ============================================================

import { filaDeSalida, seCierraDeUnToque } from "@/lib/clockin/visitas";
import { esAdminDeTt } from "@/lib/timetracker/vista-empleado";

/** Cada botón de la tarjeta de fichar, con nombre. */
export type AccionPersonal =
  | "entrar"            // Registrar entrada
  | "salir"             // Registrar salida
  | "terminarDescanso"  // Terminar almuerzo · 12:00 / Ya volví · 12:00 (una salida abierta)
  | "foto"              // 📷 Tomar foto (durante una visita)
  | "yaVolvi"           // Ya volví · 12:00 (cierra una visita personal de un toque)
  | "almuerzo"          // 🍽 Empezar almuerzo
  | "voySalir";         // 🚚 Voy a salir (abre la ventana que pregunta)

export const ACCIONES_PERSONALES: readonly AccionPersonal[] = [
  "entrar", "salir", "terminarDescanso", "foto", "yaVolvi", "almuerzo", "voySalir",
];

/** Lo que la tarjeta sabe de la jornada de quien mira. */
export type EstadoDeFichar = {
  /** Hay un fichaje abierto. */
  dentro: boolean;
  /** Está abierta la caja de «¿por qué?» al fichar: lleva su propio «Registrar entrada» y «Cancelar». */
  pideMotivo: boolean;
  /** La salida abierta (almuerzo u otra), si la hay. */
  descanso: { reason: string; leftAt: string } | null;
  /** El viaje abierto (visita, mandado), si lo hay. */
  viaje: { startedAt: string; vehicleId: string | null } | null;
};

/** ¿Van las acciones en el desplegable? Solo para el admin; el empleado y el gerente, botones. */
export function accionesEnMenu(role: string | null | undefined): boolean {
  return esAdminDeTt(role);
}

/**
 * Las acciones que hay ahora mismo, en el orden del menú.
 *
 * Las condiciones son las de los botones de la tarjeta (PunchPanel), una a una:
 *   · entrar / salir: siempre que no esté abierta la caja del motivo (esa caja trae su botón).
 *   · lo demás solo estando dentro, y según la fila de `filaDeSalida`: con una salida abierta, solo
 *     terminarla; durante una visita, la foto, «ya volví» si el viaje es personal y el almuerzo;
 *     si no, el almuerzo y «voy a salir».
 */
export function accionesPersonales(e: EstadoDeFichar): AccionPersonal[] {
  const lista: AccionPersonal[] = [];
  if (e.dentro) {
    const fila = filaDeSalida({ descansoAbierto: !!e.descanso, viajeAbierto: !!e.viaje });
    if (fila === "descanso") {
      lista.push("terminarDescanso");
    } else if (fila === "visita" && e.viaje) {
      lista.push("foto");
      if (seCierraDeUnToque(e.viaje)) lista.push("yaVolvi");
      lista.push("almuerzo");
    } else {
      lista.push("almuerzo", "voySalir");
    }
  }
  if (!e.pideMotivo) lista.push(e.dentro ? "salir" : "entrar");
  return lista;
}

/** El texto de una opción: la clave del botón de siempre, su icono y la hora que llevaba detrás. */
export type TextoDeAccion = {
  clave: string;
  icono: string | null;
  /** La hora que va tras « · » (ISO), como en el botón. */
  hora: string | null;
  /** Terminar la jornada: al final, en rojo y tras una raya (era el botón rojo). */
  peligro: boolean;
};

export function textoDeAccion(a: AccionPersonal, e: EstadoDeFichar): TextoDeAccion {
  const t = (clave: string, icono: string | null = null, hora: string | null = null, peligro = false): TextoDeAccion =>
    ({ clave, icono, hora, peligro });
  switch (a) {
    case "entrar": return t("emp.punch.clockIn");
    case "salir": return t("emp.punch.clockOut", null, null, true);
    case "terminarDescanso":
      return t(e.descanso?.reason === "lunch" ? "emp.punch.endLunch" : "emp.punch.imBack", null, e.descanso?.leftAt ?? null);
    case "foto": return t("emp.visit.takePhoto", "📷");
    case "yaVolvi": return t("emp.punch.imBack", null, e.viaje?.startedAt ?? null);
    case "almuerzo": return t("emp.punch.startLunch", "🍽");
    case "voySalir": return t("emp.punch.goingOut", "🚚");
  }
}

/** Lo que dice la pastilla de la tarjeta del admin: el estado de ahora y desde qué hora. */
export type EstadoVisible = {
  clave: string;
  icono: string | null;
  /** Desde cuándo (ISO); null = sin hora («sin fichar»). */
  desde: string | null;
  /** La clase de la pastilla: `on` (verde) o `wait` (ámbar), las de siempre. */
  tono: "on" | "wait";
};

/**
 * Una salida abierta manda sobre el viaje, igual que en `filaDeSalida`: con el almuerzo empezado el
 * viaje queda en pausa, y lo que la persona está haciendo es almorzar.
 */
export function estadoDelFichaje(e: { entrada: string | null } & Pick<EstadoDeFichar, "descanso" | "viaje">): EstadoVisible {
  if (!e.entrada) return { clave: "emp.punch.notClockedIn", icono: null, desde: null, tono: "wait" };
  if (e.descanso) {
    return e.descanso.reason === "lunch"
      ? { clave: "emp.state.onLunch", icono: "🍽", desde: e.descanso.leftAt, tono: "wait" }
      : { clave: "emp.state.out", icono: "🚚", desde: e.descanso.leftAt, tono: "wait" };
  }
  if (e.viaje) return { clave: "emp.state.onTrip", icono: "🚗", desde: e.viaje.startedAt, tono: "on" };
  return { clave: "emp.state.working", icono: "🟢", desde: e.entrada, tono: "on" };
}
