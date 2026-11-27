// ============================================================
// Listas de conteo en el demo (D-941): las funciones de la migración 330, en memoria, para que la pantalla se pueda
// probar sin base. El estado vive en el módulo (el proceso del servidor de demo): dura hasta reiniciar el servidor.
// Las validaciones son las mismas que en SQL (mismos códigos de error), y los conteos enviados no llegan a la tabla
// de conteos del demo (esa es estática): aquí solo se ve la lista como quedó registrada.
// ============================================================
import { PERFIL_ERP_DEMO, TIENDAS_DEMO, productosDemo, existenciasDemo, type Fila } from "@/lib/erp/demo-data";
import { TOPE_DE_ALTA } from "@/lib/erp/listas-de-conteo";
import { hoyCentral } from "@/lib/hoy-central";

type Args = Record<string, unknown> | undefined;

type ListaDemo = {
  id: number; store_id: string; name: string; status: "open" | "submitted";
  created_by: string; created_at: string; updated_by: string; updated_at: string;
  submitted_by: string | null; submitted_at: string | null;
};
type RenglonDemo = {
  id: number; list_id: number; product_id: number; counted_qty: number | null; counted_at: string | null;
  counted_by: string | null; cycle_count_id: number | null; system_at_submit: number | null;
};

const NOMBRES: Record<string, string> = { "demo-erp-admin": PERFIL_ERP_DEMO.full_name, "demo-ana": "Ana Demo", "demo-beto": "Beto Demo" };
const nombreDe = (id: string | null) => (id ? NOMBRES[id] ?? null : null);

const listas: ListaDemo[] = [];
const renglones: RenglonDemo[] = [];
let siguiente = 1;

function alta(store_id: string, name: string, ahora: Date, status: "open" | "submitted" = "open"): ListaDemo {
  const lista: ListaDemo = {
    id: siguiente++, store_id, name, status, created_by: PERFIL_ERP_DEMO.id, created_at: ahora.toISOString(),
    updated_by: PERFIL_ERP_DEMO.id, updated_at: ahora.toISOString(),
    submitted_by: status === "submitted" ? "demo-ana" : null, submitted_at: status === "submitted" ? ahora.toISOString() : null,
  };
  listas.push(lista);
  return lista;
}

/** Semilla: una lista abierta a medio contar y una ya enviada (de solo lectura), para ver las dos en la pantalla. */
export function reiniciarListasDemo(ahora: Date = new Date()) {
  listas.length = 0; renglones.length = 0; siguiente = 1;
  const abierta = alta("T1", `Count T1 ${hoyCentral(ahora)}`, ahora);
  const semilla: [number, number | null][] = [[1, 12], [2, null], [3, 4], [4, null]];
  for (const [productId, qty] of semilla) {
    renglones.push({
      id: siguiente++, list_id: abierta.id, product_id: productId, counted_qty: qty,
      counted_at: qty === null ? null : ahora.toISOString(), counted_by: qty === null ? null : PERFIL_ERP_DEMO.id,
      cycle_count_id: null, system_at_submit: null,
    });
  }
  const enviada = alta("T1", "Count T1 demo (enviada)", ahora, "submitted");
  renglones.push({
    id: siguiente++, list_id: enviada.id, product_id: 5, counted_qty: 7, counted_at: ahora.toISOString(),
    counted_by: "demo-ana", cycle_count_id: 900, system_at_submit: 9,
  });
}
reiniciarListasDemo();

const tiendaNombre = (id: string) => TIENDAS_DEMO.find((t) => t.id === id)?.name ?? null;
const qohDe = (storeId: string, productId: number) =>
  Number(existenciasDemo().find((e) => e.store_id === storeId && e.product_id === productId)?.qoh ?? 0);

function cabecera(l: ListaDemo) {
  return {
    id: l.id, store_id: l.store_id, store_name: tiendaNombre(l.store_id), name: l.name, status: l.status,
    created_at: l.created_at, created_by_name: nombreDe(l.created_by), updated_at: l.updated_at,
    updated_by_name: nombreDe(l.updated_by), submitted_at: l.submitted_at, submitted_by_name: nombreDe(l.submitted_by),
  };
}

function lista(id: unknown): ListaDemo {
  const l = listas.find((x) => x.id === Number(id));
  if (!l) throw new Error("LIST_NOT_FOUND");
  return l;
}
function abiertaOrThrow(l: ListaDemo) {
  if (l.status !== "open") throw new Error("LIST_CLOSED");
}
function renglon(id: unknown): RenglonDemo {
  const r = renglones.find((x) => x.id === Number(id));
  if (!r) throw new Error("LINE_NOT_FOUND");
  return r;
}

function renglonJson(r: RenglonDemo, productos: Fila[], l: ListaDemo) {
  const p = productos.find((x) => x.id === r.product_id) ?? {};
  const contado = r.counted_qty !== null;
  return {
    id: r.id, product_id: r.product_id, sku: p.sku ?? "", name: p.name ?? "", vendor_name: p.vendor_name ?? null,
    category_path: p.category_path ?? null, base_unit: p.base_unit ?? null, counted_qty: r.counted_qty, counted_at: r.counted_at,
    counted_by_name: nombreDe(r.counted_by), cycle_count_id: r.cycle_count_id,
    // Igual que en SQL: sin contar no hay existencia; enviada la lista, la que quedó registrada.
    system_qty: !contado ? null : r.system_at_submit ?? qohDe(l.store_id, r.product_id),
  };
}

/** Las funciones de la 330 para el cliente de demo. Cada una lanza un Error con el código de la base si falla. */
export function rpcsListasDemo(ahora: Date): Record<string, (a: Args) => unknown> {
  const productos = () => productosDemo(ahora);
  const lineasDe = (l: ListaDemo) => renglones.filter((r) => r.list_id === l.id).sort((a, b) => a.id - b.id);
  return {
    count_lists_list: () => {
      const orden = [...listas].sort((a, b) =>
        Number(b.status === "open") - Number(a.status === "open") || b.updated_at.localeCompare(a.updated_at) || b.id - a.id);
      return orden.map((l) => ({
        ...cabecera(l), lines: lineasDe(l).length, counted: lineasDe(l).filter((r) => r.counted_qty !== null).length,
      }));
    },
    count_list_detail: (a) => {
      const l = lista(a?.p_list_id);
      return { list: cabecera(l), lines: lineasDe(l).map((r) => renglonJson(r, productos(), l)) };
    },
    count_list_create: (a) => {
      const nombre = String(a?.p_name ?? "").trim();
      if (nombre.length < 1 || nombre.length > 120) throw new Error("LIST_NAME_INVALID");
      const tienda = String(a?.p_store_id ?? "");
      if (!TIENDAS_DEMO.some((t) => t.id === tienda)) throw new Error(`store ${tienda} not found`);
      return alta(tienda, nombre, ahora).id;
    },
    count_list_add_products: (a) => {
      const l = lista(a?.p_list_id);
      abiertaOrThrow(l);
      const ids = [...new Set(((a?.p_product_ids as number[] | null) ?? []).map(Number))];
      if (ids.length > TOPE_DE_ALTA) throw new Error("LIST_TOO_MANY");
      const existen = new Set(productos().map((p) => Number(p.id)));
      let added = 0;
      for (const pid of ids) {
        if (!existen.has(pid) || renglones.some((r) => r.list_id === l.id && r.product_id === pid)) continue;
        renglones.push({ id: siguiente++, list_id: l.id, product_id: pid, counted_qty: null, counted_at: null, counted_by: null, cycle_count_id: null, system_at_submit: null });
        added++;
      }
      if (added > 0) l.updated_at = ahora.toISOString();
      return { added };
    },
    count_list_set_qty: (a) => {
      const r = renglon(a?.p_line_id);
      const l = lista(r.list_id);
      abiertaOrThrow(l);
      const qty = a?.p_counted_qty == null ? null : Number(a.p_counted_qty);
      if (qty !== null && (!Number.isFinite(qty) || qty < 0)) throw new Error("QTY_INVALID");
      r.counted_qty = qty;
      r.counted_by = qty === null ? null : PERFIL_ERP_DEMO.id;
      r.counted_at = qty === null ? null : ahora.toISOString();
      l.updated_at = ahora.toISOString();
      return renglonJson(r, productos(), l);
    },
    count_list_remove_line: (a) => {
      const r = renglon(a?.p_line_id);
      const l = lista(r.list_id);
      abiertaOrThrow(l);
      renglones.splice(renglones.indexOf(r), 1);
      l.updated_at = ahora.toISOString();
      return null;
    },
    count_list_submit: (a) => {
      const l = lista(a?.p_list_id);
      abiertaOrThrow(l);
      const mias = lineasDe(l);
      if (mias.length === 0) throw new Error("LIST_EMPTY");
      if (mias.some((r) => r.counted_qty === null)) throw new Error("LIST_HAS_UNCOUNTED");
      for (const r of mias) {
        r.system_at_submit = qohDe(l.store_id, r.product_id);
        r.cycle_count_id = 900 + r.id;
      }
      Object.assign(l, { status: "submitted", submitted_by: PERFIL_ERP_DEMO.id, submitted_at: ahora.toISOString(), updated_at: ahora.toISOString() });
      return { recorded: mias.length };
    },
  };
}
