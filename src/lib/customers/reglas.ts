import type { UserRole } from "@/lib/types";

/**
 * «Clientes» (migración 180): las reglas de la pantalla, puras y probadas sin navegador. La base las vuelve a exigir
 * (RLS de la 180): aquí se decide qué se pinta y qué se ofrece; allí, qué se lee y qué se escribe.
 *
 * Es la lista maestra de clientes del Excel del dueño («REAL Master List Customers PRE DEC», hoja ALL: 1.349 filas,
 * cinco tiendas). Una fila por (tienda, cuenta); el mismo cliente puede estar en varias tiendas, y entonces comparten
 * `unified_account`.
 */
export interface Cliente {
  id: number;
  store: string;
  account: string;
  unified_account: string | null;
  house_no: number | null;
  added_batch: string | null;
  qb_status: string | null;
  activity_status: string | null;
  status_store: string | null;
  status_group: string | null;
  history_store: string | null;
  history_group: string | null;
  rep_history: string | null;
  rep_qb: string | null;
  rep_store: string | null;
  contact_name: string | null;
  contact_title: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  credit_limit: number | null;
  euler_limit: number | null;
  terms: string | null;
  account_no: string | null;
  notes: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

export type Lang = "en" | "es";
type T = (en: string, es: string) => string;

/**
 * Los códigos de tienda del Excel y su nombre en el hub. Los nombres son los de `profiles.store` medidos para Leads
 * (docs/PLAN-162-leads.md, decisión 1): RDZ Brownsville, RDZ Edinburg, RDZ McAllen, RDZ Pharr, RDZ Weslaco. En el
 * Excel no hay Mission. Un código que no esté aquí se enseña tal cual: no se inventa un nombre.
 */
export const TIENDAS: readonly { code: string; nombre: string }[] = [
  { code: "BRO", nombre: "RDZ Brownsville" },
  { code: "EDG", nombre: "RDZ Edinburg" },
  { code: "MCA", nombre: "RDZ McAllen" },
  { code: "PHR", nombre: "RDZ Pharr" },
  { code: "WES", nombre: "RDZ Weslaco" },
];

export function nombreDeTienda(code: string | null): string {
  const c = (code ?? "").trim().toUpperCase();
  return TIENDAS.find((t) => t.code === c)?.nombre ?? (c || "—");
}

/** STATUS TYPE del Excel, en el orden en que se leen (de mejor a peor). */
export const ESTADOS = ["NEW", "ACTIVE INC", "ACTIVE DEC", "NONE SALE", "LOST"] as const;
export type Estado = (typeof ESTADOS)[number];
export function estadoLabel(e: string | null, t: T): string {
  switch (e) {
    case "NEW": return t("New", "Nuevo");
    case "ACTIVE INC": return t("Active, growing", "Activo, creciendo");
    case "ACTIVE DEC": return t("Active, declining", "Activo, bajando");
    case "NONE SALE": return t("No sales", "Sin ventas");
    case "LOST": return t("Lost", "Perdido");
    case null: case "": return t("No status", "Sin estado");
    default: return e;
  }
}
/** El color de la pastilla de estado: verde lo que crece, ámbar lo que baja, gris lo que no vende, rojo lo perdido. */
export function estadoClase(e: string | null): string {
  switch (e) {
    case "NEW": return "border-sky-200 bg-sky-50 text-sky-700";
    case "ACTIVE INC": return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "ACTIVE DEC": return "border-amber-200 bg-amber-50 text-amber-700";
    case "LOST": return "border-red-200 bg-red-50 text-red-700";
    default: return "border-slate-200 bg-slate-100 text-slate-600";
  }
}

/** HISTORY TYPE del Excel (tamaño del historial de compra), de mayor a menor. */
export const HISTORIAS = ["LARGE", "MID", "SMALL", "INSIGNIFICANT"] as const;
export function historiaLabel(h: string | null, t: T): string {
  switch (h) {
    case "LARGE": return t("Large", "Grande");
    case "MID": return t("Mid", "Medio");
    case "SMALL": return t("Small", "Pequeño");
    case "INSIGNIFICANT": return t("Insignificant", "Insignificante");
    case null: case "": return "—";
    default: return h;
  }
}

/** QB INACTIVE del Excel: si QuickBooks encontró la cuenta en la última actualización. */
export const QB_ESTADOS = ["ACTIVE", "NOT FOUND IN UPDATE"] as const;
export function qbLabel(q: string | null, t: T): string {
  switch (q) {
    case "ACTIVE": return t("Active in QB", "Activo en QB");
    case "NOT FOUND IN UPDATE": return t("Not found in QB update", "No está en la actualización de QB");
    case null: case "": return "—";
    default: return q;
  }
}

// ---- Columnas ---------------------------------------------------------------------------------------------------

export interface Columna { key: keyof Cliente; en: string; es: string; fija?: true }

/** Todas las columnas que se pueden enseñar en la tabla, en su orden. `account` no se puede quitar. */
export const COLUMNAS: readonly Columna[] = [
  { key: "account", en: "Account", es: "Cuenta", fija: true },
  { key: "store", en: "Store", es: "Tienda" },
  { key: "status_store", en: "Status (store)", es: "Estado (tienda)" },
  { key: "status_group", en: "Status (group)", es: "Estado (grupo)" },
  { key: "history_store", en: "History (store)", es: "Historial (tienda)" },
  { key: "history_group", en: "History (group)", es: "Historial (grupo)" },
  { key: "qb_status", en: "QuickBooks", es: "QuickBooks" },
  { key: "activity_status", en: "Activity", es: "Actividad" },
  { key: "unified_account", en: "Unified account", es: "Cuenta unificada" },
  { key: "rep_store", en: "Store rep (QB)", es: "Vendedor tienda (QB)" },
  { key: "rep_qb", en: "Group rep (QB)", es: "Vendedor grupo (QB)" },
  { key: "rep_history", en: "Group rep (history)", es: "Vendedor grupo (historial)" },
  { key: "contact_name", en: "Contact", es: "Contacto" },
  { key: "phone", en: "Phone", es: "Teléfono" },
  { key: "email", en: "Email", es: "Correo" },
  { key: "terms", en: "Terms", es: "Términos" },
  { key: "credit_limit", en: "Credit limit", es: "Límite de crédito" },
  { key: "euler_limit", en: "Euler limit", es: "Límite Euler" },
  { key: "account_no", en: "Account / credit", es: "Cuenta / crédito" },
  { key: "added_batch", en: "Added", es: "Añadido" },
  { key: "house_no", en: "House #", es: "N.º House" },
  { key: "updated_at", en: "Updated", es: "Actualizado" },
];

/** Las de entrada: lo que cabe en un portátil y lo que se mira primero. */
export const COLUMNAS_INICIALES: readonly string[] = ["account", "store", "status_store", "history_store", "rep_store", "phone", "email", "terms", "credit_limit"];

/** Las columnas elegidas, saneadas: solo claves que existen, y `account` siempre. */
export function columnasValidas(elegidas: readonly string[] | null | undefined): string[] {
  const validas = new Set(COLUMNAS.map((c) => c.key as string));
  const lista = (elegidas ?? []).filter((k) => validas.has(k));
  if (!lista.includes("account")) lista.unshift("account");
  return COLUMNAS.map((c) => c.key as string).filter((k) => lista.includes(k));
}

/** Quita o pone una columna. `account` no se puede quitar: `columnasValidas` la vuelve a poner. */
export function alternaColumna(elegidas: readonly string[], key: string): string[] {
  return columnasValidas(elegidas.includes(key) ? elegidas.filter((k) => k !== key) : [...elegidas, key]);
}

// ---- Filtro y orden ---------------------------------------------------------------------------------------------

export interface Filtro {
  busca: string;
  /** Código de tienda, o "" = todas. */
  tienda: string;
  /** STATUS TYPE (tienda), "" = todos, "none" = sin estado. */
  estado: string;
  /** "" = todos; o uno de QB_ESTADOS. */
  qb: string;
}

export const FILTRO_INICIAL: Filtro = { busca: "", tienda: "", estado: "", qb: "" };

/** Los dígitos de un teléfono escrito de cualquier manera; vacío si no es un teléfono. */
export function soloDigitos(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** ¿Casa con la búsqueda? Cuenta, cuenta unificada, contacto, correo, cuenta/crédito, vendedores; y el teléfono por dígitos. */
export function coincide(c: Cliente, busca: string): boolean {
  const q = norm(busca).trim();
  if (!q) return true;
  const campos = [c.account, c.unified_account, c.contact_name, c.email, c.account_no, c.rep_store, c.rep_qb, c.rep_history, c.notes];
  if (campos.some((v) => norm(v).includes(q))) return true;
  const digitos = soloDigitos(q);
  return digitos.length >= 3 && soloDigitos(c.phone).includes(digitos);
}

export function filtrar(lista: readonly Cliente[], f: Filtro): Cliente[] {
  return lista.filter((c) => {
    if (f.tienda && c.store !== f.tienda) return false;
    if (f.estado === "none" ? !!c.status_store : f.estado && c.status_store !== f.estado) return false;
    if (f.qb && c.qb_status !== f.qb) return false;
    return coincide(c, f.busca);
  });
}

export interface Orden { por: keyof Cliente; desc: boolean }
export const ORDEN_INICIAL: Orden = { por: "account", desc: false };

const rangoEstado = (e: string | null) => { const i = ESTADOS.indexOf(e as Estado); return i < 0 ? ESTADOS.length : i; };
const rangoHistoria = (h: string | null) => { const i = HISTORIAS.indexOf(h as (typeof HISTORIAS)[number]); return i < 0 ? HISTORIAS.length : i; };

/** Ordena sin tocar la lista. Los estados y los historiales van por su rango, no alfabéticos; los nulos, al final. */
export function ordenar(lista: readonly Cliente[], orden: Orden): Cliente[] {
  const cmp = (a: Cliente, b: Cliente): number => {
    const k = orden.por;
    if (k === "status_store" || k === "status_group") return rangoEstado(a[k]) - rangoEstado(b[k]);
    if (k === "history_store" || k === "history_group") return rangoHistoria(a[k]) - rangoHistoria(b[k]);
    const va = a[k], vb = b[k];
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (typeof va === "number" && typeof vb === "number") return va - vb;
    return String(va).localeCompare(String(vb), undefined, { sensitivity: "base" });
  };
  return [...lista].sort((a, b) => (orden.desc ? -cmp(a, b) : cmp(a, b)) || a.account.localeCompare(b.account) || a.id - b.id);
}

/** Pulsar una cabecera: la misma columna invierte; otra columna empieza ascendente. */
export function alOrdenarPor(orden: Orden, por: keyof Cliente): Orden {
  return orden.por === por ? { por, desc: !orden.desc } : { por, desc: false };
}

export function cuentaPor(lista: readonly Cliente[], campo: "store" | "status_store" | "qb_status"): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of lista) { const k = c[campo] ?? ""; m.set(k, (m.get(k) ?? 0) + 1); }
  return m;
}

// ---- Quién edita, y qué ----------------------------------------------------------------------------------------

/** El espejo de `erp.customers_can_write()` (180): admin o manager del hub. Solo decide qué botones se ofrecen. */
export function puedeEditar(role: UserRole | null | undefined): boolean {
  return role === "admin" || role === "manager";
}

export type TipoCampo = "text" | "num" | "textarea" | "estado" | "historia" | "qb" | "tienda";
export interface Campo { key: keyof Cliente; tipo: TipoCampo; en: string; es: string }

/** Los campos de la ficha, en su orden. Todo lo del Excel se puede corregir; lo de la app (notas) también. */
export const CAMPOS: readonly Campo[] = [
  { key: "account", tipo: "text", en: "Account", es: "Cuenta" },
  { key: "store", tipo: "tienda", en: "Store", es: "Tienda" },
  { key: "unified_account", tipo: "text", en: "Unified account", es: "Cuenta unificada" },
  { key: "status_store", tipo: "estado", en: "Status (store)", es: "Estado (tienda)" },
  { key: "status_group", tipo: "estado", en: "Status (group)", es: "Estado (grupo)" },
  { key: "history_store", tipo: "historia", en: "History (store)", es: "Historial (tienda)" },
  { key: "history_group", tipo: "historia", en: "History (group)", es: "Historial (grupo)" },
  { key: "qb_status", tipo: "qb", en: "QuickBooks", es: "QuickBooks" },
  { key: "activity_status", tipo: "text", en: "Activity", es: "Actividad" },
  { key: "rep_store", tipo: "text", en: "Store rep (QB)", es: "Vendedor tienda (QB)" },
  { key: "rep_qb", tipo: "text", en: "Group rep (QB)", es: "Vendedor grupo (QB)" },
  { key: "rep_history", tipo: "text", en: "Group rep (history)", es: "Vendedor grupo (historial)" },
  { key: "contact_name", tipo: "text", en: "Contact", es: "Contacto" },
  { key: "contact_title", tipo: "text", en: "Title", es: "Cargo" },
  { key: "phone", tipo: "text", en: "Phone", es: "Teléfono" },
  { key: "email", tipo: "text", en: "Email", es: "Correo" },
  { key: "address", tipo: "textarea", en: "Address", es: "Dirección" },
  { key: "terms", tipo: "text", en: "Terms", es: "Términos" },
  { key: "credit_limit", tipo: "num", en: "Credit limit", es: "Límite de crédito" },
  { key: "euler_limit", tipo: "num", en: "Euler limit", es: "Límite Euler" },
  { key: "account_no", tipo: "text", en: "Account / credit", es: "Cuenta / crédito" },
  { key: "added_batch", tipo: "text", en: "Added (batch)", es: "Añadido (tanda)" },
  { key: "notes", tipo: "textarea", en: "Notes", es: "Notas" },
];

/** La ficha como texto por campo (lo que se edita). */
export function formDe(c: Cliente | null): Record<string, string> {
  const f: Record<string, string> = {};
  for (const campo of CAMPOS) {
    const v = c ? c[campo.key] : null;
    f[campo.key] = v === null || v === undefined ? "" : String(v);
  }
  return f;
}

export type Parche = Partial<Record<keyof Cliente, string | number | null>>;

/**
 * Lo que cambió entre la ficha original y la editada, con el tipo de la base: "" → null, los números como número.
 * Solo lo que cambió: reenviar lo leído pisa a quien guardó entre medias.
 */
export function parcheDe(form: Record<string, string>, original: Record<string, string>, nuevo = false): { parche: Parche; errores: string[] } {
  const parche: Parche = {};
  const errores: string[] = [];
  for (const campo of CAMPOS) {
    const v = (form[campo.key] ?? "").trim();
    const o = (original[campo.key] ?? "").trim();
    // Un alta sin cuenta o sin tienda no es un alta: la base lo rechazaría (not null), y se dice antes.
    if (nuevo && (campo.key === "account" || campo.key === "store") && v === "") { errores.push(campo.key); continue; }
    if (v === o) continue;
    if (campo.tipo === "num") {
      if (v === "") { parche[campo.key] = null; continue; }
      const n = Number(v.replace(/[$,\s]/g, ""));
      if (!Number.isFinite(n) || n < 0) { errores.push(campo.key); continue; }
      parche[campo.key] = n;
      continue;
    }
    if ((campo.key === "account" || campo.key === "store") && v === "") { errores.push(campo.key); continue; }
    parche[campo.key] = v === "" ? null : (campo.key === "store" ? v.toUpperCase() : v);
  }
  return { parche, errores };
}

// ---- De la base --------------------------------------------------------------------------------------------------

const texto = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
/** `numeric` llega como número o, según el camino, como texto: las dos valen; lo demás, null. */
const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

export function clienteDeLaBase(f: Record<string, unknown>): Cliente {
  return {
    id: Number(f.id), store: String(f.store ?? ""), account: String(f.account ?? ""),
    unified_account: texto(f.unified_account), house_no: num(f.house_no), added_batch: texto(f.added_batch),
    qb_status: texto(f.qb_status), activity_status: texto(f.activity_status),
    status_store: texto(f.status_store), status_group: texto(f.status_group),
    history_store: texto(f.history_store), history_group: texto(f.history_group),
    rep_history: texto(f.rep_history), rep_qb: texto(f.rep_qb), rep_store: texto(f.rep_store),
    contact_name: texto(f.contact_name), contact_title: texto(f.contact_title), address: texto(f.address),
    phone: texto(f.phone), email: texto(f.email),
    credit_limit: num(f.credit_limit), euler_limit: num(f.euler_limit),
    terms: texto(f.terms), account_no: texto(f.account_no), notes: texto(f.notes),
    updated_at: texto(f.updated_at), updated_by: texto(f.updated_by),
  };
}

// ---- Formato -------------------------------------------------------------------------------------------------------

export function dinero(n: number | null): string {
  return n === null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`;
}

/** Una fecha `AAAA-MM-DD` (o un instante ISO) como MM/DD/AAAA, sin pasar por zonas horarias. */
export function fecha(iso: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "—";
}

/** El enlace `tel:` de un teléfono escrito de cualquier manera. null si no tiene al menos 7 dígitos. */
export function telUrl(telefono: string | null): string | null {
  const t = (telefono ?? "").trim();
  const digitos = soloDigitos(t);
  if (digitos.length < 7) return null;
  return `tel:${t.startsWith("+") ? "+" : ""}${digitos}`;
}

/** Solo se enlaza un correo que lo parezca: el dato viene de un Excel (hay «0» y nombres en esa columna). */
export function mailUrl(email: string | null): string | null {
  const e = (email ?? "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? `mailto:${e}` : null;
}

/** El texto de una celda de la tabla, por columna. */
export function celda(c: Cliente, key: keyof Cliente, t: T): string {
  const v = c[key];
  switch (key) {
    case "store": return nombreDeTienda(c.store);
    case "status_store": case "status_group": return estadoLabel(v as string | null, t);
    case "history_store": case "history_group": return historiaLabel(v as string | null, t);
    case "qb_status": return qbLabel(v as string | null, t);
    case "credit_limit": case "euler_limit": return dinero(v as number | null);
    case "updated_at": return fecha(v as string | null);
    default: return v === null || v === undefined || v === "" ? "—" : String(v);
  }
}
