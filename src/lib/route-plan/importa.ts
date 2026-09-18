import type { PlanEvaluado } from "@/lib/route-engine";
import type { NamedLocation } from "@/lib/types";
import type { PlanGuardado } from "./ajuste";
import { choferesDelPlan, type FilaDePlan } from "./borrador";
import { filasDeParadas, type FilaDeParada } from "./entrada";
import { casaConOrdenes, type FilaDeHoja, type MotivoSinCasar, type OrdenParaCasar } from "./hoja";
import { comparaConLaHoja, planDeLaHoja, type AsignacionDeHoja, type Comparacion } from "./hoja-plan";
import { vistaDelPlan, type RutaVista } from "./vista";

/**
 * De las filas de la hoja a un plan `manual_import` guardable y a lo que la pantalla enseña (D-326).
 *
 * Tres cosas que este fichero garantiza, y que tienen prueba:
 *   · **`writes` va SIEMPRE vacío.** Un plan importado es para comparar: aunque alguien lo publicara por error,
 *     no escribiría ninguna orden.
 *   · **De la hoja no se guarda el contenido:** en `result.hoja` quedan renglones, motivos y los ids de las
 *     órdenes de la app — ni direcciones, ni cuentas, ni nombres de cliente.
 *   · **Nada se adivina:** una fila sin casar, con un chofer que no está en el plan, o sin número de carga, NO se
 *     le asigna a nadie por parecido. Se lista, y su orden la coloca el motor como a cualquier otra sin asignar.
 */

const MAX_FILAS = 500;

/** Las filas que manda el navegador, campo a campo. Lo que no encaja es `null` entero: no se importa media hoja. */
export function filasValidas(x: unknown): FilaDeHoja[] | null {
  if (!Array.isArray(x) || x.length === 0 || x.length > MAX_FILAS) return null;
  const texto = (v: unknown) => (typeof v === "string" && v.length <= 200 ? v : null);
  const filas: FilaDeHoja[] = [];
  for (const f of x as Record<string, unknown>[]) {
    if (!f || typeof f !== "object") return null;
    const t = { po: texto(f.po), so: texto(f.so), invoice: texto(f.invoice), chofer: texto(f.chofer) };
    if (t.po === null || t.so === null || t.invoice === null || t.chofer === null) return null;
    if (!Number.isInteger(f.renglon) || (f.renglon as number) < 2) return null;
    if (!(f.carga === null || (Number.isInteger(f.carga) && (f.carga as number) >= 0 && (f.carga as number) < 1000))) return null;
    if (!(f.deliveryDate === null || (typeof f.deliveryDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f.deliveryDate)))) return null;
    // Solo viaja al plan lo que hace falta para casar y ordenar. El resto de la fila se queda en el navegador.
    filas.push({
      renglon: f.renglon as number, po: t.po, so: t.so, invoice: t.invoice, chofer: t.chofer, carga: f.carga as number | null, deliveryDate: f.deliveryDate as string | null,
      pallets: null, ventana: "", account: "", orderType: "", store: "", pickupName: "", deliveryAddress: "",
    });
  }
  return filas;
}

export type MotivoSinAsignarEnHoja = "sin_chofer" | "chofer_desconocido" | "sin_carga";

export interface RespuestaDeImportar {
  casadas: number;
  sinCasar: { renglon: number; motivo: MotivoSinCasar }[];
  /** Casaron con una orden de la app que NO está en el plan del motor (otra etapa, práctica…): no se puntúan. */
  fueraDelPlan: { renglon: number; ordenId: string }[];
  /** Casaron y están en el plan, pero la hoja no dice con quién o en qué carga: las coloca el motor. */
  sinAsignarEnHoja: { renglon: number; ordenId: string; motivo: MotivoSinAsignarEnHoja }[];
  /** Órdenes del plan del motor que la hoja no trae. */
  soloEnLaApp: string[];
  /** Todo lo que colocó el motor en el plan de la hoja (las dos listas de arriba, juntas). */
  delMotor: string[];
  comparacion: Comparacion;
  choferes: { id: string; nombre: string }[];
  rutasHoja: RutaVista[];
  /** Las entregas del plan de la hoja las ordenó el motor: la hoja no las trae. Se dice en pantalla. */
  entregasDelMotor: true;
}

export interface ResultadoDeImportar { plan: FilaDePlan; paradas: FilaDeParada[]; respuesta: RespuestaDeImportar }

export function planImportado(
  guardado: PlanGuardado, padre: string, motor: PlanEvaluado, filas: readonly FilaDeHoja[], ordenesDelDia: readonly OrdenParaCasar[], fechaISO: string,
  tiendas: readonly NamedLocation[],
): ResultadoDeImportar {
  const entrada = guardado.input.entrada;
  const enElPlan = new Set(entrada.ordenes.map((o) => o.id));
  const idDe = new Map(entrada.choferes.map((c) => [c.nombre.trim().toLowerCase(), c.id]));

  const casamiento = casaConOrdenes(filas, ordenesDelDia, fechaISO);
  const asignaciones: AsignacionDeHoja[] = [];
  const fueraDelPlan: RespuestaDeImportar["fueraDelPlan"] = [];
  const sinAsignarEnHoja: RespuestaDeImportar["sinAsignarEnHoja"] = [];
  for (const c of casamiento.casadas) {
    if (!enElPlan.has(c.ordenId)) { fueraDelPlan.push({ renglon: c.fila.renglon, ordenId: c.ordenId }); continue; }
    const nombre = c.fila.chofer.trim().toLowerCase();
    const choferId = idDe.get(nombre);
    const motivo: MotivoSinAsignarEnHoja | null = !nombre ? "sin_chofer" : !choferId ? "chofer_desconocido" : c.fila.carga === null ? "sin_carga" : null;
    if (motivo) { sinAsignarEnHoja.push({ renglon: c.fila.renglon, ordenId: c.ordenId, motivo }); continue; }
    asignaciones.push({ ordenId: c.ordenId, choferId: choferId!, carga: c.fila.carga!, renglon: c.fila.renglon });
  }

  const hoja = planDeLaHoja(entrada, guardado.params as never, asignaciones);
  const comparacion = comparaConLaHoja(hoja.evaluado, motor, asignaciones, guardado.result.explicaciones, entrada.choferes);
  const paradas = filasDeParadas(hoja.evaluado, { ordenes: entrada.ordenes, choferes: entrada.choferes }, guardado.input.puntos, tiendas);
  const sinCasar = casamiento.sinCasar.map((s) => ({ renglon: s.fila.renglon, motivo: s.motivo }));
  const soloEnLaApp = casamiento.soloEnLaApp.filter((id) => enElPlan.has(id));

  const plan: FilaDePlan = {
    plan_date: guardado.plan_date, source: "manual_import", parent_plan_id: padre, algorithm_version: guardado.algorithm_version,
    params: guardado.params, input: guardado.input,
    result: {
      ...guardado.result, coste: hoja.evaluado.coste, violaciones: hoja.evaluado.violaciones, sinAsignar: hoja.sinAsignar, explicaciones: [], fijadas: [],
      hoja: { casadas: casamiento.casadas.length, sinCasar, fueraDelPlan, sinAsignarEnHoja, soloEnLaApp, delMotor: hoja.delMotor, asignaciones, comparacion, entregasDelMotor: true },
    },
    writes: [],
    provider: guardado.provider, traffic: guardado.traffic, converged: hoja.convergio,
    total_minutes: hoja.evaluado.rutas.reduce((s, x) => s + x.duracionMin, 0), total_miles: Math.round(hoja.evaluado.coste.millas * 100) / 100,
    late_minutes: hoja.evaluado.coste.tardeMin, unassigned_count: hoja.sinAsignar.length + guardado.result.fuera.length,
  };
  return {
    plan, paradas,
    respuesta: {
      casadas: casamiento.casadas.length, sinCasar, fueraDelPlan, sinAsignarEnHoja, soloEnLaApp, delMotor: hoja.delMotor, comparacion,
      choferes: choferesDelPlan(entrada.choferes), rutasHoja: vistaDelPlan(paradas, entrada.ordenes, guardado.result.partes), entregasDelMotor: true,
    },
  };
}
