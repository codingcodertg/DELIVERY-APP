import type { UserRole } from "@/lib/types";
import { colocaColumna, mueveColumna, ordenEfectivo } from "@/lib/orden-de-columnas";
import { contactosDe } from "./contactos";
import { espejoDeContactos, formatoDeCampo, normalizaContactos, type Contacto } from "./formato";

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
  /** Migración 182: las columnas CRM del Excel (CRM TYPE: STORE / GROUP, Associated with). Texto libre; casi vacías en el fichero. */
  crm_type_store: string | null;
  crm_type_group: string | null;
  associated_with: string | null;
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
  /** Migración 181: null = cliente vivo. Archivado = no es un cliente (cajón de QuickBooks, interno, sin nombre…); se esconde, no se borra. */
  archived_at: string | null;
  archived_reason: string | null;
  /**
   * Migración 189: la EMPRESA de la fila. Las filas de una misma compañía en varias tiendas comparten este uuid; la
   * lista pinta una fila por empresa y la ficha cambia de tienda (`lib/customers/empresas`). Sin la 189 (o en un dato
   * viejo) falta, y la fila es su propia empresa.
   */
  company_id?: string | null;
  /**
   * Migración 193 (D-668): los contactos de la fila, cada uno con su nombre, cargo, teléfonos, correos y nota. Vacía
   * (o sin la 193) = aún salen de las cuatro columnas de antes (`contactosDe`), que la app escribe como espejo del primero.
   */
  contacts?: Contacto[] | null;
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

/**
 * Una columna de la tabla es una columna de la fila, o `concatenate`: la CONCATENATE del Excel (STORE+ACCOUNT pegados,
 * una fórmula). Medido el 2026-10-18: las 1.349 son exactamente tienda seguida de cuenta, así que no se guarda (la clave
 * natural ya es tienda + cuenta y una copia se desincroniza al corregir la cuenta); se calcula (`valorDeColumna`).
 */
export type ClaveDeColumna = keyof Cliente | "concatenate" | "store_count";
export interface Columna { key: ClaveDeColumna; en: string; es: string; fija?: true }

/**
 * TODAS las columnas que se pueden enseñar en la tabla, en su orden de partida. El dueño (2026-10-18): «a cuztomizable
 * order thing so we can all columsn if we wanted to that were on the excel»: aquí están las 27 cabeceras con nombre del
 * Excel (26 guardadas + `concatenate` calculada), más lo de la app (notas, actualizado, motivo de archivo).
 * `account` no se puede quitar. El orden en que se PINTAN lo decide cada persona (`columnasAPintar`).
 */
export const COLUMNAS: readonly Columna[] = [
  { key: "account", en: "Account", es: "Cuenta", fija: true },
  { key: "store", en: "Store", es: "Tienda" },
  // D-666: en cuántas tiendas está la EMPRESA (no es de la fila: se cuenta sobre sus filas, `tiendasDeLaEmpresa`).
  { key: "store_count", en: "# Stores", es: "N.º tiendas" },
  { key: "concatenate", en: "Store + account", es: "Tienda + cuenta" },
  { key: "status_store", en: "Status (store)", es: "Estado (tienda)" },
  { key: "status_group", en: "Status (group)", es: "Estado (grupo)" },
  // D-669: «Historical Type», no «Status» (Roberto, 2026-10-24).
  { key: "history_store", en: "Historical type (store)", es: "Tipo histórico (tienda)" },
  { key: "history_group", en: "Historical type (group)", es: "Tipo histórico (grupo)" },
  { key: "crm_type_store", en: "CRM type (store)", es: "Tipo CRM (tienda)" },
  { key: "crm_type_group", en: "CRM type (group)", es: "Tipo CRM (grupo)" },
  { key: "associated_with", en: "Associated with", es: "Asociado con" },
  { key: "qb_status", en: "QuickBooks", es: "QuickBooks" },
  // D-669: la «Activity» del Excel es el «Type» de la plantilla del dueño (Roberto, 2026-10-24).
  { key: "activity_status", en: "Type", es: "Tipo" },
  { key: "unified_account", en: "Unified account", es: "Cuenta unificada" },
  { key: "rep_store", en: "Store rep (QB)", es: "Vendedor tienda (QB)" },
  { key: "rep_qb", en: "Group rep (QB)", es: "Vendedor grupo (QB)" },
  { key: "rep_history", en: "Group rep (history)", es: "Vendedor grupo (historial)" },
  { key: "contact_name", en: "Contact", es: "Contacto" },
  { key: "contact_title", en: "Title", es: "Cargo" },
  { key: "phone", en: "Phone", es: "Teléfono" },
  { key: "email", en: "Email", es: "Correo" },
  { key: "address", en: "Address", es: "Dirección" },
  { key: "terms", en: "Terms", es: "Términos" },
  { key: "credit_limit", en: "Credit limit", es: "Límite de crédito" },
  { key: "euler_limit", en: "Euler limit", es: "Límite Euler" },
  { key: "account_no", en: "Account / credit", es: "Cuenta / crédito" },
  { key: "added_batch", en: "Added", es: "Añadido" },
  { key: "house_no", en: "House #", es: "N.º House" },
  { key: "notes", en: "Notes", es: "Notas" },
  { key: "updated_at", en: "Updated", es: "Actualizado" },
  { key: "archived_reason", en: "Archived (reason)", es: "Archivado (motivo)" },
];

/** Las de entrada: lo que cabe en un portátil y lo que se mira primero. */
export const COLUMNAS_INICIALES: readonly string[] = ["account", "store", "store_count", "status_store", "history_store", "rep_store", "phone", "email", "terms", "credit_limit"];

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

// ---- El orden de las columnas, por persona -----------------------------------------------------------------------

/**
 * Qué columnas y en qué orden las quiere CADA persona, en su navegador. La clave lleva el id del usuario, como los
 * filtros guardados de Órdenes (`rtg_filtros_ordenes_<id>`) y el filtro de chofer del Gestor: dos personas en el mismo
 * ordenador no se pisan. (Antes era `customers_cols`, una sola para todos: se lee como herencia la primera vez.)
 */
export const claveDeColumnasDeClientes = (userId: string): string => `rtg_customers_cols_${userId}`;
export const CLAVE_HEREDADA_DE_COLUMNAS = "customers_cols";

export interface PreferenciaDeColumnas { elegidas: string[]; orden: string[] | null }
export const PREFERENCIA_INICIAL: PreferenciaDeColumnas = { elegidas: [...COLUMNAS_INICIALES], orden: null };
const CLAVES_CANONICAS: readonly string[] = COLUMNAS.map((c) => c.key as string);

/** Lo guardado, saneado. Acepta el formato nuevo `{elegidas, orden}` y el heredado (una lista de elegidas). Basura = lo de entrada. */
export function preferenciaDeTexto(texto: string | null | undefined): PreferenciaDeColumnas {
  try {
    const v: unknown = JSON.parse(texto ?? "null");
    if (Array.isArray(v)) return { elegidas: columnasValidas(v.filter((k): k is string => typeof k === "string")), orden: null };
    if (v && typeof v === "object") {
      const o = v as { elegidas?: unknown; orden?: unknown };
      const elegidas = Array.isArray(o.elegidas) ? columnasValidas(o.elegidas.filter((k): k is string => typeof k === "string")) : [...COLUMNAS_INICIALES];
      const orden = Array.isArray(o.orden) && o.orden.every((k) => typeof k === "string") ? ordenEfectivo(CLAVES_CANONICAS, o.orden as string[]) : null;
      return { elegidas, orden };
    }
  } catch { /* basura */ }
  return { elegidas: [...COLUMNAS_INICIALES], orden: null };
}

/** Las columnas que se PINTAN: las elegidas, en el orden de la persona (o el de partida); `account` siempre. */
export function columnasAPintar(p: PreferenciaDeColumnas): Columna[] {
  const si = new Set(columnasValidas(p.elegidas));
  return ordenEfectivo(CLAVES_CANONICAS, p.orden).filter((k) => si.has(k)).map((k) => COLUMNAS.find((c) => c.key === k)!);
}

/** Las columnas del selector, en el orden de la persona: lo que mueve es lo que ve. */
export function columnasDelSelector(p: PreferenciaDeColumnas): Columna[] {
  return ordenEfectivo(CLAVES_CANONICAS, p.orden).map((k) => COLUMNAS.find((c) => c.key === k)!);
}

/** Subir o bajar una columna un puesto entre las visibles (la `mueveColumna` de Órdenes, D-332). */
export function mueveColumnaDeClientes(p: PreferenciaDeColumnas, key: string, delta: -1 | 1): PreferenciaDeColumnas {
  const orden = mueveColumna(ordenEfectivo(CLAVES_CANONICAS, p.orden), key, delta, columnasValidas(p.elegidas));
  return { ...p, orden: tieneOrdenPropio(orden) ? orden : null };
}
export function seMueveColumnaDeClientes(p: PreferenciaDeColumnas, key: string, delta: -1 | 1): boolean {
  return ordenEfectivo(CLAVES_CANONICAS, mueveColumnaDeClientes(p, key, delta).orden).join() !== ordenEfectivo(CLAVES_CANONICAS, p.orden).join();
}
/**
 * Arrastrar la cabecera `key` y soltarla sobre la de `destino` (D-650): `key` ocupa el sitio de `destino`, y las de en
 * medio corren un puesto. Soltar a la derecha la deja DESPUÉS de `destino`; a la izquierda, ANTES — lo que se ve al
 * arrastrar. Se mueve en el orden de TODAS las columnas (las ocultas guardan su sitio), el mismo que usa «⚙ Columnas».
 */
export function colocaColumnaDeClientes(p: PreferenciaDeColumnas, key: string, destino: string): PreferenciaDeColumnas {
  // La colocación es la de Órdenes (D-661): la misma función para las dos tablas.
  const orden = ordenEfectivo(CLAVES_CANONICAS, p.orden);
  const r = colocaColumna(orden, key, destino);
  if (r.join() === orden.join()) return p;
  return { ...p, orden: tieneOrdenPropio(r) ? r : null };
}
/** Si hay orden propio (para enseñar «Restablecer orden» solo cuando hace algo). */
export function tieneOrdenPropio(orden: readonly string[] | null | undefined): boolean {
  return ordenEfectivo(CLAVES_CANONICAS, orden).join() !== CLAVES_CANONICAS.join();
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
  /** false (lo normal) = solo los vivos; true = SOLO los archivados (el chip «Archivados (N)»). Nunca mezclados. */
  archivados: boolean;
}

export const FILTRO_INICIAL: Filtro = { busca: "", tienda: "", estado: "", qb: "", archivados: false };

// ---- Archivado (migración 181) -----------------------------------------------------------------------------------

/** Un cliente archivado tiene fecha; el motivo es texto y puede faltar (archivado a mano sin decir por qué). */
export function estaArchivado(c: Pick<Cliente, "archived_at">): boolean {
  return c.archived_at !== null && c.archived_at !== "";
}

/**
 * Los motivos que pone `scripts/archiva-clientes-basura.mjs` (el mismo texto, sin acentos: es lo que se guarda y lo que
 * `--deshacer` busca). La ficha los ofrece y deja escribir otro.
 */
export const MOTIVOS_DE_ARCHIVO = ["sin nombre", "comodin de QuickBooks", "interno/proveedor/competencia"] as const;
export function motivoLabel(m: string | null, t: T): string {
  switch (m) {
    case "sin nombre": return t("No real name", "Sin nombre");
    case "comodin de QuickBooks": return t("QuickBooks placeholder", "Comodín de QuickBooks");
    case "interno/proveedor/competencia": return t("Internal / supplier / competitor", "Interno / proveedor / competencia");
    case null: case "": return t("No reason given", "Sin motivo");
    default: return m;
  }
}

/** Lo que se escribe al archivar: la hora de ahora y el motivo (vacío → null). Y lo que se escribe al desarchivar. */
export function parcheArchivar(motivo: string, ahora: () => Date = () => new Date()): Parche {
  const m = motivo.trim();
  return { archived_at: ahora().toISOString(), archived_reason: m === "" ? null : m };
}
export const PARCHE_DESARCHIVAR: Parche = { archived_at: null, archived_reason: null };

export function cuentaArchivados(lista: readonly Cliente[]): number {
  return lista.filter(estaArchivado).length;
}

/** Los dígitos de un teléfono escrito de cualquier manera; vacío si no es un teléfono. */
export function soloDigitos(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** ¿Casa con la búsqueda? Cuenta, cuenta unificada, contacto, correo, cuenta/crédito, vendedores; y el teléfono por dígitos. */
export function coincide(c: Cliente, busca: string): boolean {
  const q = norm(busca).trim();
  if (!q) return true;
  // D-668: con TODOS sus contactos (nombres, cargos, correos, notas y teléfonos), no solo el primero.
  const contactos = contactosDe(c);
  const campos = [c.account, c.unified_account, c.contact_name, c.email, c.account_no, c.rep_store, c.rep_qb, c.rep_history, c.notes,
    ...contactos.flatMap((x) => [x.name, x.title, x.note, ...x.emails])];
  if (campos.some((v) => norm(v).includes(q))) return true;
  const digitos = soloDigitos(q);
  return digitos.length >= 3 && [c.phone, ...contactos.flatMap((x) => x.phones)].some((p) => soloDigitos(p).includes(digitos));
}

export function filtrar(lista: readonly Cliente[], f: Filtro): Cliente[] {
  return lista.filter((c) => {
    if (estaArchivado(c) !== f.archivados) return false;
    if (f.tienda && c.store !== f.tienda) return false;
    if (f.estado === "none" ? !!c.status_store : f.estado && c.status_store !== f.estado) return false;
    if (f.qb && c.qb_status !== f.qb) return false;
    return coincide(c, f.busca);
  });
}

export interface Orden { por: ClaveDeColumna; desc: boolean }
export const ORDEN_INICIAL: Orden = { por: "account", desc: false };

/**
 * El valor crudo de una columna: el de la fila, o la CONCATENATE del Excel recompuesta (tienda + cuenta, pegadas).
 * «N.º tiendas» (D-666) no es de la fila sino de su empresa: lo dice `tiendasDe` quien la conoce (la lista por
 * empresa); sin ella, no hay valor.
 */
export function valorDeColumna(c: Cliente, key: ClaveDeColumna, tiendasDe?: (c: Cliente) => number): string | number | null {
  if (key === "store_count") return tiendasDe ? tiendasDe(c) : null;
  if (key === "concatenate") return `${c.store}${c.account}`;
  // D-668: contacto, cargo, teléfono y correo son los del PRIMER contacto, ya separados («956-… - OMAR» da OMAR y su
  // número), aunque la fila aún los tenga juntos en sus columnas.
  if (key === "contact_name" || key === "contact_title" || key === "phone" || key === "email") return espejoDeContactos(contactosDe(c))[key];
  if (key === "contacts") return null;
  return c[key] ?? null;
}

const rangoEstado = (e: string | null) => { const i = ESTADOS.indexOf(e as Estado); return i < 0 ? ESTADOS.length : i; };
const rangoHistoria = (h: string | null) => { const i = HISTORIAS.indexOf(h as (typeof HISTORIAS)[number]); return i < 0 ? HISTORIAS.length : i; };

/** Compara dos filas por UNA columna, ascendente. Los estados y los historiales van por su rango, no alfabéticos; los nulos, al final. */
function comparaPor(a: Cliente, b: Cliente, k: ClaveDeColumna, tiendasDe?: (c: Cliente) => number): number {
  if (k === "status_store" || k === "status_group") return rangoEstado(a[k]) - rangoEstado(b[k]);
  if (k === "history_store" || k === "history_group") return rangoHistoria(a[k]) - rangoHistoria(b[k]);
  const va = valorDeColumna(a, k, tiendasDe), vb = valorDeColumna(b, k, tiendasDe);
  if (va === null && vb === null) return 0;
  if (va === null) return 1;
  if (vb === null) return -1;
  if (typeof va === "number" && typeof vb === "number") return va - vb;
  return String(va).localeCompare(String(vb), undefined, { sensitivity: "base" });
}

/** Ordena sin tocar la lista, por una columna. */
export function ordenar(lista: readonly Cliente[], orden: Orden): Cliente[] {
  return ordenarEnNiveles(lista, [orden]);
}

/**
 * Ordena por VARIAS columnas en jerarquía (D-650): manda la primera; la segunda solo decide entre las que empatan en la
 * primera, y la tercera entre las que empatan en las dos. Cada nivel con su sentido. Lo que sigue empatado va por cuenta
 * y por id, como siempre, para que la lista no baile de una carga a otra.
 */
export function ordenarEnNiveles(lista: readonly Cliente[], niveles: readonly Orden[], tiendasDe?: (c: Cliente) => number): Cliente[] {
  const cmp = (a: Cliente, b: Cliente): number => {
    for (const n of niveles) {
      const c = comparaPor(a, b, n.por, tiendasDe);
      if (c !== 0) return n.desc ? -c : c;
    }
    return 0;
  };
  return [...lista].sort((a, b) => cmp(a, b) || a.account.localeCompare(b.account) || a.id - b.id);
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
/**
 * Los grupos de la ficha, en su orden (D-634). `cabecera` no es una tarjeta: la cuenta y la tienda van arriba, en el nombre
 * y en las pestañas de tiendas (D-654, el dueño: «abajo donde dice cuenta, vuelve a decir la tienda […] elimina esa
 * parte»), y no se repiten abajo.
 */
export type GrupoDeCampo = "cabecera" | "cuenta" | "estado" | "contacto" | "credito" | "otros" | "ocultos";
export interface Campo { key: Exclude<keyof Cliente, "contacts">; tipo: TipoCampo; en: string; es: string; grupo: GrupoDeCampo }

/** Los campos de la ficha, en su orden. Todo lo del Excel se puede corregir; lo de la app (notas) también. */
export const CAMPOS: readonly Campo[] = [
  { key: "account", tipo: "text", en: "Account", es: "Cuenta", grupo: "cabecera" },
  { key: "store", tipo: "tienda", en: "Store", es: "Tienda", grupo: "cabecera" },
  { key: "status_store", tipo: "estado", en: "Current Status (store)", es: "Estado actual (tienda)", grupo: "estado" },
  { key: "status_group", tipo: "estado", en: "Current Status (group)", es: "Estado actual (grupo)", grupo: "estado" },
  // D-669: Roberto, 2026-10-24: «Rename to Historical Type instead of Status».
  { key: "history_store", tipo: "historia", en: "Historical Type (store)", es: "Tipo histórico (tienda)", grupo: "estado" },
  { key: "history_group", tipo: "historia", en: "Historical Type (group)", es: "Tipo histórico (grupo)", grupo: "estado" },
  { key: "qb_status", tipo: "qb", en: "QuickBooks Status", es: "Estado en QuickBooks", grupo: "estado" },
  // Migración 182: «the crm stuff» del Excel.
  { key: "crm_type_store", tipo: "text", en: "CRM type (store)", es: "Tipo CRM (tienda)", grupo: "otros" },
  { key: "crm_type_group", tipo: "text", en: "CRM type (group)", es: "Tipo CRM (grupo)", grupo: "otros" },
  { key: "associated_with", tipo: "text", en: "Associated with", es: "Asociado con", grupo: "otros" },
  // D-662: vuelve a la tarjeta «Cuenta», la primera (en D-654 había ido a «Otros» al quitar esa tarjeta).
  { key: "unified_account", tipo: "text", en: "Unified account", es: "Cuenta unificada", grupo: "cuenta" },
  { key: "rep_store", tipo: "text", en: "Store rep (QB)", es: "Vendedor tienda (QB)", grupo: "cuenta" },
  { key: "rep_qb", tipo: "text", en: "Group rep (QB)", es: "Vendedor grupo (QB)", grupo: "cuenta" },
  { key: "rep_history", tipo: "text", en: "Group rep (history)", es: "Vendedor grupo (historial)", grupo: "cuenta" },
  // D-668: contacto, cargo, teléfono y correo ya no son campos sueltos: son la lista de contactos (`contacts`, 193), que
  // la tarjeta «Contacto» pinta y edita aparte (`contactos.ts`). Las cuatro columnas quedan como espejo del primero.
  { key: "address", tipo: "textarea", en: "Address", es: "Dirección", grupo: "contacto" },
  { key: "terms", tipo: "text", en: "Terms", es: "Términos", grupo: "credito" },
  { key: "credit_limit", tipo: "num", en: "Credit limit", es: "Límite de crédito", grupo: "credito" },
  { key: "euler_limit", tipo: "num", en: "Euler limit", es: "Límite Euler", grupo: "credito" },
  { key: "account_no", tipo: "text", en: "Account / credit", es: "Cuenta / crédito", grupo: "credito" },
  // D-669: la «Activity» del Excel sale de «Campos ocultos» (D-662) y es el «Type» de «Credit & terms» (Roberto,
  // 2026-10-24: «Move "Activity" under Credit & Terms and rename to "Type"»; es el «Type» de la plantilla del dueño).
  { key: "activity_status", tipo: "text", en: "Type", es: "Tipo", grupo: "credito" },
  // D-660: el dueño no la quería a la vista: va en «Campos ocultos», plegado al final de la ficha (`filasOcultas`).
  { key: "added_batch", tipo: "text", en: "Added (batch)", es: "Añadido (tanda)", grupo: "ocultos" },
  { key: "notes", tipo: "textarea", en: "Notes", es: "Notas", grupo: "otros" },
];

export const GRUPOS: readonly { key: Exclude<GrupoDeCampo, "cabecera" | "ocultos">; en: string; es: string }[] = [
  // D-662: «Cuenta» vuelve a ser la PRIMERA tarjeta. El dueño, 2026-10-23, con el orden escrito («ACCOUNT · CONTACT ·
  // CREDIT AND TERMS / STATUS AND HISTORY · SALES REP · OTHER»): «it should be account first, then contact, and account got
  // deleted». D-654 la había quitado leyendo «elimina la parte donde dice cuenta» como la tarjeta entera.
  { key: "cuenta", en: "Account", es: "Cuenta" },
  { key: "contacto", en: "Contact", es: "Contacto" },
  { key: "credito", en: "Credit & terms", es: "Crédito y términos" },
  { key: "estado", en: "Status & history", es: "Estado e historial" },
  // D-662: sin tarjeta «Vendedores»: los tres vendedores van en «Cuenta», como en la plantilla del dueño.
  // D-634: el CRM y lo de la app juntos en la última tarjeta. Lo que solo identifica la fila del Excel ya no va aquí:
  // va en «Campos ocultos» (D-660).
  { key: "otros", en: "Other", es: "Otros" },
];

/**
 * D-660: el apartado plegado al final de la ficha. El dueño, con la captura de «N.º House · Tienda + cuenta
 * (CONCATENATE)» en «Otros»: «this was supposed to go into another like a hidden field in customer». Lo que en D-654 se
 * leyó como «hiring notes» era «hidden notes»: campos que no se miran a diario y que no tienen que estorbar.
 */
export const GRUPO_OCULTO = { key: "ocultos", en: "Hidden fields", es: "Campos ocultos" } as const;

/**
 * Una línea de una tarjeta de la ficha: un campo que se edita (`campo`), o uno que solo se lee (`campo: null`): House #
 * (del Excel, no se corrige a mano) y la CONCATENATE (se calcula, `valorDeColumna`).
 */
export interface FilaDeFicha { key: keyof Cliente | "concatenate"; en: string; es: string; campo: Campo | null }

/**
 * Lo que solo identifica la fila del Excel y no se edita. Va en «Campos ocultos» detrás de «Añadido (tanda)» (D-660;
 * en D-654 iba en «Otros»): el dueño pidió esas tres juntas, «añadido tanda, número de house y tienda más cuenta».
 */
const FILAS_SOLO_DE_LECTURA: readonly FilaDeFicha[] = [
  { key: "house_no", en: "House #", es: "N.º House", campo: null },
  { key: "concatenate", en: "Store + account (CONCATENATE)", es: "Tienda + cuenta (CONCATENATE)", campo: null },
];

const filaDe = (campo: Campo): FilaDeFicha => ({ key: campo.key, en: campo.en, es: campo.es, campo });

/**
 * Las tarjetas de la ficha y sus líneas, en su orden: cada campo de `CAMPOS` sale una vez, aquí o en `filasOcultas`
 * (los de la cabecera, ninguna: están arriba), y ningún grupo queda vacío. La ventana de la lista y la página
 * `/customers/[id]` pintan esto mismo.
 */
export function filasPorGrupo(): { grupo: (typeof GRUPOS)[number]; filas: FilaDeFicha[] }[] {
  // La tarjeta «Cuenta» (D-662) abre con el nombre de la cuenta, de solo lectura: se corrige arriba, en la cabecera (D-654),
  // y aquí no se edita dos veces.
  const delante = (k: string): FilaDeFicha[] => (k === "cuenta" ? [{ key: "account", en: "Account", es: "Cuenta", campo: null }] : []);
  return GRUPOS.map((grupo) => ({ grupo, filas: [...delante(grupo.key), ...CAMPOS.filter((c) => c.grupo === grupo.key).map(filaDe)] }))
    .filter((g) => g.filas.length > 0);
}

/**
 * D-660: las líneas de «Campos ocultos», el apartado plegado al final de la ficha: «Añadido (tanda)» (se edita), N.º
 * House y la CONCATENATE (se leen).
 */
export function filasOcultas(): FilaDeFicha[] {
  // En el orden de la plantilla del dueño (D-662): Añadido (tanda), N.º House, la CONCATENATE. (La actividad iba detrás
  // hasta D-669: ahora es el «Tipo» de «Crédito y términos».)
  const ocultos = CAMPOS.filter((c) => c.grupo === GRUPO_OCULTO.key);
  return [...ocultos.map(filaDe), ...FILAS_SOLO_DE_LECTURA];
}

/** El texto de una línea de la ficha: el del campo (`textoDeCampo`), o el de las de solo lectura. */
export function textoDeFila(c: Cliente, fila: FilaDeFicha, t: T): string {
  if (fila.campo) return textoDeCampo(c, fila.campo, t);
  const v = valorDeColumna(c, fila.key);
  return v === null || v === undefined || v === "" ? "—" : String(v);
}

/** El texto de un campo en la ficha completa (solo lectura): etiquetas para los cerrados, dinero, y «—» si no hay dato. */
export function textoDeCampo(c: Cliente, campo: Campo, t: T): string {
  switch (campo.tipo) {
    case "tienda": return `${nombreDeTienda(c.store)} (${c.store})`;
    case "estado": return estadoLabel(c[campo.key] as string | null, t);
    case "historia": return historiaLabel(c[campo.key] as string | null, t);
    case "qb": return qbLabel(c[campo.key] as string | null, t);
    case "num": return dinero(c[campo.key] as number | null);
    default: { const v = c[campo.key]; return v === null || v === undefined || v === "" ? "—" : String(v); }
  }
}

/**
 * ¿Cierra la ventana de la ficha? (D-654, el dueño: «que uno solo puede dar afuera y exit out»). Con Escape, o con un
 * clic en el FONDO que también empezó en el fondo: un clic dentro de la ventana no cierra, ni soltar encima del fondo un
 * arrastre que empezó dentro (seleccionar texto de un campo y soltar fuera). La ✕ cierra siempre.
 */
export function cierraLaFicha(e: { tecla: string } | { clicEnElFondo: boolean; empezoEnElFondo: boolean }): boolean {
  if ("tecla" in e) return e.tecla === "Escape";
  return e.clicEnElFondo && e.empezoEnElFondo;
}

/** La ficha como texto por campo (lo que se edita). */
export function formDe(c: Cliente | null): Record<string, string> {
  const f: Record<string, string> = {};
  for (const campo of CAMPOS) {
    const v = c ? c[campo.key] : null;
    f[campo.key] = v === null || v === undefined ? "" : String(v);
  }
  return f;
}

export type Parche = Partial<Record<Exclude<keyof Cliente, "contacts">, string | number | null>> & { contacts?: Contacto[] };

/**
 * Lo que cambió entre la ficha original y la editada, con el tipo de la base: "" → null, los números como número.
 * El texto, en su formato (`formato.ts`, D-635).
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
    // D-635: lo que se guarda va en su formato (nombres en MAYÚSCULAS, teléfono «(956) 340-5910», correo en minúsculas).
    // Si en formato es lo mismo que ya había, no hay cambio que guardar.
    const f = campo.key === "store" ? v.toUpperCase() : formatoDeCampo(campo.key, v);
    if (f === o) continue;
    parche[campo.key] = f === "" ? null : f;
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
    crm_type_store: texto(f.crm_type_store), crm_type_group: texto(f.crm_type_group), associated_with: texto(f.associated_with),
    rep_history: texto(f.rep_history), rep_qb: texto(f.rep_qb), rep_store: texto(f.rep_store),
    contact_name: texto(f.contact_name), contact_title: texto(f.contact_title), address: texto(f.address),
    phone: texto(f.phone), email: texto(f.email),
    credit_limit: num(f.credit_limit), euler_limit: num(f.euler_limit),
    terms: texto(f.terms), account_no: texto(f.account_no), notes: texto(f.notes),
    updated_at: texto(f.updated_at), updated_by: texto(f.updated_by),
    archived_at: texto(f.archived_at), archived_reason: texto(f.archived_reason),
    company_id: texto(f.company_id),
    // Sin la 193 la columna no llega: null, y los contactos salen de las cuatro de antes.
    contacts: Array.isArray(f.contacts) ? normalizaContactos(f.contacts) : null,
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
export function celda(c: Cliente, key: ClaveDeColumna, t: T): string {
  if (key === "archived_reason") return estaArchivado(c) ? motivoLabel(c.archived_reason, t) : "—";
  return textoDeValor(key, valorDeColumna(c, key), t);
}

/** Cómo se enseña un valor de una columna: lo que dice la celda, y lo que dice cada casilla del filtro de esa columna (D-650). */
export function textoDeValor(key: ClaveDeColumna, v: Cliente[keyof Cliente], t: T): string {
  switch (key) {
    case "store": return nombreDeTienda(v as string | null);
    case "status_store": case "status_group": return estadoLabel(v as string | null, t);
    case "history_store": case "history_group": return historiaLabel(v as string | null, t);
    case "qb_status": return qbLabel(v as string | null, t);
    case "credit_limit": case "euler_limit": return dinero(v as number | null);
    case "updated_at": return fecha(v as string | null);
    case "archived_reason": return motivoLabel(v as string | null, t);
    default: return v === null || v === undefined || v === "" ? "—" : String(v);
  }
}

/**
 * Clientes es SOLO de admins por ahora (D-570). El dueño, 2026-10-16: «LA DE CSTOMER SOLO SERA HABILTIADA PARA ADMINS
 * AHORITA». Un solo interruptor, para que el día que se abra a más gente se cambie aquí y en ningún otro sitio: la puerta
 * del servidor (`customers/layout.tsx`) y la casilla de Usuarios (`MODULE_ACCESS`) lo leen. Con `false`, vuelve a lo de
 * la 180: entra quien tiene la casilla, y la casilla se ofrece a todos.
 */
export const CLIENTES_SOLO_ADMINS = true;

/** ¿Puede entrar a /customers? Admin siempre; los demás, solo con la casilla y solo si no está en «solo admins». */
export function puedeEntrarAClientes(p: { role?: string | null; module_access?: string[] | null } | null | undefined): boolean {
  if (p?.role === "admin") return true;
  if (CLIENTES_SOLO_ADMINS) return false;
  return !!p?.module_access?.includes("customers");
}

/** ¿Se le ofrece la casilla «Clientes» en Usuarios a alguien con este rol? */
export function seOfreceClientes(role: string | null | undefined): boolean {
  return role === "admin" || !CLIENTES_SOLO_ADMINS;
}
