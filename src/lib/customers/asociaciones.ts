import { coincide, estaArchivado, nombreDeTienda, type Cliente } from "./reglas";
import { enOrdenDeTienda, principalDe } from "./empresas";

/**
 * D-884 (249): «En asociación con» — la asociación entre clientes. Simbólica: no cambia filtros, órdenes, permisos ni
 * nada más. Es entre EMPRESAS (`company_id`, 189), no entre filas: todas las tiendas de una empresa la ven. Simétrica:
 * una sola fila por par en `erp.customer_associations`; si A está con B, B está con A.
 *
 * Puro, sin navegador: lo prueba `asociaciones.test.ts`. La base exige lo mismo (índice único least/greatest, el check
 * de «no consigo misma» y la RLS de quien escribe).
 */

/** Una fila de la tabla. */
export interface ParDeEmpresas { id: number; company_a: string; company_b: string }

/** Una asociada de una empresa, como la devuelve `erp.asociados_de_la_empresa` (o la arma la demo). */
export interface Asociado {
  /** El id del PAR (para quitarlo). */
  id: number;
  company_id: string;
  account: string;
  stores: string[];
  crm_type: string | null;
  /** Todas sus filas están archivadas. */
  archivado: boolean;
}

const limpio = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase();

/** El par normalizado (menor, mayor) o null si es la misma empresa o falta alguna. */
export function parNormalizado(a: string | null | undefined, b: string | null | undefined): { company_a: string; company_b: string } | null {
  const x = limpio(a);
  const y = limpio(b);
  if (!x || !y || x === y) return null;
  return x < y ? { company_a: x, company_b: y } : { company_a: y, company_b: x };
}

/** La clave de un par sin orden: A·B y B·A son la misma. */
export const claveDePar = (a: string, b: string): string => {
  const p = parNormalizado(a, b);
  return p ? `${p.company_a}|${p.company_b}` : "";
};

/** Las empresas asociadas a `empresa` según los pares: miran los dos lados, sin repetir y nunca ella misma. */
export function asociadasDe(empresa: string | null | undefined, pares: readonly ParDeEmpresas[]): string[] {
  const yo = limpio(empresa);
  if (!yo) return [];
  const vistas = new Set<string>();
  for (const p of pares) {
    const a = limpio(p.company_a);
    const b = limpio(p.company_b);
    if (a === b) continue;
    const otra = a === yo ? b : b === yo ? a : null;
    if (otra) vistas.add(otra);
  }
  return [...vistas];
}

/** Los pares sin repetidos (A·B y B·A cuentan una vez; se queda el primero) ni consigo misma. */
export function paresSinRepetir<T extends ParDeEmpresas>(pares: readonly T[]): T[] {
  const vistos = new Set<string>();
  return pares.filter((p) => {
    const k = claveDePar(p.company_a, p.company_b);
    if (!k || vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

/** ¿Se puede asociar `a` con `b`? No consigo misma ni dos veces. */
export function puedeAsociar(a: string | null | undefined, b: string | null | undefined, yaAsociadas: readonly string[]): boolean {
  if (!parNormalizado(a, b)) return false;
  return !yaAsociadas.map(limpio).includes(limpio(b));
}

/** Un candidato del buscador: una empresa (no una fila), con sus tiendas y su tipo. */
export interface CandidatoDeAsociacion { company_id: string; cliente: Cliente; account: string; stores: string[]; crm_type: string | null }

export const tipoDe = (c: Pick<Cliente, "crm_type_group" | "crm_type_store">): string | null =>
  (c.crm_type_group ?? "").trim() || (c.crm_type_store ?? "").trim() || null;

/**
 * El buscador: las empresas de `lista` que casan con `busca` (la misma búsqueda de la lista de Clientes, `coincide`:
 * nombre, contacto, correo, teléfono…), sin la propia ni las ya asociadas, sin archivadas, una vez por empresa.
 * Con menos de dos letras (o tres dígitos), nada.
 */
export function candidatosParaAsociar(lista: readonly Cliente[], propia: string | null | undefined, yaAsociadas: readonly string[], busca: string, max = 8): CandidatoDeAsociacion[] {
  const q = busca.trim();
  if (q.replace(/\D/g, "").length < 3 && q.length < 2) return [];
  const fuera = new Set([limpio(propia), ...yaAsociadas.map(limpio)]);
  const porEmpresa = new Map<string, Cliente[]>();
  for (const c of lista) {
    const k = limpio(c.company_id);
    if (!k || fuera.has(k) || estaArchivado(c)) continue;
    const filas = porEmpresa.get(k);
    if (filas) filas.push(c); else porEmpresa.set(k, [c]);
  }
  const salida: CandidatoDeAsociacion[] = [];
  for (const [k, filas] of porEmpresa) {
    if (!filas.some((c) => coincide(c, q))) continue;
    const p = principalDe(filas);
    const tipo = filas.map(tipoDe).find((x) => x) ?? null;
    salida.push({ company_id: k, cliente: p, account: p.account, stores: enOrdenDeTienda(filas).map((c) => c.store ?? "").filter(Boolean), crm_type: tipo });
  }
  return salida.sort((a, b) => a.account.localeCompare(b.account)).slice(0, max);
}

/** Lo que se ve de las tiendas en la pastilla: «Brownsville · McAllen». */
export const tiendasEnTexto = (stores: readonly string[]): string => [...new Set(stores)].map((s) => nombreDeTienda(s)).join(" · ");

/** Una fila de `erp.asociados_de_la_empresa`. */
export function asociadoDeLaBase(f: Record<string, unknown>): Asociado {
  return {
    id: Number(f.id),
    company_id: String(f.company_id ?? ""),
    account: typeof f.account === "string" ? f.account : "",
    stores: Array.isArray(f.stores) ? (f.stores as unknown[]).filter((s): s is string => typeof s === "string") : [],
    crm_type: typeof f.crm_type === "string" && f.crm_type.trim() ? f.crm_type.trim() : null,
    archivado: f.all_archived === true,
  };
}

/** Las asociadas armadas desde la lista en memoria (la demo): las mismas columnas que la función de la base. */
export function asociadosDesdeLaLista(empresa: string, pares: readonly ParDeEmpresas[], lista: readonly Cliente[]): Asociado[] {
  const yo = limpio(empresa);
  const salida: Asociado[] = [];
  for (const p of paresSinRepetir(pares)) {
    const a = limpio(p.company_a);
    const b = limpio(p.company_b);
    const otra = a === yo ? b : b === yo ? a : null;
    if (!otra) continue;
    const filas = lista.filter((c) => limpio(c.company_id) === otra);
    if (!filas.length) continue;
    const vivas = filas.filter((c) => !estaArchivado(c));
    const pr = principalDe(vivas.length ? vivas : filas);
    salida.push({ id: p.id, company_id: otra, account: pr.account, stores: enOrdenDeTienda(vivas).map((c) => c.store ?? "").filter(Boolean), crm_type: filas.map(tipoDe).find((x) => x) ?? null, archivado: vivas.length === 0 });
  }
  return salida.sort((x, y) => x.account.localeCompare(y.account));
}

// ---------------------------------------------------------------------------------------------------------------------
// D-886 (250): varias a la vez, solo desde la edición, y con aprobación. El admin de Clientes aplica directo; vendedor y
// gerente proponen: cada alta o baja es una solicitud ('asociacion') que el admin aprueba en «Solicitudes de cliente».
// El no admin solo busca (y solo puede proponer) empresas con alguna fila en sus tiendas. La base lo exige
// (erp.busca_clientes_para_asociar y erp.propone_asociaciones); esto es el espejo para la demo y las pruebas.
// ---------------------------------------------------------------------------------------------------------------------

/** Una empresa del buscador de asociaciones (`erp.busca_clientes_para_asociar`). */
export interface EmpresaParaAsociar { company_id: string; account: string; stores: string[]; crm_type: string | null }

/** Una propuesta abierta (pendiente o en «Revisar») de una empresa (`erp.asociaciones_pendientes`). */
export interface AsociacionPendiente { id: number; op: "add" | "remove"; company_id: string; account: string; status: "pending" | "review" }

/** Lo que devuelve proponer: cuántas se aplicaron (admin) y las solicitudes creadas (los demás). */
export interface ResultadoDePropuesta { aplicadas: number; solicitudes: number[] }

const codigo = (s: string | null | undefined): string => (s ?? "").trim().toUpperCase();

/** ¿Tiene la empresa ALGUNA fila en una de mis tiendas? El admin, siempre. Espejo de erp.empresa_en_mis_tiendas. */
export function empresaEnMisTiendas(filas: readonly Pick<Cliente, "store">[], misTiendas: readonly string[], esAdmin: boolean): boolean {
  if (esAdmin) return true;
  const mias = new Set(misTiendas.map(codigo).filter(Boolean));
  return filas.some((f) => mias.has(codigo(f.store)));
}

/** El buscador con la regla de tiendas: el no admin solo ve las empresas que tienen alguna fila en sus tiendas. */
export function buscaParaAsociar(lista: readonly Cliente[], propia: string | null | undefined, yaAsociadas: readonly string[], busca: string, misTiendas: readonly string[], esAdmin: boolean, max = 8): EmpresaParaAsociar[] {
  const todas = candidatosParaAsociar(lista, propia, yaAsociadas, busca, Number.MAX_SAFE_INTEGER);
  return todas
    .filter((c) => empresaEnMisTiendas(lista.filter((f) => limpio(f.company_id) === c.company_id), misTiendas, esAdmin))
    .slice(0, max)
    .map(({ company_id, account, stores, crm_type }) => ({ company_id, account, stores, crm_type }));
}

/**
 * El aviso bajo el buscador de asociaciones. El cuadro NUNCA se bloquea (se escribe siempre); lo que no se puede buscar
 * se DICE aquí en vez de callarlo: sin tiendas en el perfil (el no admin no encontraría nada), un fallo de la base, o
 * «no coincide» con las tiendas en las que se buscó. `null` = sin aviso.
 */
export type AvisoDelBuscador = "sinTiendas" | "error" | "nadaEnMisTiendas" | "nada" | null;
export function avisoDelBuscador({ esAdmin, misTiendas, q, error, hay }: {
  esAdmin: boolean; misTiendas: readonly string[] | null; q: string; error: boolean; hay: boolean;
}): AvisoDelBuscador {
  if (!esAdmin && misTiendas !== null && misTiendas.map(codigo).filter(Boolean).length === 0) return "sinTiendas";
  if (q.trim().length < 2) return null;
  if (error) return "error";
  if (hay) return null;
  return esAdmin ? "nada" : "nadaEnMisTiendas";
}

/** Lo que se manda al guardar: las elegidas que aún no están (ni pendientes), y las marcadas para quitar que existen. */
export function planDeCambios(asociados: readonly Asociado[], pendientes: readonly AsociacionPendiente[], elegidas: readonly string[], quitar: readonly number[]): { add: string[]; remove: number[] } {
  const ya = new Set(asociados.map((a) => limpio(a.company_id)));
  const enEspera = new Set(pendientes.filter((p) => p.op === "add").map((p) => limpio(p.company_id)));
  const quitaEnEspera = new Set(pendientes.filter((p) => p.op === "remove").map((p) => limpio(p.company_id)));
  const add = [...new Set(elegidas.map(limpio))].filter((c) => c && !ya.has(c) && !enEspera.has(c));
  const remove = [...new Set(quitar)].filter((id) => {
    const a = asociados.find((x) => x.id === id);
    return !!a && !quitaEnEspera.has(limpio(a.company_id));
  });
  return { add, remove };
}

export function pendienteDeLaBase(f: Record<string, unknown>): AsociacionPendiente {
  return {
    id: Number(f.id),
    op: f.op === "remove" ? "remove" : "add",
    company_id: String(f.company_id ?? ""),
    account: typeof f.account === "string" ? f.account : "",
    status: f.status === "review" ? "review" : "pending",
  };
}

export function resultadoDeLaBase(v: unknown): ResultadoDePropuesta {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return { aplicadas: Number(o.applied ?? 0) || 0, solicitudes: Array.isArray(o.requests) ? o.requests.map(Number).filter(Number.isFinite) : [] };
}

/** El texto de una solicitud de asociación: «Add association with X» / «Remove association with X». */
export function textoDeSolicitudDeAsociacion(payload: Record<string, unknown>, t: (en: string, es: string) => string): string {
  const otra = typeof payload.associated_customer === "string" && payload.associated_customer ? payload.associated_customer : "?";
  return payload.op === "remove" ? t(`Remove association with ${otra}`, `Quitar asociación con ${otra}`) : t(`Add association with ${otra}`, `Añadir asociación con ${otra}`);
}
