/**
 * Lo que el VENDEDOR ve, abre y busca en Clientes (D-NEXT, 2026-10-29; migración 215).
 *
 * El dueño: «Si ellos buscan algo en el search, pueden buscar cualquier cliente a nivel de toda la database. Ellos solo
 * pueden ver los clientes de su propia tienda y solo pueden abrir los que son sus clientes. Los demás clientes no se
 * pueden abrir, pero por eso vas a cortar que ahora solo puedan ver las siguientes columnas: cuenta, número de tiendas,
 * estado y vendedor. […] Vas a remover la opción de customize columnas». Y al crear: «says vendedor, and automatically
 * the system should put their name, and they should not be able to search any other's name».
 *
 * - **La lista:** la base (215) le manda su tienda entera más los suyos; la pantalla pinta SOLO estas cuatro columnas,
 *   sin selector ni arrastre de cabeceras.
 * - **Abrir:** solo los suyos (`rep_id` = él, o los que creó él). Los demás se ven en la fila y no se abren.
 * - **Buscar:** con dos letras o más, además de lo cargado, `erp.busca_clientes_en_toda_la_empresa` (toda la base, pocas
 *   columnas). Lo que llegue de ahí y no esté ya en la lista se pinta como fila que no se abre.
 * - **Alta:** el vendedor es él, puesto de antemano y sin desplegable.
 */
import { COLUMNAS, type Cliente, type Columna } from "./reglas";

export const COLUMNAS_DEL_VENDEDOR: readonly string[] = ["account", "store_count", "status_store", "rep_id"];
export const MIN_LETRAS_DE_BUSQUEDA = 2;
/** Un respiro entre teclas antes de preguntar a la base. */
export const RETARDO_DE_BUSQUEDA_MS = 300;

/** Las cuatro, en el orden canónico de `COLUMNAS`; ignora cualquier preferencia guardada. */
export function columnasDelVendedor(): Columna[] {
  return COLUMNAS.filter((c) => COLUMNAS_DEL_VENDEDOR.includes(c.key as string));
}

/** ¿Puede esta persona abrir la ficha? Quien no es vendedor, siempre; el vendedor, solo los suyos. */
export function puedeAbrirCliente(c: Pick<Cliente, "rep_id" | "created_by">, yo: { esVendedor: boolean; userId: string }): boolean {
  if (!yo.esVendedor) return true;
  return (!!c.rep_id && c.rep_id === yo.userId) || (!!c.created_by && c.created_by === yo.userId);
}

/** ¿Se pregunta a toda la empresa con esto escrito? */
export function seBuscaEnTodaLaEmpresa(busca: string, esVendedor: boolean): boolean {
  return esVendedor && busca.trim().length >= MIN_LETRAS_DE_BUSQUEDA;
}

/** Una fila de la búsqueda (pocas columnas) como `Cliente`, con lo demás vacío. */
export function clienteDeBusqueda(f: Record<string, unknown>): Cliente {
  const texto = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
  return {
    id: Number(f.id), store: String(f.store ?? ""), account: String(f.account ?? ""), unified_account: texto(f.unified_account),
    house_no: null, added_batch: null, qb_status: null, activity_status: null, status_store: texto(f.status_store), status_group: null,
    history_store: null, history_group: null, crm_type_store: null, crm_type_group: null, associated_with: null,
    rep_history: null, rep_qb: null, rep_store: null, contact_name: null, contact_title: null, address: null, phone: null, email: null,
    credit_limit: null, euler_limit: null, terms: null, account_no: null, notes: null, updated_at: null, updated_by: null,
    archived_at: texto(f.archived_at), archived_reason: null, company_id: texto(f.company_id), contacts: null, socials: null,
    tax_terms: null, website: null, rep_id: texto(f.rep_id), rep_name: texto(f.rep_name), created_by: null,
  };
}

/** La lista cargada más lo encontrado en toda la empresa que no esté ya en ella. */
export function conLosEncontrados(lista: readonly Cliente[], encontrados: readonly Cliente[]): Cliente[] {
  const ids = new Set(lista.map((c) => c.id));
  return [...lista, ...encontrados.filter((c) => !ids.has(c.id))];
}
