import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  TIPOS_DE_SOLICITUD, TIPOS_DEL_EJECUTOR, TIPOS_QUE_CREAN_BORRADOR, ESTADOS_DEL_SOLICITANTE, MODOS_DE_PRECIO,
  CAMPOS_DEL_ARTICULO, CAMPOS_DE_EDICION, MAPA_DE_LA_HOJA, ETIQUETA_SIN_SKU, ETIQUETA_NO_LISTA,
  etiquetaDeCampo, camposVisibles, articuloDesdeElFormulario, articuloCompleto, skuProvisional, filaBorrador,
  filaDeSolicitud, cambiosPropuestos, puedeDesactivar, esMigracionPendiente,
} from "./solicitud-campos";
import { statusLabel } from "./status";
import { ERP_MESSAGES } from "./messages";

/**
 * La solicitud de artículo del ERP, columna por columna de la hoja del dueño (2026-09-30): «en el erp en
 * solicitud quiero que me agregues esa columnas si aun no esta como fields par allenar». Aquí se mide
 * (a) que el mapa cubre las 32 columnas de su hoja y cada campo existe de verdad en la base (se lee la
 * 063), (b) qué viaja al servidor en cada tipo y para quién, (c) que las pantallas usan la librería y no
 * una copia, y (d) que la migración 158 es la 064 más lo que dice, con su registro al día.
 */
const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").replace(/\r\n/g, "\n");
const t = (en: string, es: string) => `${en}|${es}`;

/** Las 32 columnas de la hoja, en su orden, tal como las pasó el orquestador (de las dos capturas). */
const HOJA = [
  "Date", "Location", "Required by", "Executed by", "Request Change", "Reactivate", "Deactivate (if QOH = 0)",
  "Discontinue (same as deactivate but can still have QOH)", "Create New", "Create Copy", "Copy Source: Store & Item Code",
  "Requester Comments", "REQUESTER STATUS", "EXECUTOR STATUS", "Executor Comments", "Category", "Type", "Material", "Style",
  "Color", "Preferred Vendor", "Manufacturer's part number", "Description on purchase transactions", "Cost", "Shine", "Size",
  "SF/Box", "U/M", "Item Number (if known)", "Description on sales transactions", "Sales price", "Fixed Price or Levels",
];

/** Columnas de una tabla tal como las declara la 063 (`create table erp.X (...)`). */
function columnasDe063(tabla: string): string[] {
  const sql = leer("supabase/migrations/063_erp_module.sql");
  const i = sql.indexOf(`create table erp.${tabla} (`);
  const fin = sql.indexOf("\n);", i);
  return sql.slice(i, fin).split("\n").slice(1).map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
}

describe("la hoja del dueño, columna por columna", () => {
  it("el mapa cubre las 32 columnas de la hoja, en su orden, y ninguna más", () => {
    expect(MAPA_DE_LA_HOJA.map((c) => c.excel)).toEqual(HOJA);
  });
  it("cada campo que dice vivir en products es una columna de erp.products en la 063", () => {
    const cols = columnasDe063("products");
    for (const c of MAPA_DE_LA_HOJA.filter((x) => x.donde === "products")) expect(cols, c.excel).toContain(c.campo);
  });
  it("cada campo que dice vivir en product_requests es una columna de la 063, o la que añade la 158, o va dentro del payload", () => {
    const cols = columnasDe063("product_requests");
    const sql158 = leer("supabase/migrations/158_erp_solicitud_campos.sql");
    for (const c of MAPA_DE_LA_HOJA.filter((x) => x.donde === "product_requests")) {
      if (c.campo.startsWith("payload.")) continue;
      if (cols.includes(c.campo)) continue;
      expect(sql158, c.excel).toContain(`add column ${c.campo} text`);
    }
  });
  it("los seis tipos: cuatro de la 063 y dos nuevos (discontinue, copy); el ejecutor atiende cuatro y dos crean borrador", () => {
    const tipos = MAPA_DE_LA_HOJA.filter((x) => x.donde === "tipo");
    expect(tipos.map((x) => x.campo).sort()).toEqual([...TIPOS_DE_SOLICITUD].sort());
    expect(tipos.filter((x) => !x.existia).map((x) => x.campo)).toEqual(["discontinue", "copy"]);
    expect(TIPOS_DEL_EJECUTOR).toEqual(["edit", "reactivate", "deactivate", "discontinue"]);
    expect(TIPOS_QUE_CREAN_BORRADOR).toEqual(["new", "copy"]);
    expect([...TIPOS_DEL_EJECUTOR, ...TIPOS_QUE_CREAN_BORRADOR].sort()).toEqual([...TIPOS_DE_SOLICITUD].sort());
  });
  it("lo NUEVO para el formulario son exactamente: style, color1, description, price, price_mode, requester_status y copy_source", () => {
    expect(MAPA_DE_LA_HOJA.filter((x) => !x.existia && x.donde !== "tipo").map((x) => x.campo)).toEqual([
      "payload.copy_source", "requester_status", "style", "color1", "description", "price", "price_mode",
    ]);
  });
  it("los campos del artículo siguen el orden de la hoja (el estado comercial, que la hoja no tiene, va tras el tipo)", () => {
    const pos = new Map(MAPA_DE_LA_HOJA.map((c, i) => [c.campo, i]));
    const orden = CAMPOS_DEL_ARTICULO.filter((c) => c.key !== "status").map((c) => pos.get(c.key));
    expect(orden.every((x) => x !== undefined)).toBe(true);
    expect(orden).toEqual([...orden].sort((a, b) => a! - b!));
    expect(CAMPOS_DEL_ARTICULO.findIndex((c) => c.key === "status")).toBe(CAMPOS_DEL_ARTICULO.findIndex((c) => c.key === "product_type") + 1);
  });
  it("cada campo tiene rótulo en los dos idiomas, y etiquetaDeCampo lo devuelve por su clave", () => {
    for (const c of [...CAMPOS_DEL_ARTICULO, ...CAMPOS_DE_EDICION]) {
      expect(c.en.length, c.key).toBeGreaterThan(0);
      expect(c.es.length, c.key).toBeGreaterThan(0);
      expect(etiquetaDeCampo(c.key, t)).toBe(`${c.en}|${c.es}`);
    }
    expect(etiquetaDeCampo("sku", t)).toBe("Item number (if known)|Número de artículo (si se sabe)");
    expect(etiquetaDeCampo("description", t)).toContain("purchase transactions");
    expect(etiquetaDeCampo("name", t)).toContain("sales transactions");
    expect(etiquetaDeCampo("finish", t)).toContain("Shine");
    expect(etiquetaDeCampo("x_desconocido", t)).toBe("x_desconocido");
  });
  it("status.ts conoce los seis tipos y los dos estados del solicitante, en dos idiomas distintos", () => {
    for (const v of [...TIPOS_DE_SOLICITUD, ...ESTADOS_DEL_SOLICITANTE]) {
      const p = statusLabel(v);
      expect(p.en, v).not.toBe(v);
      expect(p.es, v).not.toBe(v);
      expect(p.en, v).not.toBe(p.es);
    }
    expect(statusLabel("discontinue")).toEqual({ en: "Discontinue", es: "Descontinuar" });
    expect(statusLabel("copy")).toEqual({ en: "Create copy", es: "Crear copia" });
    expect(statusLabel("not_ready")).toEqual({ en: "Not ready", es: "No lista" });
  });
  it("el costo solo lo ve quien puede verlo; el precio de venta lo ven todos", () => {
    expect(camposVisibles(CAMPOS_DEL_ARTICULO, false).map((c) => c.key)).not.toContain("cost");
    expect(camposVisibles(CAMPOS_DEL_ARTICULO, true).map((c) => c.key)).toContain("cost");
    expect(camposVisibles(CAMPOS_DEL_ARTICULO, false).map((c) => c.key)).toContain("price");
    expect(camposVisibles(CAMPOS_DE_EDICION, false).map((c) => c.key)).not.toContain("cost");
    expect(camposVisibles(CAMPOS_DE_EDICION, true).map((c) => c.key)).toContain("cost");
  });
});

const EJEMPLO: Record<string, string> = {
  category_id: "7", product_type: "tile", status: "active", material: "", style: "STONE", color1: "WHITE", vendor_id: "3",
  mpn: "", description: "OPUSCAR PEBBLES MOSAIC LIGHT 12 X 12 1SF", cost: "5.35", finish: "", size_in: "12X12", sf_per_box: "1",
  base_unit: "EA", sku: "e-102", name: "OPUSCAR PEBBLES MOSAIC LIGHT 12 X 12 1SF", price: "14.99", price_mode: "fixed", reason: "fila 2",
};

describe("lo que viaja en una solicitud new / copy", () => {
  it("el costo viaja solo si quien pide puede verlo; un campo en blanco no viaja", () => {
    const staff = articuloDesdeElFormulario(EJEMPLO, { canSeeCost: false, store: "BRO", requesterStatus: "ready" });
    expect(staff.cost).toBeUndefined();
    expect(staff.mpn).toBeUndefined();
    expect(staff.material).toBeUndefined();
    expect(staff).toMatchObject({ sku: "e-102", name: EJEMPLO.name, category_id: 7, vendor_id: 3, style: "STONE", color1: "WHITE", price: "14.99", price_mode: "fixed", store: "BRO", reason: "fila 2", requester_status: "ready" });
    expect(staff.copy_source).toBeUndefined();
    const mgr = articuloDesdeElFormulario(EJEMPLO, { canSeeCost: true, store: "", requesterStatus: "not_ready", copySource: { store: "BRO", item_code: "E-101", product_id: 9, sku: "E-101" } });
    expect(mgr.cost).toBe("5.35");
    expect(mgr.store).toBeUndefined();
    expect(mgr.requester_status).toBe("not_ready");
    expect(mgr.copy_source).toEqual({ store: "BRO", item_code: "E-101", product_id: 9, sku: "E-101" });
  });
  it("obligatorios: categoría, tipo, estado y descripción en ventas; para azulejo además tamaño, SF/caja y U/M; el SKU no", () => {
    expect(articuloCompleto(EJEMPLO)).toBe(true);
    expect(articuloCompleto({ ...EJEMPLO, sku: "" })).toBe(true);
    expect(articuloCompleto({ ...EJEMPLO, name: " " })).toBe(false);
    expect(articuloCompleto({ ...EJEMPLO, category_id: "" })).toBe(false);
    expect(articuloCompleto({ ...EJEMPLO, size_in: "" })).toBe(false);
    expect(articuloCompleto({ ...EJEMPLO, product_type: "tool", size_in: "", sf_per_box: "", base_unit: "" })).toBe(true);
  });
  it("la fila borrador: el SKU en mayúsculas; sin SKU nace REQ-… con la etiqueta NEEDS SKU; NO LISTA lleva NOT READY", () => {
    const con = filaBorrador(articuloDesdeElFormulario(EJEMPLO, { canSeeCost: true, store: "BRO", requesterStatus: "ready" }), "u1");
    expect(con).toMatchObject({ sku: "E-102", record_status: "draft", created_by: "u1", style: "STONE", color1: "WHITE", description: EJEMPLO.description, price: 14.99, price_mode: "fixed", cost: 5.35, needs_review: false, review_tags: [] });
    const sin = filaBorrador(articuloDesdeElFormulario({ ...EJEMPLO, sku: " " }, { canSeeCost: false, store: "", requesterStatus: "not_ready" }), "u1", 1727700000000);
    expect(sin.sku).toBe(skuProvisional(1727700000000));
    expect(sin.sku).toMatch(/^REQ-[A-Z0-9]+$/);
    expect(sin.sku).toMatch(/^[A-Z0-9][A-Z0-9-]{0,63}$/); // products_sku_check
    expect(sin.review_tags).toEqual([ETIQUETA_SIN_SKU, ETIQUETA_NO_LISTA]);
    expect(sin.needs_review).toBe(true);
    expect("cost" in sin).toBe(false);
    const soloNoLista = filaBorrador(articuloDesdeElFormulario(EJEMPLO, { canSeeCost: false, store: "", requesterStatus: "not_ready" }), "u1");
    expect(soloNoLista.review_tags).toEqual([ETIQUETA_NO_LISTA]);
    expect(filaBorrador(articuloDesdeElFormulario({ ...EJEMPLO, price_mode: "bad" }, { canSeeCost: false, store: "", requesterStatus: "ready" }), "u1").price_mode).toBeNull();
    expect(MODOS_DE_PRECIO).toEqual(["fixed", "leveled"]);
  });
  it("la fila de la solicitud: requester_status solo viaja cuando es not_ready (sin la 158 la columna no existe)", () => {
    const lista = filaDeSolicitud({ type: "new", requester: "u1", payload: { sku: "E-102" }, requester_status: "ready" });
    expect("requester_status" in lista).toBe(false);
    expect(lista).toEqual({ type: "new", product_id: null, requester: "u1", requester_store: null, reason: null, payload: { sku: "E-102" } });
    const noLista = filaDeSolicitud({ type: "discontinue", requester: "u1", product_id: 5, store: "BRO", reason: "x", requester_status: "not_ready" });
    expect(noLista).toEqual({ type: "discontinue", product_id: 5, requester: "u1", requester_store: "BRO", reason: "x", payload: {}, requester_status: "not_ready" });
    expect("requester_status" in filaDeSolicitud({ type: "edit", requester: "u1" })).toBe(false);
  });
  it("una solicitud de cambio propone solo lo que cambió, con las claves nuevas, y el costo solo si se ve", () => {
    const original = { name: "A", description: "", price: "10", price_mode: "", cost: "4", style: "", color1: "GRAY", mpn: "M1" };
    const editado = { ...original, description: "compras", price_mode: "leveled", cost: "5", style: "MARBLE", color1: "GRAY" };
    expect(cambiosPropuestos(editado, original, false)).toEqual({ description: "compras", price_mode: "leveled", style: "MARBLE" });
    expect(cambiosPropuestos(editado, original, true)).toEqual({ description: "compras", price_mode: "leveled", cost: "5", style: "MARBLE" });
    expect(cambiosPropuestos(original, original, true)).toEqual({});
  });
  it("Deactivate (if QOH = 0): con existencia no se desactiva; sin dato, es 0", () => {
    expect(puedeDesactivar(0)).toBe(true);
    expect(puedeDesactivar(null)).toBe(true);
    expect(puedeDesactivar(undefined)).toBe(true);
    expect(puedeDesactivar("")).toBe(true);
    expect(puedeDesactivar(-2)).toBe(true);
    expect(puedeDesactivar(3)).toBe(false);
    expect(puedeDesactivar("12.5")).toBe(false);
  });
  it("«migración pendiente» se reconoce por el enum viejo, la columna que falta o la función que falta; nada más", () => {
    expect(esMigracionPendiente({ code: "22P02", message: 'invalid input value for enum erp.request_type: "copy"' })).toBe(true);
    expect(esMigracionPendiente({ code: "42703", message: 'column "requester_status" of relation "product_requests" does not exist' })).toBe(true);
    expect(esMigracionPendiente({ code: "PGRST204", message: "Could not find the 'requester_status' column of 'product_requests' in the schema cache" })).toBe(true);
    expect(esMigracionPendiente({ code: "PGRST202", message: "Could not find the function erp.set_request_ready(p_ready, p_request_id) in the schema cache" })).toBe(true);
    expect(esMigracionPendiente({ code: "42883", message: "function erp.set_request_ready(bigint, boolean) does not exist" })).toBe(true);
    expect(esMigracionPendiente({ code: "22P02", message: 'invalid input syntax for type numeric: "x"' })).toBe(false);
    expect(esMigracionPendiente({ code: "23505", message: "duplicate key value violates unique constraint products_sku_key" })).toBe(false);
    expect(esMigracionPendiente(null)).toBe(false);
    expect(ERP_MESSAGES.MIGRATION_PENDING.en).toContain("migration 158");
    expect(ERP_MESSAGES.MIGRATION_PENDING.es).toContain("migración 158");
  });
});

describe("las pantallas y las acciones usan la librería (la prueba se alimenta de quien llama)", () => {
  const form = leer("src/components/erp/request-form.tsx");
  const actions = leer("src/lib/erp/actions.ts");
  it("el formulario pinta los seis tipos, los campos de la hoja, y manda lo que dice la librería", () => {
    expect(form).toMatch(/TIPOS_DE_SOLICITUD\.map\(/);
    expect(form).toMatch(/camposVisibles\(CAMPOS_DEL_ARTICULO, canSeeCost\)/);
    expect(form).toMatch(/camposVisibles\(CAMPOS_DE_EDICION, canSeeCost\)/);
    expect(form).toMatch(/const input = articuloDesdeElFormulario\(f, \{ canSeeCost, store, requesterStatus: ready, copySource: reqType === "copy" \? copySource : null \}\);\s*const res = await submitNewItem\(input\);/);
    expect(form).toMatch(/payload = cambiosPropuestos\(editForm, original, canSeeCost\);/);
    expect(form).toMatch(/const requiredOk = articuloCompleto\(f\) && \(reqType !== "copy" \|\| !!copySource\);/);
    expect(form).toMatch(/requester_status: ready,/);
    expect(form).toMatch(/store: store \|\| undefined,/);
    // Deactivate (if QOH = 0): el botón se apaga y el envío se corta.
    expect(form).toMatch(/const bloqueoDesactivar = reqType === "deactivate" && target && !puedeDesactivar\(target\.qoh\);/);
    expect(form).toMatch(/disabled=\{pending \|\| !target \|\| !reason\.trim\(\) \|\| !!bloqueoDesactivar\}/);
    expect(form).toMatch(/if \(bloqueoDesactivar\) return setErr\(/);
    // La copia: tienda + código de artículo; se busca por SKU y, si no, por el código de la tienda.
    expect(form).toMatch(/from\("app_store_products"\)\.select\("product_id"\)\.eq\("store_id", storeId\)\.eq\("qb_code", code\.trim\(\)\)/);
    expect(form).toMatch(/setCopySource\(\{ store: copyStore, item_code: copyCode\.trim\(\), product_id: m\.id, sku: m\.sku \}\)/);
    // El QOH viaja en la búsqueda (hace falta para la regla de desactivar).
    expect(form).toMatch(/const LOOKUP_COLS = "id,sku,name,status,qoh,/);
  });
  it("submitNewItem crea el borrador SIN returning (la RLS de lectura no deja al staff ver su borrador) y registra la solicitud con la librería", () => {
    const fn = actions.slice(actions.indexOf("export async function submitNewItem"), actions.indexOf("export async function submitRequest"));
    expect(fn).toMatch(/const row = filaBorrador\(input, user\.id\);/);
    expect(fn).toMatch(/await supabase\.from\("products"\)\.insert\(row\);/);
    expect(fn).not.toMatch(/\.insert\(row\)\.select/);
    expect(fn).toMatch(/const tipo: TipoDeSolicitud = input\.copy_source \? "copy" : "new";/);
    expect(fn).toMatch(/if \(\(tipo === "copy" \|\| input\.requester_status === "not_ready"\) && !\(await migracion158Aplicada\(supabase\)\)\) \{\s*return fail\("MIGRATION_PENDING"\);/);
    expect(fn).toMatch(/filaDeSolicitud\(\{\s*type: tipo,/);
    expect(fn).toMatch(/payload: \{ \.\.\.row, \.\.\.\(input\.copy_source \? \{ copy_source: input\.copy_source \} : \{\}\) \},/);
    expect(fn).toMatch(/if \(reqError\) return esMigracionPendiente\(reqError\) \? fail\("MIGRATION_PENDING"\)/);
  });
  it("la sonda de la 158 lee cero filas de la columna nueva, sin escribir", () => {
    expect(actions).toMatch(/await supabase\.from\("product_requests"\)\.select\("requester_status"\)\.limit\(0\);\s*return !error;/);
  });
  it("submitRequest acepta discontinue, pasa el estado del solicitante y traduce el enum viejo a «migración pendiente»", () => {
    const fn = actions.slice(actions.indexOf("export async function submitRequest"), actions.indexOf("export async function setRequestReady"));
    expect(fn).toMatch(/type: "edit" \| "reactivate" \| "deactivate" \| "discontinue";/);
    expect(fn).toMatch(/requester_status: input\.requester_status,/);
    expect(fn).toMatch(/if \(error\) return esMigracionPendiente\(error\) \? fail\("MIGRATION_PENDING"\)/);
  });
  it("setRequestReady llama a set_request_ready y degrada sin la 158", () => {
    const fn = actions.slice(actions.indexOf("export async function setRequestReady"));
    expect(fn).toMatch(/supabase\.rpc\("set_request_ready", \{ p_request_id: requestId, p_ready: ready \}\)/);
    expect(fn).toMatch(/esMigracionPendiente\(error\) \? fail\("MIGRATION_PENDING"\)/);
  });
  it("la cola de Aprobaciones atiende los tipos del ejecutor, cuenta los que crean borrador y lee `*` (requester_status solo existe con la 158)", () => {
    const pagina = leer("src/app/erp/requests/page.tsx");
    expect(pagina).toMatch(/\.in\("type", \[\.\.\.TIPOS_DEL_EJECUTOR\]\)/);
    expect(pagina).toMatch(/\.in\("type", \[\.\.\.TIPOS_QUE_CREAN_BORRADOR\]\)/);
    expect(pagina).toMatch(/from\("product_requests"\)\s*\.select\("\*"\)\s*\.eq\("status", "pending"\)/);
    expect(pagina).toMatch(/const EDITABLE = CAMPOS_DE_EDICION\.map\(\(c\) => c\.key\);/);
    expect(pagina).toMatch(/\.select\("id,sku,name,status,qoh," \+ EDITABLE\.join\(","\)\)/);
  });
  it("la revisión apaga «Aprobar» en una NO LISTA, pinta el rótulo de cada campo y la rama de descontinuar", () => {
    const rev = leer("src/components/erp/request-review.tsx");
    expect(rev).toMatch(/const noLista = r\.requester_status === "not_ready";/);
    expect(rev).toMatch(/onClick=\{\(\) => act\(r\.id, true\)\} disabled=\{pending \|\| noLista\}/);
    expect(rev).toMatch(/\{etiquetaDeCampo\(k, t\)\}/);
    expect(rev).toMatch(/r\.type === "discontinue" &&/);
    expect(rev).toMatch(/statusLabel\("discontinued"\)/);
    expect(rev).toMatch(/discontinue: "border-slate-200/);
    expect(rev).toMatch(/!puedeDesactivar\(r\.product\.qoh as number \| null\)/);
  });
  it("la página de solicitud trae tiendas y el vocabulario con style y color, lee `*` y enseña el estado del solicitante con su botón", () => {
    const pagina = leer("src/app/erp/request/page.tsx");
    expect(pagina).toMatch(/supabase\.from\("stores"\)\.select\("id,name"\)\.order\("id"\)/);
    expect(pagina).toMatch(/style: uniq\("style"\), color: uniq\("color"\)/);
    expect(pagina).toMatch(/from\("product_requests"\)\s*\.select\("\*"\)\s*\.eq\("requester", session\.user\.id\)/);
    expect(pagina).toMatch(/r\.status === "pending" && r\.requester_status && <RequestReadyToggle requestId=\{r\.id\} ready=\{!noLista\} \/>/);
    expect(pagina).toMatch(/<Tx en="Executor comments" es="Comentarios del ejecutor" \/>/);
    const toggle = leer("src/components/erp/request-ready-toggle.tsx");
    expect(toggle).toMatch(/await setRequestReady\(requestId, !ready\)/);
  });
  it("el panel de asignar SKU del detalle vale también para un borrador sin número de artículo (NEEDS SKU)", () => {
    expect(leer("src/components/erp/product-detail.tsx")).toMatch(/p\.review_tags\.includes\("PO IMPORT"\) \|\| p\.review_tags\.includes\("NEEDS SKU"\)/);
    expect(ETIQUETA_SIN_SKU).toBe("NEEDS SKU");
  });
});

describe("la migración 158 (escrita, NO aplicada: la aplica el orquestador tras el merge)", () => {
  const sql = leer("supabase/migrations/158_erp_solicitud_campos.sql");
  const codigo = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const bloque = (texto: string, cabecera: string) => {
    const i = texto.indexOf(cabecera);
    const fin = "end $function$;";
    return texto.slice(i, texto.indexOf(fin, i) + fin.length);
  };

  it("decide_request es la de la 064 letra por letra, más: el guard de NO LISTA, cuatro claves de edición y la rama discontinue", () => {
    const cab = "CREATE OR REPLACE FUNCTION erp.decide_request(p_request_id bigint, p_approve boolean, p_note text DEFAULT NULL::text)";
    const de064 = bloque(leer("supabase/migrations/064_erp_functions.sql"), cab);
    const de158 = bloque(sql, cab);
    expect(de064.length).toBeGreaterThan(3000);
    const l064 = de064.split("\n"), l158 = de158.split("\n");
    expect(l064.filter((l) => !l158.includes(l))).toEqual([]);
    const nuevas = l158.filter((l) => !l064.includes(l)).map((l) => l.trim());
    expect(nuevas.filter((l) => !l.startsWith("--"))).toEqual([
      "if r.requester_status = 'not_ready' then raise exception 'request % is not ready (requester status)', p_request_id; end if;",
      "description    = case when r.payload ? 'description'    then nullif(r.payload->>'description','')        else description end,",
      "price_mode     = case when r.payload ? 'price_mode'     then nullif(r.payload->>'price_mode','')         else price_mode end,",
      "style          = case when r.payload ? 'style'          then nullif(r.payload->>'style','')              else style end,",
      "color1         = case when r.payload ? 'color1'         then nullif(r.payload->>'color1','')             else color1 end,",
      "elsif r.type = 'discontinue' and r.product_id is not null then",
      "update erp.products set status = 'discontinued', updated_at = now() where id = r.product_id;",
    ]);
    expect(nuevas.filter((l) => l.startsWith("--")).every((l) => l.includes("158"))).toBe(true);
    // Las claves de edición de la librería son exactamente las que la función aplica.
    for (const c of CAMPOS_DE_EDICION) expect(de158, c.key).toContain(`r.payload ? '${c.key}'`);
  });
  it("el tipo pasa a texto con CHECK de los seis valores (y el enum se borra); requester_status con su CHECK y defecto ready", () => {
    expect(codigo).toContain("alter column type type text using type::text;");
    expect(codigo).toContain(`check (type in (${TIPOS_DE_SOLICITUD.map((x) => `'${x}'`).join(",")}));`);
    expect(codigo).toContain("drop type erp.request_type;");
    expect(codigo).toContain("add column requester_status text not null default 'ready'");
    expect(codigo).toContain(`check (requester_status in (${ESTADOS_DEL_SOLICITANTE.map((x) => `'${x}'`).join(",")}));`);
  });
  it("set_request_ready es DEFINER, solo pendientes, del solicitante o admin/manager, mueve la etiqueta NOT READY del borrador por el SKU del payload, y anon no la ejecuta", () => {
    const fn = bloque(sql, "create or replace function erp.set_request_ready(p_request_id bigint, p_ready boolean)");
    expect(fn).toContain(" security definer\n");
    expect(fn).toContain("if r.status <> 'pending' then raise exception 'request already %', r.status; end if;");
    expect(fn).toContain("if r.requester is distinct from auth.uid() and coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then");
    expect(fn).toContain("where sku = r.payload->>'sku' and record_status = 'draft';");
    expect(fn).toContain(`array_remove(review_tags, '${ETIQUETA_NO_LISTA}')`);
    expect(codigo).toContain("revoke execute on function erp.set_request_ready(bigint, boolean) from public, anon;");
    expect(codigo).toContain("grant execute on function erp.set_request_ready(bigint, boolean) to authenticated;");
  });
  it("product_vocabulary es la de la 064 más style y color", () => {
    const cab = "CREATE OR REPLACE FUNCTION erp.product_vocabulary()";
    const de064 = bloque(leer("supabase/migrations/064_erp_functions.sql"), cab);
    const de158 = bloque(sql, cab);
    const l064 = de064.split("\n"), l158 = de158.split("\n");
    const quitadas = l064.filter((l) => !l158.includes(l)).map((l) => l.trim());
    expect(quitadas).toEqual(["where finish is not null and btrim(finish) <> ''), '[]'::jsonb)"]);
    expect(l158.filter((l) => !l064.includes(l)).map((l) => l.trim())).toEqual([
      "where finish is not null and btrim(finish) <> ''), '[]'::jsonb),",
      "'style',     coalesce((select jsonb_agg(distinct style order by style)",
      "where style is not null and btrim(style) <> ''), '[]'::jsonb),",
      "'color',     coalesce((select jsonb_agg(distinct color1 order by color1)",
      "where color1 is not null and btrim(color1) <> ''), '[]'::jsonb)",
    ]);
  });
  it("no toca políticas, grants de tabla ni datos; se autocomprueba", () => {
    expect(codigo).not.toMatch(/create policy|drop policy|alter policy|grant (select|insert|update|delete|all) on|delete from erp\./i);
    // Un UPDATE de datos solo dentro de las funciones (sangrado); ninguno suelto al nivel del fichero.
    expect(codigo).not.toMatch(/^(update|insert into) erp\./im);
    expect(codigo).toContain("do $chk$");
    expect(codigo).toContain("if v_n <> 3 then raise exception '158: product_requests deberia seguir con 3 politicas");
  });
  it("sin begin/commit propios, sin el número de la decisión dentro, con reversión y su fila del registro al día", () => {
    expect(codigo).not.toMatch(/(^|;)\s*(begin|commit|rollback)\s*;/im);
    expect(sql).not.toContain("D-" + "NEXT");
    expect(sql).not.toMatch(/D-4\d\d/);
    expect(sql).toContain("--   3. drop function if exists erp.set_request_ready(bigint, boolean);");
    const [cuerpo, registro] = sql.split("-- @ledger-below");
    const sha = createHash("sha256").update(cuerpo, "utf8").digest("hex");
    expect(registro.trim()).toBe(`insert into public.schema_migrations (name, checksum) values ('158_erp_solicitud_campos.sql', '${sha}') on conflict (name) do nothing;`);
    expect(leer("docs/PLAN-158-erp-solicitud-campos.md")).toContain(`Checksum del registro: \`${sha}\``);
  });
});
