// ============================================================
// Puntos: el libro mayor y sus reglas (D-NEXT).
//
// Encargo 1 de cinco, y ninguna pantalla. Aquí vive lo que los otros cuatro
// —puntear a mano, la puntualidad automática, el canje y la subida del
// cliente— van a llamar, para que la regla exista una vez y no cuatro.
//
// Dos ideas que mandan sobre todo lo demás:
//
//   · El saldo se SUMA, nunca se guarda. No hay función que escriba un saldo,
//     a propósito. La tabla es `point_events` (105) y es append-only.
//   · Lo que decide quién puede escribir lo hace cumplir la BASE (RLS + un
//     guard, en 105). Lo de aquí sirve para no ofrecer un botón que la base va
//     a rechazar, no para autorizar nada.
// ============================================================

import type { Profile, Settings, UserRole } from "./types";

/** Un apunte del libro mayor. Positivo suma, negativo resta, cero no existe. */
export interface PointEvent {
  id?: string;
  /** El sujeto, cuando es una persona de la casa. Excluyente con `account`. */
  employee_id?: string | null;
  /** El sujeto, cuando es un cliente. Es el `account` del pedido, porque un
   * cliente no tiene cuenta en la app: su única credencial es el enlace de
   * seguimiento de su pedido. */
  account?: string | null;
  points: number;
  /** Motivo corto y estable: `punctual_day`, `late`, `customer_photo`… */
  reason: string;
  kind: "auto" | "manual";
  /** Clave natural de los automáticos, para que conceder dos veces no pague
   * dos veces. Null en los manuales. */
  source_key?: string | null;
  granted_by?: string | null;
  note?: string | null;
  created_at?: string;
}

/** Tasas de partida. Son un RESPALDO del código, no la configuración: la que
 * manda es la de Ajustes, y estos mismos números son el `default` de sus
 * columnas en 105. Aquí están por si la fila llegara sin ellas. */
export const TASAS_POR_DEFECTO = { puntual: 2, diaLibre: 100 } as const;

/** Cuánto vale un día puntual y cuánto cuesta un día libre, hoy. */
export function tasas(settings?: Partial<Settings> | null): { puntual: number; diaLibre: number } {
  const entero = (v: unknown, porDefecto: number) =>
    typeof v === "number" && Number.isInteger(v) && v > 0 ? v : porDefecto;
  return {
    puntual: entero(settings?.points_per_punctual_day, TASAS_POR_DEFECTO.puntual),
    diaLibre: entero(settings?.points_per_day_off, TASAS_POR_DEFECTO.diaLibre),
  };
}

/** El saldo es la suma, y punto. */
export function saldo(eventos: Pick<PointEvent, "points">[]): number {
  return eventos.reduce((t, e) => t + e.points, 0);
}

/** Lo que un empleado puede VER de su historial: solo lo que suma.
 *
 * Decisión del dueño: el empleado ve su saldo, no el detalle de las restas.
 * Esto es la misma regla que la política de lectura de 105, repetida aquí para
 * que una pantalla no liste de más si algún día la lee con otro cliente. La que
 * protege de verdad es la de la base; esta es cortesía. */
export function eventosVisiblesParaEmpleado<T extends Pick<PointEvent, "points">>(eventos: T[]): T[] {
  return eventos.filter((e) => e.points > 0);
}

/** La clave natural de un día puntual. Un empleado, un día, un pago. */
export function clavePuntualidad(employeeId: string, fecha: string): string {
  return `punctual:${employeeId}:${fecha}`;
}

/** Cuántos días libres cubre un saldo, y cuánto falta para el siguiente. */
export function canje(saldoActual: number, costoDiaLibre: number): { dias: number; faltan: number } {
  if (!Number.isInteger(costoDiaLibre) || costoDiaLibre <= 0) return { dias: 0, faltan: 0 };
  const dias = Math.max(0, Math.floor(saldoActual / costoDiaLibre));
  const restante = saldoActual - dias * costoDiaLibre;
  return { dias, faltan: costoDiaLibre - (restante > 0 ? restante : 0) };
}

// ---- Quién puede puntear ---------------------------------------------------

const PUNTUADORES: UserRole[] = ["admin", "manager"];

/** ¿Puede esta persona conceder puntos a ese empleado?
 *
 * Nadie se puntea a sí mismo, ni siquiera un admin: quien puede darse puntos
 * puede canjearse días libres pagados, y eso es dinero. La misma condición está
 * en el `with check` de 105 — esta copia es para no pintar el botón. */
export function puedeConceder(actor: Pick<Profile, "id" | "role"> | null | undefined, employeeId?: string | null): boolean {
  if (!actor) return false;
  if (!PUNTUADORES.includes(actor.role)) return false;
  return !employeeId || employeeId !== actor.id;
}

// ---- Construir un evento (puro: devuelve la fila, no la escribe) ------------

export interface EntradaManual {
  employeeId?: string | null;
  account?: string | null;
  points: number;
  reason: string;
  note?: string | null;
}

export type Resultado<T> = { ok: true; valor: T } | { ok: false; error: string };

/** La fila de un apunte manual, o por qué no se puede construir.
 *
 * Cada motivo de rechazo de aquí tiene su `check` o su política en 105. Se
 * valida dos veces a propósito: la base es la que manda, y esta es la que
 * permite decir qué pasa sin esperar a un error de Postgres en la cara. */
export function eventoManual(entrada: EntradaManual, actor: Pick<Profile, "id" | "role">): Resultado<PointEvent> {
  const employeeId = entrada.employeeId ?? null;
  const account = (entrada.account ?? "").trim() || null;

  if ((employeeId === null) === (account === null)) {
    return { ok: false, error: "Un apunte es de un empleado o de un cliente, no de los dos ni de ninguno" };
  }
  if (!Number.isInteger(entrada.points) || entrada.points === 0) {
    return { ok: false, error: "Los puntos son un entero distinto de cero" };
  }
  const reason = entrada.reason.trim();
  if (!reason || reason.length > 80) {
    return { ok: false, error: "El motivo es obligatorio y no pasa de 80 caracteres" };
  }
  const note = (entrada.note ?? "").trim() || null;
  if (note && note.length > 500) {
    return { ok: false, error: "La nota no pasa de 500 caracteres" };
  }
  if (!puedeConceder(actor, employeeId)) {
    return { ok: false, error: "Solo un admin o un gerente puntea, y nunca a sí mismo" };
  }

  return {
    ok: true,
    valor: { employee_id: employeeId, account, points: entrada.points, reason, kind: "manual", source_key: null, granted_by: actor.id, note },
  };
}

/** La fila de un día puntual. No lleva `granted_by`: no lo concede nadie, lo
 * concede el reloj, y la base solo acepta estos por service_role. */
export function eventoPuntualidad(employeeId: string, fecha: string, puntos: number): PointEvent {
  return {
    employee_id: employeeId,
    account: null,
    points: puntos,
    reason: "punctual_day",
    kind: "auto",
    source_key: clavePuntualidad(employeeId, fecha),
    granted_by: null,
    note: null,
  };
}

// ---- Leer y escribir -------------------------------------------------------
// El cliente se recibe como parámetro en vez de crearse aquí: estas funciones
// las van a llamar tanto una pantalla (cliente del navegador) como el trabajo
// diario (service_role en el servidor), y quien decide con qué credencial se
// escribe es quien llama, no esta librería.

type Cliente = {
  from: (tabla: string) => {
    insert: (filas: unknown) => Promise<{ error: { message: string } | null }>;
    select: (cols: string) => {
      eq: (col: string, val: unknown) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
    };
  };
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

/** Escribe un apunte manual. Devuelve el error de la BASE tal cual cuando lo
 * hay: si la RLS lo rechaza, esa es la respuesta buena, no una nuestra. */
export async function concederPuntos(
  supabase: Cliente,
  entrada: EntradaManual,
  actor: Pick<Profile, "id" | "role">,
): Promise<Resultado<PointEvent>> {
  const fila = eventoManual(entrada, actor);
  if (!fila.ok) return fila;
  const { error } = await supabase.from("point_events").insert(fila.valor);
  if (error) return { ok: false, error: error.message };
  return fila;
}

/** El saldo propio, restas incluidas, sin listar ninguna: lo suma la base.
 * `my_point_balance()` es SECURITY DEFINER justo para esto. */
export async function miSaldo(supabase: Cliente): Promise<number> {
  const { data, error } = await supabase.rpc("my_point_balance");
  if (error || typeof data !== "number") return 0;
  return data;
}

/** Los apuntes de un empleado que ese empleado puede ver. La política de 105 ya
 * esconde los negativos; el filtro de aquí es el cinturón del cinturón. */
export async function misApuntes(supabase: Cliente, employeeId: string): Promise<PointEvent[]> {
  const { data, error } = await supabase
    .from("point_events")
    .select("id, employee_id, account, points, reason, kind, note, created_at")
    .eq("employee_id", employeeId);
  if (error || !Array.isArray(data)) return [];
  return eventosVisiblesParaEmpleado(data as PointEvent[]);
}
