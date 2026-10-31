import { conVendedores, nombresDeVendedores, type Vendedor } from "./vendedores";
import { creaUnaPorUna } from "./alta";
import type { AlmacenDeClientes } from "./almacen";
import type { ArchivoDeCliente } from "./archivos";
import { claveDeEmpresa, juntaEnMemoria, motivoDeLaCola, sospechosos } from "./duplicados";
import type { Sugerencia } from "./empresas";
import type { Cliente, Parche } from "./reglas";
import { cuerpoDeSolicitud, solicitudDeLaBase, type SolicitudDeCliente } from "./solicitud-de-cliente";
import { cuerpoDeEdicion, historialDeLaBase, type HistorialDeCliente } from "./edicion-como-solicitud";

/**
 * Clientes INVENTADOS para el modo demo (`NEXT_PUBLIC_LOCAL_MODE`), que no tiene base. Ni un dato real: los nombres
 * dicen «Demo», los teléfonos son 555-01xx y los correos acaban en example.com. Fijos —no al azar— para que una
 * captura de hoy y otra de mañana enseñen lo mismo. Los estados, historiales y tiendas sí son los del Excel, porque
 * son clasificación nuestra y la pantalla los traduce.
 */
/** D-683: los vendedores del demo (los de Leads). */
export const VENDEDORES_DEMO: readonly Vendedor[] = [{ id: "demo-ana", full_name: "Ana Demo" }, { id: "demo-beto", full_name: "Beto Demo" }];
const NOMBRES_DEMO = nombresDeVendedores(VENDEDORES_DEMO);

const base = (n: number, c: Partial<Cliente>): Cliente => ({
  id: n, store: "MCA", account: `Demo Builder ${n}`, unified_account: null, house_no: n, added_batch: "1", qb_status: "ACTIVE",
  activity_status: null, status_store: null, status_group: null, history_store: null, history_group: null,
  crm_type_store: null, crm_type_group: null, associated_with: null, rep_history: null, rep_qb: null, rep_store: null, rep_id: null, rep_name: null, contact_name: null, contact_title: null, address: null, phone: null, email: null,
  credit_limit: null, euler_limit: null, terms: null, account_no: null, notes: null, updated_at: "2026-10-16T12:00:00Z", updated_by: null,
  archived_at: null, archived_reason: null, company_id: `demo-empresa-${n}`,
  ...c,
});

export const CLIENTES_DEMO: Cliente[] = [
  // 1 y 2 son la MISMA empresa en dos tiendas (189): la lista pinta una fila y la ficha cambia de tienda.
  base(1, { store: "MCA", account: "Demo Homes LLC", company_id: "demo-empresa-1", unified_account: "Demo Homes LLC", status_store: "ACTIVE INC", status_group: "ACTIVE INC", history_store: "LARGE", history_group: "LARGE", rep_store: "IM", rep_qb: "IM", rep_history: "IM", rep_id: "demo-ana", rep_name: "Ana Demo", contact_name: "Ana Demo", contact_title: "Owner", phone: "555-0101", email: "ana@example.com", terms: "Net 30", credit_limit: 20000, euler_limit: 50000, account_no: "EULER", crm_type_store: "LARGE", crm_type_group: "LARGE", associated_with: "DEMO GROUP",
    // D-668: cinco contactos (193), para que la ficha enseñe tres pastillas y «+2».
    contacts: [
      { name: "ANA DEMO", title: "OWNER", phones: ["(956) 555-0101", "(956) 555-0111"], emails: ["ana@example.com", "pagos@example.com"], note: null },
      { name: "LUIS DEMO", title: "A/P", phones: ["(956) 555-0121"], emails: ["luis@example.com"], note: "solo para POs" },
      { name: "MARTA DEMO", title: "OFFICE", phones: ["(956) 555-0131"], emails: [], note: null },
      { name: "PEDRO DEMO", title: null, phones: [], emails: ["pedro@example.com"], note: null },
      { name: "SOFIA DEMO", title: "PM", phones: ["(956) 555-0141"], emails: [], note: null },
    ] }),
  base(2, { store: "PHR", account: "Demo Homes LLC", company_id: "demo-empresa-1", unified_account: "Demo Homes LLC", status_store: "ACTIVE DEC", status_group: "ACTIVE INC", history_store: "SMALL", history_group: "LARGE", rep_store: "FR", rep_qb: "IM", rep_history: "IM", phone: "555-0101", email: "ana@example.com", terms: "Net 30", credit_limit: 20000 }),
  base(3, { store: "BRO", account: "Demo Drywall Inc", status_store: "NEW", status_group: "NEW", history_store: "INSIGNIFICANT", history_group: "SMALL", rep_store: "CRR", phone: "956-555-0102", terms: "Due on receipt" }),
  base(4, { store: "EDG", account: "Demo Tile Gallery", status_store: "LOST", status_group: "LOST", history_store: "MID", history_group: "MID", rep_store: "YG", rep_qb: "YG", phone: "956-555-0104 - Luis, A/P", email: "gallery@example.com", tax_terms: "exempt", website: "demotilegallery.example.com", terms: "25 Days", credit_limit: 6000, account_no: "INTERNAL CREDIT" }),
  base(5, { store: "WES", account: "Demo Walk-in", qb_status: "NOT FOUND IN UPDATE", activity_status: "walk in", status_store: "NONE SALE", status_group: "NONE SALE", history_store: "INSIGNIFICANT", history_group: "INSIGNIFICANT" }),
  base(6, { store: "MCA", account: "Demo Construction Group", status_store: "ACTIVE INC", history_store: "MID", rep_store: "SCG", contact_name: "Beto Demo", phone: "(555) 010-3", email: "beto@example.com", terms: "NET 15", credit_limit: 10000, notes: "Demo note." }),
  // Dos SOSPECHOSOS para «Decidir si se juntan» (189): 9 se parece a 3 y tiene su teléfono, en otra tienda (juntar =
  // misma empresa); 10 se parece a 6 en la MISMA tienda (juntar = una sola fila, la 10 se archiva).
  base(9, { store: "EDG", account: "Demo Drywal Inc", status_store: "ACTIVE INC", history_store: "SMALL", rep_store: "YG", phone: "(956) 555-0102", contact_name: "Carla Demo" }),
  base(10, { store: "MCA", account: "Demo Construction Grp", status_store: "NONE SALE", rep_store: "IM", phone: "(555) 010-3", contact_title: "Owner", credit_limit: 5000, notes: "Otra nota demo." }),
  // Dos archivados (181), para que el chip «Archivados» y la ficha atenuada tengan qué enseñar en el demo.
  base(7, { store: "PHR", account: "VENTA AL MOSTRADOR", activity_status: "Internal", archived_at: "2026-10-16T13:00:00Z", archived_reason: "comodin de QuickBooks" }),
  base(8, { store: "MCA", account: "Demo Supplies Co", activity_status: "Supplier", archived_at: "2026-10-16T13:00:00Z", archived_reason: "interno/proveedor/competencia" }),
];

/** Las sugerencias del demo: las que encuentra la MISMA función que llena la cola de verdad (`sospechosos`). */
export const SUGERENCIAS_DEMO: Sugerencia[] = sospechosos(CLIENTES_DEMO).map((s, i) => ({
  id: i + 1, a_id: s.a_id, b_id: s.b_id, reason: motivoDeLaCola(s.motivos), score: s.score, status: "pending", created_at: "2026-10-21T12:00:00Z",
}));

/**
 * El almacén del demo: la misma interfaz que la base, sobre listas en memoria. Todo el mundo puede escribir. UNO por
 * pestaña (no uno por pantalla): al ir de la lista a «Decidir si se juntan» y volver, lo juntado sigue juntado.
 */
let compartido: AlmacenDeClientes | null = null;
export function almacenDemo(): AlmacenDeClientes {
  if (!compartido) compartido = almacenDemoNuevo();
  return compartido;
}

export function almacenDemoNuevo(): AlmacenDeClientes {
  let lista = CLIENTES_DEMO.map((c) => ({ ...c }));
  let cola = SUGERENCIAS_DEMO.map((s) => ({ ...s }));
  let siguiente = Math.max(...lista.map((c) => c.id)) + 1;
  let empresaNueva = 0;
  let archivos: ArchivoDeCliente[] = [];
  // D-743 (216): las solicitudes de cliente nuevo, en memoria.
  let solicitudes: SolicitudDeCliente[] = [];
  let solicitudNueva = 0;
  // D-780 (221): el historial, en memoria; lo escribe `guardar` (como el disparador) y las decisiones de edición.
  let historial: HistorialDeCliente[] = [];
  let historialNuevo = 0;
  const apunta = (h: Omit<HistorialDeCliente, "id" | "at" | "by" | "by_name" | "requested_name"> & Partial<Pick<HistorialDeCliente, "requested_name">>) => {
    historial = [historialDeLaBase({ ...h, id: ++historialNuevo, at: new Date().toISOString(), by: "demo", by_name: "Demo", requested_name: h.requested_name ?? null }), ...historial];
  };
  const diff = (antes: Cliente, despues: Cliente) => {
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const k of Object.keys(despues) as (keyof Cliente)[]) {
      if (k === "updated_at" || k === "updated_by" || k === "rep_name") continue;
      if (JSON.stringify(antes[k] ?? null) !== JSON.stringify(despues[k] ?? null)) { before[k] = antes[k] ?? null; after[k] = despues[k] ?? null; }
    }
    return { before, after };
  };
  let archivoNuevo = 0;
  const enlaces = new Map<number, string>();
  const sinFila = { ok: false as const, sinTabla: false, sinPermiso: true, duplicado: false, error: "not saved: no row came back" };
  const almacen: AlmacenDeClientes = {
    async leer() { return { ok: true, valor: lista.map((c) => ({ ...c })) }; },
    async solicitarAlta(parche, tiendas) {
      const c = cuerpoDeSolicitud(parche, tiendas);
      if (!c.stores.length) return { ok: false, sinTabla: false, sinPermiso: false, duplicado: false, error: "no store chosen" };
      const s = solicitudDeLaBase({ id: ++solicitudNueva, requested_by: "demo", requested_name: "Demo", stores: c.stores, payload: c.payload, status: "pending", created_at: new Date().toISOString() });
      solicitudes = [s, ...solicitudes];
      return { ok: true, valor: { ...s } };
    },
    async solicitudes() { return { ok: true, valor: solicitudes.map((s) => ({ ...s })) }; },
    async solicitarEdicion(cliente, parche, nota) {
      const c = cuerpoDeEdicion(cliente, parche, nota);
      if (!Object.keys(c.payload).length) return { ok: false, sinTabla: false, sinPermiso: false, duplicado: false, error: "nothing changed" };
      const s = solicitudDeLaBase({ id: ++solicitudNueva, requested_by: "demo", requested_name: "Demo", status: "pending", created_at: new Date().toISOString(), ...c });
      solicitudes = [s, ...solicitudes];
      return { ok: true, valor: { ...s } };
    },
    async aprobarEdicion(id, nota) {
      const s = solicitudes.find((x) => x.id === id);
      if (!s || s.status !== "pending" || s.kind !== "edicion" || s.customer_id === null) return { ok: false, sinTabla: false, sinPermiso: false, duplicado: false, error: "request not pending" };
      const antes = lista.find((c) => c.id === s.customer_id);
      if (!antes) return sinFila;
      const r = await almacen.guardar(s.customer_id, s.payload as Parche);
      if (!r.ok) return r;
      // La fila que dejó `guardar` ('edit') se reescribe como 'approved', con la solicitud y las notas (como hace el disparador).
      historial = historial.map((h, i) => (i === 0 && h.customer_id === s.customer_id ? { ...h, kind: "approved", note: s.note, request_id: id, requested_by: s.requested_by, requested_name: s.requested_name, decision_note: nota.trim() || null } : h));
      solicitudes = solicitudes.map((x) => (x.id === id ? { ...x, status: "approved", decided_at: new Date().toISOString(), decision_note: nota.trim() || null } : x));
      return { ok: true, valor: null };
    },
    async historial(clienteId) { return { ok: true, valor: historial.filter((h) => h.customer_id === clienteId).map((h) => ({ ...h })) }; },
    async aprobarSolicitud(id) {
      const s = solicitudes.find((x) => x.id === id);
      if (!s || s.status !== "pending") return { ok: false, sinTabla: false, sinPermiso: false, duplicado: false, error: "request not pending" };
      const r = await almacen.crearVarias(s.stores.map((store) => ({ ...(s.payload as Parche), store, company_id: `demo-solicitud-${id}` })));
      if (!r.ok) return r;
      const ids = r.valor.creados.map((c) => c.id);
      solicitudes = solicitudes.map((x) => (x.id === id ? { ...x, status: "approved", decided_at: new Date().toISOString(), created_ids: ids } : x));
      return { ok: true, valor: ids };
    },
    async rechazarSolicitud(id, nota) {
      const s = solicitudes.find((x) => x.id === id);
      if (!s || s.status !== "pending") return { ok: false, sinTabla: false, sinPermiso: false, duplicado: false, error: "request not pending" };
      solicitudes = solicitudes.map((x) => (x.id === id ? { ...x, status: "rejected", decided_at: new Date().toISOString(), decision_note: nota.trim() || null } : x));
      if (s.kind === "edicion" && s.customer_id !== null) apunta({ customer_id: s.customer_id, kind: "rejected", before: s.before, after: s.payload, note: s.note, request_id: id, requested_by: s.requested_by, requested_name: s.requested_name, decision_note: nota.trim() || null });
      return { ok: true, valor: null };
    },
    async buscarEnTodaLaEmpresa(q) {
      const s = q.trim().toLowerCase();
      return { ok: true, valor: lista.filter((c) => c.account.toLowerCase().includes(s)).map((c) => ({ ...c })) };
    },
    async vendedores() { return { ok: true, valor: VENDEDORES_DEMO.map((v) => ({ ...v })) }; },
    async asignarVendedor(ids, repId) { return almacen.guardarVarios(ids, { rep_id: repId }); },
    async guardarVarios(ids, parche: Parche) {
      const set = new Set(ids);
      let n = 0;
      lista = lista.map((c) => {
        if (!set.has(c.id)) return c;
        n++;
        return conVendedores([{ ...c, ...(parche as Partial<Cliente>) }], NOMBRES_DEMO)[0];
      });
      return { ok: true, valor: n };
    },
    async guardar(id, parche: Parche) {
      const i = lista.findIndex((c) => c.id === id);
      if (i < 0) return sinFila;
      const nuevo = conVendedores([{ ...lista[i], ...(parche as Partial<Cliente>), updated_at: new Date().toISOString() } as Cliente], NOMBRES_DEMO)[0];
      {
        const d = diff(lista[i], nuevo);
        if (Object.keys(d.after).length) apunta({ customer_id: id, kind: lista[i].archived_at === null && nuevo.archived_at !== null ? "archive" : lista[i].archived_at !== null && nuevo.archived_at === null ? "restore" : "edit", before: d.before, after: d.after, note: null, request_id: null, requested_by: null, decision_note: null });
      }
      lista = lista.map((c, j) => (j === i ? nuevo : c));
      return { ok: true, valor: { ...nuevo } };
    },
    async crear(fila: Parche) {
      // Como el índice único de la 180 (`customers_store_account_unico`): una cuenta por tienda, sin mayúsculas ni espacios.
      const clave = (c: { store?: unknown; account?: unknown }) => `${String(c.store ?? "").trim().toUpperCase()}|${String(c.account ?? "").trim().toLowerCase()}`;
      if (lista.some((c) => clave(c) === clave(fila))) {
        return { ok: false, sinTabla: false, sinPermiso: false, duplicado: true, error: "duplicate key value violates unique constraint" };
      }
      const nuevo = conVendedores([base(siguiente++, { ...(fila as Partial<Cliente>), updated_at: new Date().toISOString() })], NOMBRES_DEMO)[0];
      lista = [...lista, nuevo];
      return { ok: true, valor: { ...nuevo } };
    },
    async crearVarias(filas: Parche[]) { return creaUnaPorUna(filas, (f) => almacen.crear(f)); },
    async sugerencias() { return { ok: true, valor: cola.filter((s) => s.status === "pending").map((s) => ({ ...s })) }; },
    async juntar(aId, bId) {
      try {
        const r = juntaEnMemoria(lista, aId, bId, new Date().toISOString(), () => `demo-junta-${++empresaNueva}`);
        lista = r.filas;
        const a = lista.find((c) => c.id === aId)!;
        // Como la base: este par, decidido; y lo pendiente que ya queda dentro de una empresa, también.
        const misma = (s: Sugerencia) => {
          const x = lista.find((c) => c.id === s.a_id), y = lista.find((c) => c.id === s.b_id);
          return !!x && !!y && claveDeEmpresa(x) === claveDeEmpresa(y);
        };
        cola = cola.map((s) => (s.status === "pending" && ((s.a_id === Math.min(aId, bId) && s.b_id === Math.max(aId, bId)) || misma(s)) ? { ...s, status: "merged" } : s));
        return { ok: true, valor: claveDeEmpresa(a) };
      } catch (e) {
        return { ok: false, sinTabla: false, sinPermiso: false, duplicado: false, error: (e as Error).message };
      }
    },
    async rechazar(id) {
      const s = cola.find((x) => x.id === id && x.status === "pending");
      if (!s) return { ok: false, sinTabla: false, sinPermiso: false, duplicado: false, error: "That suggestion is not pending" };
      cola = cola.map((x) => (x.id === id ? { ...x, status: "rejected" } : x));
      return { ok: true, valor: null };
    },
    // D-672: los archivos del demo, en memoria (el fichero, como un enlace del propio navegador).
    async archivos(clienteId) { return { ok: true, valor: archivos.filter((a) => a.customer_id === clienteId).map((a) => ({ ...a })) }; },
    async subirArchivo(clienteId, fichero, clase) {
      const a: ArchivoDeCliente = { id: ++archivoNuevo, customer_id: clienteId, kind: clase, name: fichero.name, path: `${clienteId}/${fichero.name}`,
        size_bytes: fichero.size, content_type: fichero.type || null, uploaded_at: new Date().toISOString() };
      enlaces.set(a.id, typeof URL !== "undefined" && URL.createObjectURL ? URL.createObjectURL(fichero) : "about:blank");
      archivos = [a, ...archivos];
      return { ok: true, valor: { ...a } };
    },
    async quitarArchivo(a) { archivos = archivos.filter((x) => x.id !== a.id); return { ok: true, valor: null }; },
    async enlaceDeArchivo(a) { return { ok: true, valor: enlaces.get(a.id) ?? "about:blank" }; },
  };
  return almacen;
}
