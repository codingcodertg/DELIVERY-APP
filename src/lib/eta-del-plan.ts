/**
 * La llegada PREVISTA de cada parada y la REAL (D-NEXT, migración 194). Roberto Rodriguez Jr (admin), 2026-10-24, con la
 * tabla de paradas del Gestor: «Need a column of "Actual" to know when they delivered vs when was their ETA».
 *
 * El Gestor mide la ruta en el navegador y solo de lo que falta (`listaDe` → `pendientesDelDia`): una parada hecha ya no
 * tiene llegada calculada. Por eso se apunta la PRIMERA llegada que el Gestor mide para cada parada el día de su ruta
 * (`delivery_eta_plans`, una fila por orden, día y parada; la primera gana), y la tabla enseña esa como «ETA» de lo hecho,
 * con la hora real al lado, en «Actual», y cuánto se desvió.
 *
 * Puro, sin navegador: lo prueba `eta-del-plan.test.ts`.
 */

export type TipoDeParada = "P" | "D";
export interface FilaDeEta { delivery_id: string; plan_date: string; kind: TipoDeParada; eta: string }

/** La clave de una parada en el mapa de llegadas guardadas. */
export const claveDeEta = (id: string, tipo: TipoDeParada): string => `${tipo}:${id}`;

const HORA = /^[0-2]\d:[0-5]\d$/;

/**
 * Las filas que hay que apuntar de lo que se acaba de medir (`routeEtas`: por ruta, la llegada de cada parada; una
 * recogida va como `P:id1,id2`, una entrega por el id de su orden). Solo lo que aún no está apuntado (`ya`), y solo con
 * una hora válida. Una recogida de varias órdenes apunta su hora a cada una.
 */
export function filasNuevasDeEtas(medidas: Readonly<Record<string, Readonly<Record<string, string>>>>, fecha: string, ya: ReadonlyMap<string, string>): FilaDeEta[] {
  const out = new Map<string, FilaDeEta>();
  for (const etas of Object.values(medidas)) {
    for (const [clave, eta] of Object.entries(etas)) {
      if (!HORA.test(eta)) continue;
      const tipo: TipoDeParada = clave.startsWith("P:") ? "P" : "D";
      const ids = tipo === "P" ? clave.slice(2).split(",").filter(Boolean) : [clave];
      for (const id of ids) {
        const k = claveDeEta(id, tipo);
        if (ya.has(k) || out.has(k)) continue;
        out.set(k, { delivery_id: id, plan_date: fecha, kind: tipo, eta });
      }
    }
  }
  return [...out.values()];
}

/** Lo leído de la base, como mapa por parada. */
export function mapaDeEtas(filas: readonly Pick<FilaDeEta, "delivery_id" | "kind" | "eta">[]): Map<string, string> {
  return new Map(filas.map((f) => [claveDeEta(f.delivery_id, f.kind), f.eta]));
}

const minutos = (hora: string): number | null => (HORA.test(hora) ? Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5)) : null);

/** Cuánto se desvió la real de la prevista, en minutos (positivo = más tarde). Null sin una de las dos. */
export function desvio(prevista: string | null | undefined, real: string | null | undefined): number | null {
  const a = minutos(prevista ?? ""), b = minutos(real ?? "");
  return a === null || b === null ? null : b - a;
}

/** Hasta cuántos minutos tarde sigue siendo «a tiempo» (verde); hasta `TARDE_MIN`, ámbar; más, rojo. */
export const A_TIEMPO_MIN = 10;
export const TARDE_MIN = 30;

/** Cómo se dice el desvío: «−5 min» / «+12 min» y su tono. «a tiempo» si es exacto. */
export function textoDelDesvio(min: number | null, es: boolean): { texto: string; tono: "verde" | "ambar" | "rojo" } | null {
  if (min === null) return null;
  const tono = min <= A_TIEMPO_MIN ? "verde" : min <= TARDE_MIN ? "ambar" : "rojo";
  if (min === 0) return { texto: es ? "a tiempo" : "on time", tono };
  return { texto: `${min > 0 ? "+" : "−"}${Math.abs(min)} min`, tono };
}
