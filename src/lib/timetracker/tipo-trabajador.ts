// ============================================================
// El tipo de trabajador (presencial / remoto), visto desde la ficha de Usuarios del hub.
//
// `timetracker.employee_settings.worker_type` decide qué le sale a cada quien en «Registrar
// tiempo» (D-123): el presencial ficha en la tienda con foto y ubicación, el remoto usa el
// cronómetro con capturas. Hasta ahora solo se podía elegir en Time Tracker › People, y el
// dueño lo buscó donde configura a la gente: en Usuarios. No estaba.
//
// Y había un segundo problema, callado: dar acceso a Time Tracker desde Usuarios NO crea la fila
// de `timetracker.employee_settings`. Sin fila, la persona cuenta como el tipo por defecto
// (remoto) y sale INACTIVA en People, sin que la ficha dijera ninguna de las dos cosas.
//
// Esto es la parte pura —qué se escribe y qué se le dice al admin—, sin red ni Supabase, para
// probarla sola. La acción (`clock-in/actions/team.ts`) consulta y escribe; el campo
// (`components/TipoDeTrabajadorCampo.tsx`) pinta.
// ============================================================

export type TipoDeTrabajador = "inhouse" | "remote";

/** Presencial primero: es lo que el dueño vino a buscar, y el defecto (remoto) ya sale solo. */
export const TIPOS_DE_TRABAJADOR: readonly TipoDeTrabajador[] = ["inhouse", "remote"];

export function esTipoDeTrabajador(v: unknown): v is TipoDeTrabajador {
  return v === "inhouse" || v === "remote";
}

/**
 * El defecto global (`timetracker.settings.data.defaultWorkerType`). Si no se pudo leer o trae
 * otra cosa, remoto: es el mismo último recurso que `effWorkerType` en helpers.ts, y la ficha no
 * puede decir un defecto distinto del que la app va a aplicar.
 */
export function tipoPorDefecto(v: unknown): TipoDeTrabajador {
  return v === "inhouse" ? "inhouse" : "remote";
}

/**
 * Quién puede escribir `timetracker.employee_settings` de OTRA persona. Es la política de la
 * base dicha en TypeScript: `is_timetracker_admin()` = `timetracker_role = 'admin'` (058/060; 080
 * solo la envolvió en un initplan). Un gerente de tienda (`manager`) pasa el `managerCtx` de
 * fichaje pero NO esta política — sin esta comprobación su guardado afectaría cero filas y la
 * pantalla diría que sí.
 */
export function puedeEscribirTipo(timetrackerRole: unknown): boolean {
  return timetrackerRole === "admin";
}

export const SOLO_ADMIN_TT =
  "Only a Time Tracker admin can change the worker type. / Solo un admin de Time Tracker puede cambiar el tipo de trabajador.";

export const SIN_FILA_TT =
  "This person has no Time Tracker setup yet — pick the worker type first. / Esta persona aún no tiene ficha de Time Tracker — elige primero el tipo de trabajador.";

/** La mitad de Time Tracker de una persona, tal como la lee la acción. */
export type MitadTimeTracker = {
  /**
   * false = quien mira no es admin de Time Tracker. RLS le esconde la fila de los demás, así que
   * «no hay fila» y «no la puedo ver» son indistinguibles: no se afirma ninguna.
   */
  legible: boolean;
  tieneFila: boolean;
  workerType: TipoDeTrabajador | null;
  active: boolean;
  /** El tipo que se aplica a quien no tiene uno elegido. */
  defecto: TipoDeTrabajador;
};

/**
 * Qué se escribe al elegir un tipo.
 *
 *  · Sin fila: se CREA, con el tipo y ACTIVA. Es el caso que originó esto — alguien recién dado
 *    de alta que nadie configuró; dejarlo inactivo sería repetir el defecto callado.
 *  · Con fila: se cambia SOLO el tipo. Quien ya está configurado no se toca: si alguien lo
 *    desactivó en People, elegirle el tipo aquí no lo reactiva a escondidas.
 */
export type PlanDeTipo =
  | { op: "insert"; fila: { id: string; worker_type: TipoDeTrabajador; active: true } }
  | { op: "update"; cambio: { worker_type: TipoDeTrabajador } };

export function planDeTipo(id: string, tieneFila: boolean, tipo: TipoDeTrabajador): PlanDeTipo {
  if (!tieneFila) return { op: "insert", fila: { id, worker_type: tipo, active: true } };
  return { op: "update", cambio: { worker_type: tipo } };
}

/** Lo que la ficha le dice al admin, en claro, de las dos mitades. */
export type EstadoDeFicha = {
  /** El tipo que la app le está aplicando HOY (el elegido, o el defecto). */
  tipo: TipoDeTrabajador;
  /** false = nadie lo eligió: va por el defecto. */
  elegido: boolean;
  /**
   * `sin_fila` y `apagado` se ven igual en Time Tracker › People («Inactive»), pero se arreglan
   * distinto: la primera eligiendo el tipo, la segunda activando.
   */
  timeTracker: "activo" | "sin_fila" | "apagado" | "ilegible";
  /** La mitad de fichaje (`clockin.employee_settings.active`): si cuenta su tiempo en tienda. */
  fichaje: "activo" | "detenido" | "sin_fila";
};

export function estadoDeFicha(tt: MitadTimeTracker, fichaje: { active: boolean } | null): EstadoDeFicha {
  const timeTracker: EstadoDeFicha["timeTracker"] = !tt.legible
    ? "ilegible"
    : !tt.tieneFila
      ? "sin_fila"
      : tt.active
        ? "activo"
        : "apagado";
  return {
    tipo: tt.workerType ?? tt.defecto,
    elegido: tt.workerType != null,
    timeTracker,
    fichaje: !fichaje ? "sin_fila" : fichaje.active ? "activo" : "detenido",
  };
}
