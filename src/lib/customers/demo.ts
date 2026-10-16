import type { AlmacenDeClientes } from "./almacen";
import type { Cliente, Parche } from "./reglas";

/**
 * Clientes INVENTADOS para el modo demo (`NEXT_PUBLIC_LOCAL_MODE`), que no tiene base. Ni un dato real: los nombres
 * dicen «Demo», los teléfonos son 555-01xx y los correos acaban en example.com. Fijos —no al azar— para que una
 * captura de hoy y otra de mañana enseñen lo mismo. Los estados, historiales y tiendas sí son los del Excel, porque
 * son clasificación nuestra y la pantalla los traduce.
 */
const base = (n: number, c: Partial<Cliente>): Cliente => ({
  id: n, store: "MCA", account: `Demo Builder ${n}`, unified_account: null, house_no: n, added_batch: "1", qb_status: "ACTIVE",
  activity_status: null, status_store: null, status_group: null, history_store: null, history_group: null,
  rep_history: null, rep_qb: null, rep_store: null, contact_name: null, contact_title: null, address: null, phone: null, email: null,
  credit_limit: null, euler_limit: null, terms: null, account_no: null, notes: null, updated_at: "2026-10-16T12:00:00Z", updated_by: null,
  ...c,
});

export const CLIENTES_DEMO: Cliente[] = [
  base(1, { store: "MCA", account: "Demo Homes LLC", unified_account: "Demo Homes LLC", status_store: "ACTIVE INC", status_group: "ACTIVE INC", history_store: "LARGE", history_group: "LARGE", rep_store: "IM", rep_qb: "IM", rep_history: "IM", contact_name: "Ana Demo", contact_title: "Owner", phone: "555-0101", email: "ana@example.com", terms: "Net 30", credit_limit: 20000, euler_limit: 50000, account_no: "EULER" }),
  base(2, { store: "PHR", account: "Demo Homes LLC", unified_account: "Demo Homes LLC", status_store: "ACTIVE DEC", status_group: "ACTIVE INC", history_store: "SMALL", history_group: "LARGE", rep_store: "FR", rep_qb: "IM", rep_history: "IM", phone: "555-0101", email: "ana@example.com", terms: "Net 30", credit_limit: 20000 }),
  base(3, { store: "BRO", account: "Demo Drywall Inc", status_store: "NEW", status_group: "NEW", history_store: "INSIGNIFICANT", history_group: "SMALL", rep_store: "CRR", phone: "555-0102", terms: "Due on receipt" }),
  base(4, { store: "EDG", account: "Demo Tile Gallery", status_store: "LOST", status_group: "LOST", history_store: "MID", history_group: "MID", rep_store: "YG", rep_qb: "YG", email: "gallery@example.com", terms: "25 Days", credit_limit: 6000, account_no: "INTERNAL CREDIT" }),
  base(5, { store: "WES", account: "Demo Walk-in", qb_status: "NOT FOUND IN UPDATE", activity_status: "walk in", status_store: "NONE SALE", status_group: "NONE SALE", history_store: "INSIGNIFICANT", history_group: "INSIGNIFICANT" }),
  base(6, { store: "MCA", account: "Demo Construction Group", status_store: "ACTIVE INC", history_store: "MID", rep_store: "SCG", contact_name: "Beto Demo", phone: "(555) 010-3", email: "beto@example.com", terms: "NET 15", credit_limit: 10000, notes: "Demo note." }),
];

/** El almacén del demo: la misma interfaz que la base, sobre una lista en memoria. Todo el mundo puede escribir. */
export function almacenDemo(): AlmacenDeClientes {
  let lista = CLIENTES_DEMO.map((c) => ({ ...c }));
  let siguiente = lista.length + 1;
  return {
    async leer() { return { ok: true, valor: lista.map((c) => ({ ...c })) }; },
    async guardar(id, parche: Parche) {
      const i = lista.findIndex((c) => c.id === id);
      if (i < 0) return { ok: false, sinTabla: false, sinPermiso: true, duplicado: false, error: "not saved: no row came back" };
      const nuevo = { ...lista[i], ...(parche as Partial<Cliente>), updated_at: new Date().toISOString() } as Cliente;
      lista = lista.map((c, j) => (j === i ? nuevo : c));
      return { ok: true, valor: { ...nuevo } };
    },
    async crear(fila: Parche) {
      const nuevo = base(siguiente++, { ...(fila as Partial<Cliente>), updated_at: new Date().toISOString() });
      lista = [...lista, nuevo];
      return { ok: true, valor: { ...nuevo } };
    },
  };
}
