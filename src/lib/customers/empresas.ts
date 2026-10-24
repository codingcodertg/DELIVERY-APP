import { claveDeEmpresa, codigoDeTienda, juntaEnMemoria, motivosDeLaCola, type MotivoDeSospecha, type PasoDeUnion } from "./duplicados";
import { CAMPOS, coincide, estaArchivado, ordenarEnNiveles, TIENDAS, type Cliente, type Filtro, type Orden } from "./reglas";

/**
 * Clientes por EMPRESA (migración 189): la lista pinta UNA fila por empresa —la compañía con sus filas de cada
 * tienda— y la ficha cambia de tienda. El dueño (2026-10-21): «en la misma aplicación vas a tener uno en Browser, uno
 * en Far […] puedes cambiar las tiendas y va a display otro content information y otro rep».
 *
 * Puro, sin navegador: lo prueban `empresas.test.ts`. Quién es la misma empresa lo dice `company_id` (lo pone la
 * base); aquí solo se agrupa, se filtra, se elige qué fila enseñar y se cuenta.
 */
export interface Empresa {
  clave: string;
  /** Todas las filas de la empresa en la vista (vivas, o archivadas con el chip), en orden de tienda. */
  filas: Cliente[];
  /** Las que pasan el filtro (tienda, estado, QB, búsqueda): de ellas sale la que se enseña. */
  coinciden: Cliente[];
  /** La fila que se pinta en la tabla: con un filtro de tienda, la de esa tienda. */
  principal: Cliente;
}

const rangoTienda = (code: string) => { const i = TIENDAS.findIndex((t) => t.code === codigoDeTienda(code)); return i < 0 ? TIENDAS.length : i; };
/** Las filas de una empresa en el orden de las pestañas: por tienda (el de `TIENDAS`), y a igualdad por id. */
export const enOrdenDeTienda = (filas: readonly Cliente[]): Cliente[] =>
  [...filas].sort((a, b) => rangoTienda(a.store) - rangoTienda(b.store) || a.store.localeCompare(b.store) || a.id - b.id);

/** Cuántos campos de la ficha tiene llenos una fila. */
export const camposLlenos = (c: Cliente): number => CAMPOS.filter((f) => { const v = c[f.key]; return v !== null && v !== undefined && String(v).trim() !== ""; }).length;

/**
 * La fila que representa a la empresa entre las que coinciden: la más completa (más campos llenos), y a igualdad la
 * más vieja (id menor), para que no cambie de un día a otro sin motivo.
 */
export function principalDe(filas: readonly Cliente[]): Cliente {
  return [...filas].sort((a, b) => camposLlenos(b) - camposLlenos(a) || a.id - b.id)[0];
}

/** El filtro de una FILA, sin el de archivados (eso lo decide la vista): tienda, estado, QB y búsqueda. */
function filaCoincide(c: Cliente, f: Filtro): boolean {
  if (f.tienda && codigoDeTienda(c.store) !== f.tienda) return false;
  if (f.estado === "none" ? !!c.status_store : f.estado && c.status_store !== f.estado) return false;
  if (f.qb && c.qb_status !== f.qb) return false;
  return coincide(c, f.busca);
}

/**
 * Las empresas de la vista: se agrupan las filas vivas (o las archivadas, con el chip; nunca mezcladas) por empresa, y
 * sale la empresa si ALGUNA de sus filas pasa el filtro. Con «Pharr» elegido sale toda empresa con fila en Pharr, y se
 * enseña la fila de Pharr. Sin ordenar (eso es `ordenarEmpresas`).
 */
export function agrupaEnEmpresas(lista: readonly Cliente[], f: Filtro): Empresa[] {
  const grupos = new Map<string, Cliente[]>();
  for (const c of lista) {
    if (estaArchivado(c) !== f.archivados) continue;
    const k = claveDeEmpresa(c);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(c);
  }
  const out: Empresa[] = [];
  for (const [clave, filas] of grupos) {
    const coinciden = filas.filter((c) => filaCoincide(c, f));
    if (!coinciden.length) continue;
    out.push({ clave, filas: enOrdenDeTienda(filas), coinciden, principal: principalDe(coinciden) });
  }
  return out;
}

/**
 * Ordena por la fila que se enseña, con las mismas reglas que la lista por filas (`ordenar`). Un orden, o varios en
 * jerarquía (D-650: el primero manda, los siguientes desempatan; `ordenarEnNiveles`).
 */
export function ordenarEmpresas(empresas: readonly Empresa[], orden: Orden | readonly Orden[]): Empresa[] {
  const porId = new Map(empresas.map((e) => [e.principal.id, e]));
  const niveles: readonly Orden[] = "por" in orden ? [orden] : orden;
  return ordenarEnNiveles(empresas.map((e) => e.principal), niveles, (c) => tiendasDeLaEmpresa(porId.get(c.id)!)).map((c) => porId.get(c.id)!);
}

/**
 * En cuántas tiendas DISTINTAS está la empresa (D-NEXT, la columna «N.º tiendas»): sus filas de la vista, todas, no solo
 * las que pasan el filtro de tienda. El dueño, 2026-10-24: «counts them so I can sort largest to smallest and see who
 * buys in multiple locations».
 */
export function tiendasDeLaEmpresa(e: Pick<Empresa, "filas">): number {
  return new Set(e.filas.map((c) => codigoDeTienda(c.store))).size;
}

/** Cuántas EMPRESAS tienen fila en cada tienda (no cuántas filas): lo que dicen los chips de tienda. */
export function empresasPorTienda(empresas: readonly Empresa[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of empresas) for (const t of new Set(e.filas.map((c) => codigoDeTienda(c.store)))) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

/** Las pestañas de la ficha: las filas de la empresa de `c` en su mismo estado (vivas con vivas, archivadas con archivadas). */
export function filasDeLaEmpresa(lista: readonly Cliente[], c: Cliente): Cliente[] {
  const k = claveDeEmpresa(c);
  return enOrdenDeTienda(lista.filter((x) => claveDeEmpresa(x) === k && estaArchivado(x) === estaArchivado(c)));
}

// ---- La cola «Decidir si se juntan» ---------------------------------------------------------------------------------

export interface Sugerencia {
  id: number;
  a_id: number;
  b_id: number;
  reason: string;
  score: number | null;
  status: "pending" | "merged" | "rejected" | "superseded";
  created_at: string | null;
}

export function sugerenciaDeLaBase(f: Record<string, unknown>): Sugerencia {
  const st = String(f.status ?? "pending");
  return {
    id: Number(f.id), a_id: Number(f.a_id), b_id: Number(f.b_id), reason: String(f.reason ?? ""),
    score: f.score === null || f.score === undefined || f.score === "" ? null : Number(f.score),
    status: (["pending", "merged", "rejected", "superseded"].includes(st) ? st : "pending") as Sugerencia["status"],
    created_at: typeof f.created_at === "string" ? f.created_at : null,
  };
}

export interface ParParaDecidir { sugerencia: Sugerencia; a: Cliente; b: Cliente; motivos: MotivoDeSospecha[] }

/**
 * Lo que se enseña en «Decidir si se juntan»: las PENDIENTES cuyas dos filas existen, están vivas y siguen en
 * empresas distintas (si alguien las juntó o archivó por otro lado, ya no hay nada que decidir). Primero las de más
 * motivos, luego las de nombre más parecido.
 */
export function paresParaDecidir(sugerencias: readonly Sugerencia[], lista: readonly Cliente[]): ParParaDecidir[] {
  const porId = new Map(lista.map((c) => [c.id, c]));
  const out: ParParaDecidir[] = [];
  for (const s of sugerencias) {
    if (s.status !== "pending") continue;
    const a = porId.get(s.a_id), b = porId.get(s.b_id);
    if (!a || !b || estaArchivado(a) || estaArchivado(b) || claveDeEmpresa(a) === claveDeEmpresa(b)) continue;
    out.push({ sugerencia: s, a, b, motivos: motivosDeLaCola(s.reason) });
  }
  return out.sort((p, q) => q.motivos.length - p.motivos.length || (q.sugerencia.score ?? 0) - (p.sugerencia.score ?? 0) || p.sugerencia.id - q.sugerencia.id);
}

type T = (en: string, es: string) => string;

/** Lo que avisa a la barra de que la cola cambió (juntar o rechazar), para que vuelva a contar. */
export const EVENTO_DE_LA_COLA = "rtg-clientes-cola";

/** El rótulo de la pestaña de la cola en la barra, con cuántas quedan por decidir si se sabe (null = no se sabe). */
export function rotuloDeDecidir(pendientes: number | null, t: T): string {
  const base = t("Decide to merge", "Decidir si se juntan");
  return pendientes && pendientes > 0 ? `${base} (${pendientes})` : base;
}

export function motivoDeSospechaLabel(m: MotivoDeSospecha, t: T): string {
  switch (m) {
    case "cuenta_unificada": return t("Same unified account (Excel)", "Misma cuenta unificada (Excel)");
    case "nombre_parecido": return t("Very similar name", "Nombre muy parecido");
    case "nombre_contenido": return t("One name contains the other", "Un nombre contiene al otro");
    case "telefono": return t("Same phone", "Mismo teléfono");
    case "correo": return t("Same email", "Mismo correo");
  }
}

/**
 * Qué pasará si se pulsa «Juntar»: la MISMA cuenta que hace la base (`juntaEnMemoria`, espejo de `erp.junta_clientes`)
 * sobre la lista que se ve. Para decirlo antes: en qué tiendas queda la empresa y qué filas de una misma tienda se
 * unen en una.
 */
export function vistaPreviaDeJuntar(lista: readonly Cliente[], aId: number, bId: number): { tiendas: string[]; pasos: PasoDeUnion[] } {
  const r = juntaEnMemoria(lista, aId, bId, new Date(0).toISOString(), () => "vista-previa");
  const a = r.filas.find((c) => c.id === aId)!;
  const tiendas = [...new Set(r.filas.filter((c) => claveDeEmpresa(c) === claveDeEmpresa(a) && !estaArchivado(c)).map((c) => codigoDeTienda(c.store)))];
  return { tiendas: tiendas.sort((x, y) => rangoTienda(x) - rangoTienda(y)), pasos: r.pasos };
}
