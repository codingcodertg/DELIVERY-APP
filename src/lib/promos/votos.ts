import type { DecisionDeGrupo, EstadoDeDecision } from "@/lib/promos/tabla";

/**
 * D-840: «would like to be able to click and see who voted what» (Roberto Rodriguez Jr, admin).
 *
 * Al pulsar la Decisión de un producto se ve, grupo por grupo de tiendas, qué decidió cada uno, quién y cuándo.
 * Sin React: la pantalla solo pinta esto.
 *
 * Lo que la base guarda es UNA decisión por (ronda, producto, grupo): la última. Si alguien cambió su voto, se ve el
 * de ahora, no el de antes.
 */
export interface VotoDeGrupo {
  grupo: string;
  estado: EstadoDeDecision;
  /** Nombre de quien decidió; null si nadie ha decidido todavía (o la persona ya no existe). */
  quien: string | null;
  cuando: string | null;
  precio: number | null;
  nota: string | null;
}

/** Lo que llega de la base para enseñar los votos: la decisión con quién y cuándo. */
export type DecisionConAutor = DecisionDeGrupo & { decided_by?: string | null; decided_at?: string | null };

/**
 * Los votos de un producto: todos los grupos del libro (los que aún no decidieron, en «Pendiente») más cualquier
 * grupo con decisión que ya no esté en el libro. Ordenados por grupo.
 */
export function votosDelProducto(
  code: string,
  decisiones: readonly DecisionConAutor[],
  grupos: readonly string[],
  nombres: Readonly<Record<string, string>>,
): VotoDeGrupo[] {
  const delProducto = new Map<string, DecisionConAutor>();
  for (const d of decisiones) if (d.code === code) delProducto.set(d.group_code, d);
  const todos = Array.from(new Set([...grupos, ...delProducto.keys()]));
  return todos
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((grupo) => {
      const d = delProducto.get(grupo);
      // Una fila «pending» con autor es alguien que deshizo su decisión: se dice quién.
      return {
        grupo,
        estado: d?.status ?? "pending",
        quien: d?.decided_by ? nombres[d.decided_by] ?? null : null,
        cuando: d && d.decided_by ? d.decided_at ?? null : null,
        precio: d?.price ?? null,
        nota: d?.note ?? null,
      };
    });
}

/** Cuántos grupos aprobaron, rechazaron o siguen pendientes, para la cabecera del panel. */
export function cuentaDeVotos(votos: readonly VotoDeGrupo[]): Record<EstadoDeDecision, number> {
  const c: Record<EstadoDeDecision, number> = { pending: 0, approved: 0, rejected: 0 };
  for (const v of votos) c[v.estado]++;
  return c;
}
