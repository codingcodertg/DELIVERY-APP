import { BUSINESS_TZ } from "@/lib/utils";
import { PUNTOS, SECCIONES, VERSION_DE_LA_LISTA, puntoPorId, type Punto, type Seccion } from "@/lib/inspeccion/puntos";

/**
 * Las reglas de la inspección pre-viaje (D-518), sin React y sin base: qué cuenta como contestado, cuándo el camión
 * es «seguro para salir», qué falta para enviarla, «una por chofer, por día y por vehículo», y cómo se ordena la lista
 * de logística. La pantalla del chofer, la de logística y el aviso de «Mi ruta» preguntan aquí; no deciden nada solos.
 */

export type Estado = "ok" | "defecto" | "na";

export interface Respuesta {
  estado: Estado;
  /** Qué tiene. Obligatoria en un defecto. */
  nota?: string;
  /** Fotos del defecto (data URL, como las de las entregas). Obligatoria al menos una en un defecto. */
  fotos?: string[];
}

export type Respuestas = Record<string, Respuesta>;

/** Un defecto que logística o el admin marcó como corregido. Lo sella la base (`marca_defecto_corregido`). */
export interface Reparacion {
  at: string;
  by: string | null;
  by_name: string | null;
  note: string | null;
}

export type Reparaciones = Record<string, Reparacion>;

/** Una inspección guardada: la fila de `public.vehicle_inspections`. */
export interface Inspeccion {
  id: string;
  driver_id: string;
  driver_name: string;
  inspection_date: string;
  vehicle_id: string | null;
  vehicle_label: string;
  odometer: number | null;
  answers: Respuestas;
  safe: boolean;
  notes: string | null;
  certified: boolean;
  checklist_version: string;
  repairs: Reparaciones;
  created_at: string;
}

/** Lo que manda el teléfono. Chofer, nombre, fecha y hora los vuelve a poner la base (el disparador de la 165). */
export type InspeccionNueva = Omit<Inspeccion, "id" | "repairs" | "created_at">;

/** Fotos por defecto: una prueba basta y dos dan otro ángulo. Más, y la fila de un día se vuelve pesada. */
export const MAX_FOTOS_POR_DEFECTO = 2;

/** Qué botones lleva un punto. Uno crítico no admite «No aplica»; uno normal, solo si `puedeNoAplicar`. */
export function opcionesDe(p: Punto): Estado[] {
  return p.puedeNoAplicar && !p.critico ? ["ok", "defecto", "na"] : ["ok", "defecto"];
}

/** ¿Está contestado este punto, con una opción que el punto admite? */
export function contestado(p: Punto, r: Respuesta | undefined): boolean {
  return !!r && opcionesDe(p).includes(r.estado);
}

/** «12 de 34»: cuántos puntos de la lista están contestados. */
export function progreso(respuestas: Respuestas, puntos: readonly Punto[] = PUNTOS): { hechos: number; total: number } {
  return { hechos: puntos.filter((p) => contestado(p, respuestas[p.id])).length, total: puntos.length };
}

export const progresoDeSeccion = (s: Seccion, respuestas: Respuestas) => progreso(respuestas, s.puntos);

/**
 * Los puntos marcados «Defecto», en el orden de la lista. Uno que ya no está en la lista (una inspección hecha con una
 * versión vieja) también cuenta, al final: un defecto reportado no desaparece porque alguien editó la lista.
 */
export function defectos(respuestas: Respuestas | null | undefined): string[] {
  const r = respuestas ?? {};
  const deLaLista = PUNTOS.filter((p) => r[p.id]?.estado === "defecto").map((p) => p.id);
  const sueltos = Object.keys(r).filter((id) => !puntoPorId(id) && r[id]?.estado === "defecto");
  return [...deLaLista, ...sueltos];
}

export const defectosCriticos = (respuestas: Respuestas): string[] => defectos(respuestas).filter((id) => puntoPorId(id)?.critico);

/**
 * ¿Es seguro salir con este camión? **Solo si cada punto crítico (frenos, dirección, llantas, ruedas, luces de freno,
 * direccionales) está contestado «OK».** Un crítico sin contestar no es seguro: la regla pide la afirmación, no la
 * ausencia de queja. Un defecto en algo no crítico (la bocina, la plataforma) no lo impide; se reporta igual.
 */
export function esSeguroParaSalir(respuestas: Respuestas): boolean {
  return PUNTOS.filter((p) => p.critico).every((p) => respuestas[p.id]?.estado === "ok");
}

/** El cuentakilómetros escrito a mano: «123,456» o «123456.7». Vacío o raro → `null` (nunca 0, como en D-489). */
export function leeOdometro(texto: string): number | null {
  const limpio = texto.replace(/[\s,]/g, "");
  if (!/^\d{1,7}(\.\d+)?$/.test(limpio)) return null;
  const n = Number(limpio);
  return Number.isFinite(n) && n < 10_000_000 ? n : null;
}

export interface VehiculoElegido {
  /** `clockin.vehicles.id`, o `null` si lo escribió a mano («Otro»). */
  id: string | null;
  /** Lo que se enseña: «Camión 3 · TX 4KD-221». Se guarda así, por si el vehículo cambia de nombre. */
  etiqueta: string;
}

export interface Borrador {
  vehiculo: VehiculoElegido | null;
  odometro: string;
  respuestas: Respuestas;
  notas: string;
  certificado: boolean;
}

export const borradorVacio = (): Borrador => ({ vehiculo: null, odometro: "", respuestas: {}, notas: "", certificado: false });

export type Falta =
  | { tipo: "vehiculo" }
  | { tipo: "odometro" }
  | { tipo: "sin_contestar"; ids: string[] }
  | { tipo: "defecto_sin_nota"; ids: string[] }
  | { tipo: "defecto_sin_foto"; ids: string[] }
  | { tipo: "certificar" };

/** Lo que falta para poder enviar, en el orden en que se le dice al chofer. Vacío = se puede enviar. */
export function faltasParaEnviar(b: Borrador): Falta[] {
  const out: Falta[] = [];
  if (!b.vehiculo || !b.vehiculo.etiqueta.trim()) out.push({ tipo: "vehiculo" });
  if (leeOdometro(b.odometro) == null) out.push({ tipo: "odometro" });
  const sinContestar = PUNTOS.filter((p) => !contestado(p, b.respuestas[p.id])).map((p) => p.id);
  if (sinContestar.length) out.push({ tipo: "sin_contestar", ids: sinContestar });
  const def = PUNTOS.filter((p) => b.respuestas[p.id]?.estado === "defecto");
  const sinNota = def.filter((p) => !(b.respuestas[p.id]?.nota ?? "").trim()).map((p) => p.id);
  if (sinNota.length) out.push({ tipo: "defecto_sin_nota", ids: sinNota });
  const sinFoto = def.filter((p) => !(b.respuestas[p.id]?.fotos ?? []).length).map((p) => p.id);
  if (sinFoto.length) out.push({ tipo: "defecto_sin_foto", ids: sinFoto });
  if (!b.certificado) out.push({ tipo: "certificar" });
  return out;
}

/** La primera sección con algo pendiente, para abrirla cuando el chofer pulsa «Enviar» y le falta algo. */
export function primeraSeccionConFaltas(faltas: Falta[]): Seccion["id"] | null {
  const ids = new Set(faltas.flatMap((f) => ("ids" in f ? f.ids : [])));
  return SECCIONES.find((s) => s.puntos.some((p) => ids.has(p.id)))?.id ?? null;
}

/**
 * Lo que se guarda. Las respuestas se limpian: un punto que fue «Defecto» y volvió a «OK» no arrastra su nota ni sus
 * fotos, y solo entran puntos de la lista. «Seguro para salir» sale de `esSeguroParaSalir`, no del teléfono.
 */
export function inspeccionParaGuardar(b: Borrador, quien: { id: string; nombre: string }, fecha: string): InspeccionNueva {
  const answers: Respuestas = {};
  for (const p of PUNTOS) {
    const r = b.respuestas[p.id];
    if (!contestado(p, r)) continue;
    answers[p.id] = r!.estado === "defecto"
      ? { estado: "defecto", nota: (r!.nota ?? "").trim(), fotos: (r!.fotos ?? []).slice(0, MAX_FOTOS_POR_DEFECTO) }
      : { estado: r!.estado };
  }
  return {
    driver_id: quien.id,
    driver_name: quien.nombre,
    inspection_date: fecha,
    vehicle_id: b.vehiculo?.id ?? null,
    vehicle_label: (b.vehiculo?.etiqueta ?? "").trim(),
    odometer: leeOdometro(b.odometro),
    answers,
    safe: esSeguroParaSalir(answers),
    notes: b.notas.trim() || null,
    certified: b.certificado,
    checklist_version: VERSION_DE_LA_LISTA,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Una por chofer, por día y por vehículo
// ---------------------------------------------------------------------------------------------------------------

/** El mismo vehículo: por su id; si se escribió a mano, por el texto (sin mayúsculas ni espacios de más). */
export const claveDeVehiculo = (v: { vehicle_id: string | null; vehicle_label: string }): string =>
  v.vehicle_id ?? `texto:${v.vehicle_label.trim().replace(/\s+/g, " ").toLowerCase()}`;

/** Las de este chofer en este día, de la primera a la última. */
export function delChoferEnElDia(filas: readonly Inspeccion[], choferId: string, fecha: string): Inspeccion[] {
  return filas
    .filter((f) => f.driver_id === choferId && f.inspection_date === fecha)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** La última inspección del chofer hoy (con cualquier vehículo), o `null` si aún no hizo ninguna. */
export function hechaHoy(filas: readonly Inspeccion[], choferId: string, fecha: string): Inspeccion | null {
  const suyas = delChoferEnElDia(filas, choferId, fecha);
  return suyas.length ? suyas[suyas.length - 1] : null;
}

/** ¿Ya inspeccionó hoy ESTE vehículo? Es lo que la base no deja repetir (índice único de la 165). */
export function yaHechaConEsteVehiculo(filas: readonly Inspeccion[], choferId: string, fecha: string, v: VehiculoElegido | null): boolean {
  if (!v) return false;
  const clave = claveDeVehiculo({ vehicle_id: v.id, vehicle_label: v.etiqueta });
  return delChoferEnElDia(filas, choferId, fecha).some((f) => claveDeVehiculo(f) === clave);
}

/** Cómo quedó la lectura de la base. `sin_tabla` = la migración 165 aún no está aplicada. */
export type EstadoDeLectura = "cargando" | "listo" | "sin_tabla" | "error";

/**
 * ¿Sale en «Mi ruta» el aviso «Haz tu inspección pre-viaje»? Solo si se puede hacer (la base la acepta, o es el demo)
 * y hoy aún no hay ninguna. Sin la 165 NO se avisa: mandar al chofer a una pantalla que le dice «aún no se puede
 * guardar» es ruido. **Avisa, no bloquea** (primer borrador; bloquear es una decisión del dueño).
 */
export function debeAvisar(estado: EstadoDeLectura, filas: readonly Inspeccion[], choferId: string | null | undefined, fecha: string): boolean {
  if (estado !== "listo" || !choferId) return false;
  return hechaHoy(filas, choferId, fecha) == null;
}

// ---------------------------------------------------------------------------------------------------------------
// Logística
// ---------------------------------------------------------------------------------------------------------------

/** Defectos aún sin marcar «corregido». */
export function defectosAbiertos(f: Pick<Inspeccion, "answers" | "repairs">): string[] {
  const rep = f.repairs ?? {};
  return defectos(f.answers).filter((id) => !rep[id]);
}

/**
 * Cómo está HOY una inspección, para logística y para el chofer:
 *   · `no_segura`: no era segura al firmarla y le queda algún defecto crítico sin corregir. No se sale.
 *   · `corregida`: no era segura, y logística ya marcó corregidos todos sus críticos (49 CFR 396.11(a)(3): el defecto se
 *     repara o se certifica que no hace falta antes de volver a usar el camión). `safe` no cambia: es lo que se firmó.
 *   · `con_defectos`: segura, con algún defecto no crítico sin corregir.
 *   · `limpia`: nada abierto.
 * Un defecto cuyo punto ya no está en la lista cuenta como crítico: ante la duda, no se da por segura.
 */
export type EstadoDeLaInspeccion = "no_segura" | "corregida" | "con_defectos" | "limpia";

export function estadoDeLaInspeccion(f: Pick<Inspeccion, "answers" | "repairs" | "safe">): EstadoDeLaInspeccion {
  const abiertos = defectosAbiertos(f);
  const esCritico = (id: string) => { const p = puntoPorId(id); return p ? !!p.critico : true; };
  if (!f.safe) return abiertos.some(esCritico) ? "no_segura" : "corregida";
  return abiertos.length ? "con_defectos" : "limpia";
}

/**
 * El orden de la lista de logística: primero lo que no puede salir (`no_segura`), después lo que tiene algún defecto
 * abierto, luego lo demás; dentro de cada grupo, por hora, la primera arriba.
 */
export function ordenParaLogistica(filas: readonly Inspeccion[]): Inspeccion[] {
  const peso = (f: Inspeccion) => {
    if (estadoDeLaInspeccion(f) === "no_segura") return 0;
    if (defectosAbiertos(f).length) return 1;
    return 2;
  };
  return [...filas].sort((a, b) => peso(a) - peso(b) || a.created_at.localeCompare(b.created_at));
}

const normaliza = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** Los choferes con alguna orden ese día (los que deberían inspeccionar), por su nombre, como `assigned_driver`. */
export function choferesConRuta(
  ordenes: readonly { assigned_driver?: string | null; delivery_date?: string | null; stage?: string | null }[],
  fecha: string,
): string[] {
  const fuera = new Set(["draft", "rejected", "canceled"]);
  const nombres = new Map<string, string>();
  for (const o of ordenes) {
    const n = (o.assigned_driver ?? "").trim();
    if (!n || o.delivery_date !== fecha || fuera.has(o.stage ?? "")) continue;
    if (!nombres.has(normaliza(n))) nombres.set(normaliza(n), n);
  }
  return [...nombres.values()].sort((a, b) => a.localeCompare(b));
}

export interface ResumenDelDia {
  hechas: number;
  /** Las que siguen sin poder salir: no seguras con algún crítico sin corregir. */
  noSeguras: number;
  defectosAbiertos: number;
  /** Choferes con ruta ese día que no tienen inspección. */
  sinInspeccion: string[];
}

export function resumenDelDia(filas: readonly Inspeccion[], conRuta: readonly string[]): ResumenDelDia {
  const hicieron = new Set(filas.map((f) => normaliza(f.driver_name)));
  return {
    hechas: filas.length,
    noSeguras: filas.filter((f) => estadoDeLaInspeccion(f) === "no_segura").length,
    defectosAbiertos: filas.reduce((n, f) => n + defectosAbiertos(f).length, 0),
    sinInspeccion: conRuta.filter((n) => !hicieron.has(normaliza(n))),
  };
}

/** La hora de una inspección en la hora del negocio (Texas): «7:12 AM». */
export function horaDelNegocio(iso: string, es: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(es ? "es-MX" : "en-US", { timeZone: BUSINESS_TZ, hour: "numeric", minute: "2-digit" }).format(d);
}

/** «Camión 3 · TX 4KD-221». */
export const etiquetaDeVehiculo = (v: { name: string; plate?: string | null }): string =>
  [v.name.trim(), (v.plate ?? "").trim()].filter(Boolean).join(" · ");

/**
 * Quién ve las inspecciones de TODOS y marca un defecto «corregido»: logística y el admin. Es la misma lista que las
 * políticas de la 165 (`vehicle_inspections select` y `marca_defecto_corregido`); una prueba compara las dos.
 */
export const ROLES_QUE_REVISAN = ["admin"] as const; // D-521: solo el admin (antes también logística)
export const revisaLasDelEquipo = (role: string | null | undefined): boolean => (ROLES_QUE_REVISAN as readonly string[]).includes(role ?? "");

/**
 * Al contestar un punto: si con eso la sección queda completa y sin defectos, se pliega y se abre la siguiente que
 * falte. Con un defecto se queda abierta, porque al chofer le toca escribir qué tiene y tomar la foto.
 */
export function trasContestar(actual: Seccion["id"], respuestas: Respuestas): { cerrar: boolean; abrir: Seccion["id"] | null } {
  const i = SECCIONES.findIndex((s) => s.id === actual);
  const s = SECCIONES[i];
  if (!s) return { cerrar: false, abrir: null };
  const { hechos, total } = progresoDeSeccion(s, respuestas);
  if (hechos < total || s.puntos.some((p) => respuestas[p.id]?.estado === "defecto")) return { cerrar: false, abrir: null };
  const resto = [...SECCIONES.slice(i + 1), ...SECCIONES.slice(0, i)];
  const siguiente = resto.find((x) => progresoDeSeccion(x, respuestas).hechos < x.puntos.length);
  return { cerrar: true, abrir: siguiente?.id ?? null };
}
