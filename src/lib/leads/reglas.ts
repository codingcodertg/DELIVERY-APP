/**
 * «Leads» (migraciones 162 y siguientes): las reglas, sin navegador y sin base.
 *
 * Desde la 328 (reunión del 2026-11-18) nadie TOMA ni TIENE un lead. Cualquiera que lo ve anota una nota de avance, y
 * la ETAPA de la nota es lo que el lead es hoy: new, made_contact, no_answer, appointment, quote, negotiation, closed
 * (venta), lost (no se logró nada) y bad_lead (no es buen lead). La base es quien manda (`lead_note`); lo de aquí es lo
 * MISMO escrito otra vez para que la pantalla no ofrezca nada que la base vaya a rechazar, para que el modo demo se
 * comporte como la base, y para que cada regla tenga una prueba que se pueda leer.
 */

export type EstadoLead = "free" | "taken" | "won" | "review" | "archived";

/**
 * Con qué se cerraba un lead ANTES de la 328 (`lead_close`). Se conserva porque el historial viejo lo guarda y hay que
 * poder leerlo. La pantalla nueva ya no cierra con resultado: cierra con la etapa (`TipoDeAccion`).
 */
export const RESULTADOS = ["sale", "bad_lead", "nothing", "review", "reassign"] as const;
export type Resultado = (typeof RESULTADOS)[number];

/** La etiqueta con la que un lead volvió al banco antes de la 328: un resultado de cierre, o una nota del admin. */
export type Etiqueta = Resultado | "admin";

export interface Lead {
  id: string;
  tabs_project: string;
  pool: string;
  distance_miles: number | null;
  category: string | null;
  project_type: string | null;
  reason: string | null;
  county: string | null;
  registered_date: string | null;
  project_name: string | null;
  facility_name: string | null;
  type_of_work: string | null;
  scope_of_work: string | null;
  square_footage: number | null;
  estimated_cost: number | null;
  est_start_date: string | null;
  est_completion_date: string | null;
  permit_status: string | null;
  site_address: string | null;
  site_city: string | null;
  site_zip: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  owner_contact: string | null;
  tenant_name: string | null;
  tenant_phone: string | null;
  design_firm_name: string | null;
  design_firm_phone: string | null;
  tdlr_link: string | null;
  status: EstadoLead;
  /** Quien lo tiene: solo un lead `won` (venta) lo tiene; el resto, null (328). */
  holder: string | null;
  holder_name: string | null;
  taken_at: string | null;
  touched_at: string | null;
  /** La nota de avance más reciente (su texto). */
  follow_up_note: string | null;
  /** Cuándo fue la última nota de avance. */
  follow_up_at: string | null;
  /**
   * La ETAPA del lead: la de su última nota con etapa (253; 328). null = aún sin etapa, que se ve como «New».
   * Es la misma columna de la 253 (`follow_up_action`): la 328 la reusa en vez de crear otra.
   */
  follow_up_action?: TipoDeAccion | null;
  last_outcome: Etiqueta | null;
  last_note: string | null;
  /** Quién hizo el ÚLTIMO CONTACTO (quien escribió la última nota) y cuándo. */
  last_by: string | null;
  last_by_name: string | null;
  last_at: string | null;
  /** D-760 (218): de dónde salió. 'tdlr' (permisos del estado, lo de siempre) o 'privado' (el Excel de permisos
   *  municipales, solo para el admin). Opcional por los datos viejos y el demo: sin valor, 'tdlr'. */
  source?: "tdlr" | "privado";
  /** Cuándo entró el lote del import (el primero que lo trajo). Las semanas del STXP Pool salen de aquí (semanas.ts). */
  imported_at?: string | null;
  /** D-760: el cliente de erp.customers con el que coincide (teléfono o nombre), y por qué. Los pone el importador. */
  customer_match_id?: number | null;
  customer_match_note?: string | null;
  /**
   * En cuántas cargas (imports) ha aparecido el lead (328). 1 = una sola vez. Opcional por el demo y las filas viejas:
   * sin valor, 1.
   */
  times_seen?: number;
  /** La última carga que lo trajo (328). null = no se registró (las cargas viejas no lo guardaron). */
  last_seen_at?: string | null;
}

export const esPrivado = (l: Pick<Lead, "source">): boolean => l.source === "privado";
export const coincideConCliente = (l: Pick<Lead, "customer_match_id">): boolean => l.customer_match_id != null;
/** Cuántas cargas trajeron el lead. Sin dato (base vieja o demo), una. */
export const vecesVisto = (l: Pick<Lead, "times_seen">): number => (typeof l.times_seen === "number" && l.times_seen >= 1 ? l.times_seen : 1);

export type TipoDeEvento = "imported" | "taken" | "progress" | "closed" | "released" | "assigned" | "archived";

export interface EventoLead {
  id: number;
  lead_id: string;
  at: string;
  kind: TipoDeEvento;
  outcome: Resultado | null;
  note: string | null;
  /** 253: la etapa de una nota de avance (solo kind = 'progress'). Las viejas, sin etapa. */
  action?: TipoDeAccion | null;
  actor: string | null;
  actor_name: string | null;
  subject: string | null;
  subject_name: string | null;
}

/** Quien mira. `admin` entra siempre y es el único que archiva. */
export interface Persona {
  id: string;
  name: string;
  store: string | null;
  admin: boolean;
  /** El rol de la app (`profiles.role`) y los permisos por persona. Solo los trae el demo, que no tiene base a la
   * que preguntarle el alcance (ver `alcance.ts`); con base, el alcance lo dice `leads_my_scope()`. */
  role?: string;
  permissions?: string[];
}

export type Negativa = "lleno" | "no_libre" | "falta_nota" | "no_es_tuyo" | "sin_permiso" | "no_existe" | "dato_invalido" | "otra_tienda";

/** La nota, recortada. Vacía o solo espacios, no vale cuando no hay etapa. */
export function notaLimpia(nota: string | null | undefined): string | null {
  const n = (nota ?? "").trim();
  return n.length > 0 && n.length <= NOTA_MAX ? n : null;
}
export const NOTA_MAX = 2000;

export type Hecho<T> = { ok: true; valor: T } | { ok: false; motivo: Negativa };

// ---------------------------------------------------------------------------------------------------------------
// Las etapas
// ---------------------------------------------------------------------------------------------------------------

/**
 * Las etapas que se pueden ELEGIR al anotar, en el orden en que se muestran. Los mismos valores que el check de la
 * 328 (`leads.follow_up_action` y `lead_events.action`). «new» no se elige: es no tener ninguna.
 */
export const TIPOS_DE_ACCION = ["made_contact", "no_answer", "appointment", "quote", "negotiation", "closed", "lost", "bad_lead"] as const;
export type TipoDeAccion = (typeof TIPOS_DE_ACCION)[number];

/** Todas las etapas de la lista, en orden: New primero. */
export const ETAPAS = ["new", ...TIPOS_DE_ACCION] as const;
export type Etapa = (typeof ETAPAS)[number];

const ETAPA_TXT: Record<Etapa, { en: string; es: string }> = {
  new: { en: "New", es: "Nuevo" },
  made_contact: { en: "Made Contact", es: "Hizo contacto" },
  no_answer: { en: "Didn't Answer", es: "No contestó" },
  appointment: { en: "Had Appointment", es: "Tuvo cita" },
  quote: { en: "Made Quote", es: "Hizo cotización" },
  negotiation: { en: "Under Negotiation", es: "En negociación" },
  closed: { en: "Closed (sale made)", es: "Cerrado (venta lograda)" },
  lost: { en: "Lost (nothing came of it)", es: "Perdido (no se logró nada)" },
  bad_lead: { en: "Not a good lead", es: "No es buen lead" },
};

export const esTipoDeAccion = (v: unknown): v is TipoDeAccion => typeof v === "string" && (TIPOS_DE_ACCION as readonly string[]).includes(v);
export const esEtapa = (v: unknown): v is Etapa => typeof v === "string" && (ETAPAS as readonly string[]).includes(v);

export function etapaLabel(e: Etapa, lang: Idioma): string {
  return ETAPA_TXT[e][lang];
}
/** Lo mismo con el nombre de antes (la pestaña de historial y las píldoras lo usan). */
export const accionLabel = (a: TipoDeAccion, lang: Idioma): string => etapaLabel(a, lang);

/** La etapa de un lead: la de su última nota con etapa; sin ninguna, «new». */
export function etapaDe(l: Pick<Lead, "follow_up_action">): Etapa {
  return esTipoDeAccion(l.follow_up_action) ? l.follow_up_action : "new";
}

/** El color de la píldora: verde lo que se vendió, rojo lo que se cae, ámbar lo que espera, gris lo que no empieza. */
export function etapaTono(e: Etapa): "gris" | "verde" | "ambar" | "rojo" | "azul" {
  if (e === "new") return "gris";
  if (e === "closed") return "verde";
  if (e === "lost" || e === "bad_lead") return "rojo";
  if (e === "no_answer") return "ambar";
  return "azul";
}
export function accionTono(a: TipoDeAccion): "verde" | "ambar" | "rojo" | "azul" {
  const t = etapaTono(a);
  return t === "gris" ? "azul" : t;
}

/** Cuántos leads hay en cada etapa (los archivados no cuentan: no se ven). */
export function cuentaPorEtapa(leads: readonly Lead[]): Record<Etapa, number> {
  const n = Object.fromEntries(ETAPAS.map((e) => [e, 0])) as Record<Etapa, number>;
  for (const l of leads) if (l.status !== "archived") n[etapaDe(l)]++;
  return n;
}

/**
 * Lo que hace `lead_note` (328), sobre un lead en memoria. `ahora` en ISO.
 *  - Con etapa: la etapa es esa. `closed` = venta: `won`, a nombre de quien anota. Cualquier otra: `free`, sin dueño.
 *  - Sin etapa: la nota es obligatoria; la etapa, el estado y el dueño NO cambian.
 *  - Siempre: la nota, la fecha de la nota y quién hizo el último contacto (quien anota).
 * Un lead archivado no recibe notas (la base responde «no existe»).
 */
export function aplicarNota(lead: Lead, yo: Persona, nota: string, ahora: string, accion: TipoDeAccion | null = null): Hecho<Lead> {
  if (accion !== null && !esTipoDeAccion(accion)) return { ok: false, motivo: "dato_invalido" };
  const n = notaLimpia(nota);
  if (!n && accion === null) return { ok: false, motivo: "falta_nota" };
  if ((nota ?? "").trim().length > NOTA_MAX) return { ok: false, motivo: "dato_invalido" };
  if (lead.status === "archived") return { ok: false, motivo: "no_existe" };
  const venta = accion === "closed";
  const sinEtapa = accion === null;
  return {
    ok: true,
    valor: {
      ...lead,
      follow_up_note: n,
      follow_up_action: accion ?? lead.follow_up_action,
      follow_up_at: ahora,
      status: sinEtapa ? lead.status : venta ? "won" : "free",
      holder: sinEtapa ? lead.holder : venta ? yo.id : null,
      holder_name: sinEtapa ? lead.holder_name : venta ? yo.name : null,
      taken_at: sinEtapa || venta ? lead.taken_at : null,
      last_by: yo.id, last_by_name: yo.name, last_at: ahora,
      touched_at: ahora,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// El banco: pools, filtros y orden
// ---------------------------------------------------------------------------------------------------------------

/** El pool de los leads sin tienda cercana (la base lo llama así; la pantalla lo traduce). */
export const POOL_SIN_TIENDA = "No store";

export interface ResumenDePool { pool: string; total: number }

/** Quita lo archivado: no se ve en el banco ni cuenta. */
export const vigentes = (leads: readonly Lead[]): Lead[] => leads.filter((l) => l.status !== "archived");

/** Los pools que hay, con cuántos leads vigentes. Por nombre; el de «sin tienda», al final. */
export function poolsDe(leads: readonly Lead[]): ResumenDePool[] {
  const m = new Map<string, ResumenDePool>();
  for (const l of vigentes(leads as Lead[])) {
    const r = m.get(l.pool) ?? { pool: l.pool, total: 0 };
    r.total++;
    m.set(l.pool, r);
  }
  return [...m.values()].sort((a, b) =>
    a.pool === POOL_SIN_TIENDA ? 1 : b.pool === POOL_SIN_TIENDA ? -1 : a.pool.localeCompare(b.pool));
}

/**
 * «Todas las tiendas» en el selector del GOV Pool (D-631). Lo ofrece quien alcanza más de una tienda (`eligeTienda`);
 * no es un pool de la base, es no filtrar por tienda (`filtroDePool` → `null`).
 */
export const POOL_TODAS = "__todas__";

/** El pool con el que se filtra: `null` (todas) si se eligió «Todas las tiendas». */
export const filtroDePool = (pool: string | null): string | null => (pool === POOL_TODAS ? null : pool);

/** Lo que cuenta «Todas las tiendas»: la suma de los pools. */
export function resumenDeTodas(pools: readonly ResumenDePool[]): ResumenDePool {
  return pools.reduce((t, p) => ({ ...t, total: t.total + p.total }), { pool: POOL_TODAS, total: 0 });
}

/**
 * Con qué pool se entra. El admin (`todasPorDefecto`), en «Todas las tiendas» si hay más de una (D-631). Los demás,
 * el de su tienda si existe; si no (sin tienda), el primero.
 */
export function poolInicial(pools: readonly ResumenDePool[], tienda: string | null, todasPorDefecto = false): string | null {
  if (todasPorDefecto && pools.length > 1) return POOL_TODAS;
  if (tienda && pools.some((p) => p.pool === tienda)) return tienda;
  return pools[0]?.pool ?? null;
}

/** El filtro de categoría de entrada: lo que sirve y lo que podría servir. `todas` enseña también lo descartado. */
export type FiltroCategoria = "utiles" | "todas" | string;

/** ¿Es una categoría de las que NO sirven? En el Excel empiezan por «No sirve». */
export function categoriaDescartada(categoria: string | null): boolean {
  return (categoria ?? "").trim().toLowerCase().startsWith("no sirve");
}

/** ¿La categoría del Excel es de las buenas? Empieza por «Sirve» («Sirve – usa piso»); «Might be useful» no entra. */
export function categoriaBuena(categoria: string | null): boolean {
  return (categoria ?? "").trim().toLowerCase().startsWith("sirve");
}

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * D-763: la búsqueda mira TODO el lead («buscar lo que sea hasta por sales people», el dueño, 2026-10-30): cada campo de
 * texto o número, incluido quién anotó la última vez, teléfonos y la razón del cruce. Fuera quedan solo los ids y las
 * fechas en bruto (no se buscan a mano).
 */
const NO_SE_BUSCA = new Set(["id", "holder", "last_by", "customer_match_id", "taken_at", "touched_at", "follow_up_at", "last_at", "matched_at", "distance_miles", "times_seen", "last_seen_at"]);
function textoDe(l: Lead, extra?: (l: Lead) => string): string {
  const partes: string[] = [];
  for (const [k, v] of Object.entries(l)) {
    if (NO_SE_BUSCA.has(k) || v === null || v === undefined) continue;
    if (typeof v === "string" || typeof v === "number") partes.push(String(v));
  }
  const e = extra?.(l);
  if (e) partes.push(e);
  return sinAcentos(partes.join(" · "));
}

export interface Filtros {
  pool: string | null;
  categoria: FiltroCategoria;
  tipo: string;
  ciudad: string;
  busca: string;
  /** La etapa del lead (328). "" = todas. */
  etapa?: Etapa | "";
  /** El chip «categoría buena»: solo las que empiezan por «Sirve». */
  buena?: boolean;
  /** D-760: solo los que coinciden con un cliente de Clientes. */
  coinciden?: boolean;
  /** D-763: texto de fuera del lead que también cuenta al buscar (el cliente cruzado y su vendedor). */
  textoExtra?: (l: Lead) => string;
}

/**
 * Los leads del banco que pasan los filtros. Lo archivado no entra nunca. La etapa se mira en `etapaDe`.
 */
export function filtrar(leads: readonly Lead[], f: Filtros): Lead[] {
  const q = sinAcentos(f.busca.trim());
  return leads.filter((l) => {
    if (l.status === "archived") return false;
    if (f.pool !== null && l.pool !== f.pool) return false;
    if (f.coinciden && !coincideConCliente(l)) return false;
    if (f.buena && !categoriaBuena(l.category)) return false;
    if (f.etapa && etapaDe(l) !== f.etapa) return false;
    if (f.categoria === "utiles") { if (categoriaDescartada(l.category)) return false; }
    else if (f.categoria !== "todas" && l.category !== f.categoria) return false;
    if (f.tipo && l.project_type !== f.tipo) return false;
    if (f.ciudad && l.site_city !== f.ciudad) return false;
    if (q && !textoDe(l, f.textoExtra).includes(q)) return false;
    return true;
  });
}

export type Orden = "pies" | "distancia" | "costo" | "fecha" | "nombre";

/** D-804: el nombre por el que se ordena A–Z: el constructor/contratista (`owner_name`), si no el propietario; vacío al final. */
export function nombreParaOrdenar(l: Pick<Lead, "owner_name" | "tenant_name">): string {
  return ((l.owner_name ?? "").trim() || (l.tenant_name ?? "").trim()).toLowerCase();
}

/** El orden con el que nace el GOV Pool (D-491). El dueño, 2026-10-07: «sorted by square ft en leads se hizo?». */
export const ORDEN_INICIAL: Orden = "pies";

/**
 * Ordena sin tocar la lista que recibe. Pies²: los más grandes primero (D-491). Distancia: lo más cerca primero. Costo:
 * lo más caro primero. Fecha: lo registrado más reciente primero. Lo que no tiene el dato va al final en todos; a
 * igualdad, por TABS (estable).
 */
export function ordenar(leads: readonly Lead[], orden: Orden): Lead[] {
  // D-804 (Everto Prado: «can we add A-Z sorting on builder / customer»): por nombre, A–Z; sin nombre, al final.
  if (orden === "nombre") {
    return [...leads].sort((a, b) => {
      const x = nombreParaOrdenar(a), y = nombreParaOrdenar(b);
      if (!x && y) return 1;
      if (x && !y) return -1;
      return x.localeCompare(y) || a.tabs_project.localeCompare(b.tabs_project);
    });
  }
  const clave = (l: Lead): number | null =>
    orden === "pies" ? (l.square_footage === null ? null : -l.square_footage)
    : orden === "distancia" ? l.distance_miles
    : orden === "costo" ? (l.estimated_cost === null ? null : -l.estimated_cost)
    : l.registered_date ? -Date.parse(l.registered_date) : null;
  return [...leads].sort((a, b) => {
    const x = clave(a), y = clave(b);
    if (x === null && y !== null) return 1;
    if (x !== null && y === null) return -1;
    if (x !== null && y !== null && x !== y) return x - y;
    return a.tabs_project.localeCompare(b.tabs_project);
  });
}

/** Los valores distintos de una columna, ordenados, para llenar un desplegable. */
export function valoresDe(leads: readonly Lead[], campo: "category" | "project_type" | "site_city"): string[] {
  return [...new Set(leads.map((l) => l[campo]).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------------------------------------------
// El tablero del admin
// ---------------------------------------------------------------------------------------------------------------

export interface FilaDeVendedor { id: string; nombre: string; notas: number; cotizaciones: number; ventas: number }

/**
 * Por persona, a partir del historial: cuántas notas ha anotado, cuántas de ellas son de cotización y cuántas de venta.
 * Quien anota es el `actor` de la fila. Las ventas de la 162 (un cierre `closed` con resultado `sale`) cuentan también.
 */
export function tableroPorVendedor(eventos: readonly EventoLead[]): FilaDeVendedor[] {
  const m = new Map<string, FilaDeVendedor>();
  const fila = (id: string, nombre: string | null) => {
    const f = m.get(id) ?? { id, nombre: nombre ?? "—", notas: 0, cotizaciones: 0, ventas: 0 };
    if (nombre && f.nombre === "—") f.nombre = nombre;
    m.set(id, f);
    return f;
  };
  for (const e of eventos) {
    if (!e.actor) continue;
    if (e.kind === "progress") {
      const f = fila(e.actor, e.actor_name);
      f.notas++;
      if (e.action === "quote") f.cotizaciones++;
      if (e.action === "closed") f.ventas++;
    } else if (e.kind === "closed" && e.outcome === "sale") {
      fila(e.actor, e.actor_name).ventas++;
    }
  }
  return [...m.values()].sort((a, b) => b.ventas - a.ventas || b.notas - a.notas || a.nombre.localeCompare(b.nombre));
}

export interface FilaDeTienda {
  pool: string;
  porEtapa: Record<Etapa, number>;
  /** Leads de esta tienda con al menos una nota de cotización en el historial. */
  cotizadosAlgunaVez: number;
  total: number;
}

/**
 * Por GOV Pool (tienda): cuántos leads vigentes hay en cada etapa, cuántos han tenido alguna vez una cotización en el
 * historial (un evento `progress` con etapa `quote`) y el total. Lo archivado no entra.
 */
export function tableroPorTienda(leads: readonly Lead[], eventos: readonly EventoLead[]): FilaDeTienda[] {
  const conCotizacion = new Set(eventos.filter((e) => e.kind === "progress" && e.action === "quote").map((e) => e.lead_id));
  const m = new Map<string, Lead[]>();
  for (const l of vigentes(leads as Lead[])) m.set(l.pool, [...(m.get(l.pool) ?? []), l]);
  return poolsDe(leads as Lead[]).map((p) => {
    const de = m.get(p.pool) ?? [];
    return { pool: p.pool, porEtapa: cuentaPorEtapa(de), cotizadosAlgunaVez: de.filter((l) => conCotizacion.has(l.id)).length, total: de.length };
  });
}

/** Cuántos leads (vigentes) aparecieron en más de una carga. */
export const cuantosVistosMasDeUna = (leads: readonly Lead[]): number =>
  vigentes(leads as Lead[]).filter((l) => vecesVisto(l) > 1).length;

// ---------------------------------------------------------------------------------------------------------------
// Textos y enlaces
// ---------------------------------------------------------------------------------------------------------------

type Idioma = "en" | "es";

const RESULTADO_TXT: Record<Etiqueta, { en: string; es: string }> = {
  sale: { en: "Sale made", es: "Venta lograda" },
  bad_lead: { en: "Not a good lead", es: "No es buen lead" },
  nothing: { en: "Nothing came of it", es: "No se logró nada" },
  review: { en: "Needs review", es: "Ocupa revisión" },
  reassign: { en: "Better to reassign it", es: "Mejor reasignarlo" },
  admin: { en: "Admin note", es: "Nota del admin" },
};
/** El texto de un resultado de la 162 (solo para leer el historial viejo). */
export function resultadoLabel(r: Etiqueta, lang: Idioma): string { return RESULTADO_TXT[r][lang]; }

const ESTADO_TXT: Record<EstadoLead, { en: string; es: string }> = {
  free: { en: "Free", es: "Libre" },
  taken: { en: "Taken", es: "Tomado" },
  won: { en: "Sale made", es: "Venta lograda" },
  review: { en: "In review", es: "En revisión" },
  archived: { en: "Archived", es: "Archivado" },
};
export function estadoLabel(e: EstadoLead, lang: Idioma): string { return ESTADO_TXT[e][lang]; }

const EVENTO_TXT: Record<TipoDeEvento, { en: string; es: string }> = {
  imported: { en: "Imported", es: "Importado" },
  taken: { en: "Taken (before 328)", es: "Tomado (antes de la 328)" },
  progress: { en: "Progress note", es: "Nota de avance" },
  closed: { en: "Closed", es: "Cerrado" },
  released: { en: "Released by admin", es: "Liberado por el admin" },
  assigned: { en: "Assigned by admin", es: "Asignado por el admin" },
  archived: { en: "Archived by admin", es: "Archivado por el admin" },
};
/** Lo que dice una fila del historial. Una nota de avance dice su etapa (si la tiene); un cierre viejo, su resultado. */
export function eventoLabel(e: EventoLead, lang: Idioma): string {
  if (e.kind === "progress" && e.action) return accionLabel(e.action, lang);
  const base = EVENTO_TXT[e.kind][lang];
  return e.kind === "closed" && e.outcome ? `${base}: ${resultadoLabel(e.outcome, lang)}` : base;
}

/** Las categorías y los tipos del Excel están en español: su traducción. Lo que no está aquí sale tal cual. */
const DEL_EXCEL_EN: Record<string, string> = {
  "Sirve – usa piso": "Useful – uses flooring",
  "Might be useful": "Might be useful",
  "No sirve – no lleva piso": "Not useful – no flooring",
  "No sirve – cadena / franquicia": "Not useful – chain / franchise",
  "Remodelación de baños / interior": "Bathroom / interior remodel",
  "Vivienda (casas, apartamentos)": "Housing (houses, apartments)",
  "Warehouse / industrial": "Warehouse / industrial",
  "Clínica / médico": "Clinic / medical",
  "Almacenaje (storage)": "Storage",
  "Oficinas / suites": "Offices / suites",
  "Plaza / local comercial": "Plaza / retail space",
  "Restaurante / comida": "Restaurant / food",
  "Gobierno / público": "Government / public",
  "Autos (agencia, taller, lavado)": "Auto (dealer, shop, car wash)",
  "Escuela / educación": "School / education",
  "Otro / sin clasificar": "Other / unclassified",
  "Hotel": "Hotel",
  "Gimnasio / entretenimiento": "Gym / entertainment",
  "Iglesia": "Church",
  "Infraestructura / vialidad": "Infrastructure / roads",
  "Obra sin piso (techo, A/C, estacionamiento, jardinería…)": "No-flooring work (roof, A/C, parking, landscaping…)",
  "Gasolinera / conveniencia": "Gas station / convenience",
};
export function delExcel(texto: string | null, lang: Idioma): string {
  if (!texto) return "—";
  return lang === "en" ? (DEL_EXCEL_EN[texto] ?? texto) : texto;
}

export function poolLabel(pool: string, lang: Idioma): string {
  return pool === POOL_SIN_TIENDA ? (lang === "es" ? "Sin tienda" : "No store") : pool;
}

/** El enlace a Google Maps de la dirección de la obra. null si no hay dirección. */
export function mapsUrl(l: Pick<Lead, "site_address" | "site_city" | "site_zip">): string | null {
  const partes = [l.site_address, l.site_city, "TX", l.site_zip].map((x) => (x ?? "").trim());
  if (!partes[0] && !partes[1]) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(partes.filter(Boolean).join(", "))}`;
}

/** El enlace `tel:` de un teléfono escrito de cualquier manera. null si no tiene al menos 7 dígitos. */
export function telUrl(telefono: string | null): string | null {
  const t = (telefono ?? "").trim();
  const digitos = t.replace(/\D/g, "");
  if (digitos.length < 7) return null;
  return `tel:${t.startsWith("+") ? "+" : ""}${digitos}`;
}

/** Solo se enlaza a TDLR si de verdad es un enlace https: el dato viene de un Excel. */
export function enlaceSeguro(url: string | null): string | null {
  const u = (url ?? "").trim();
  return /^https:\/\/[^\s]+$/i.test(u) ? u : null;
}

export function dinero(n: number | null): string {
  return n === null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`;
}
export function numero(n: number | null): string {
  return n === null ? "—" : Math.round(n).toLocaleString("en-US");
}
/** Una fecha `AAAA-MM-DD` (o un instante ISO) como MM/DD/AAAA, sin pasar por zonas horarias. */
export function fecha(iso: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "—";
}

const NEGATIVA_TXT: Record<Negativa, { en: string; es: string }> = {
  lleno: { en: "You cannot add more leads right now.", es: "Ahora no puedes añadir más leads." },
  no_libre: { en: "That lead is no longer free.", es: "Ese lead ya no está libre." },
  falta_nota: { en: "Write a note or pick a stage first.", es: "Escribe una nota o elige una etapa primero." },
  no_es_tuyo: { en: "You cannot change that lead.", es: "No puedes cambiar ese lead." },
  sin_permiso: { en: "You do not have permission for that.", es: "No tienes permiso para eso." },
  no_existe: { en: "That lead no longer exists.", es: "Ese lead ya no existe." },
  dato_invalido: { en: "The database rejected that value.", es: "La base rechazó ese dato." },
  otra_tienda: { en: "That lead belongs to another store.", es: "Ese lead es de otra tienda." },
};
export function negativaTexto(n: Negativa, lang: Idioma): string { return NEGATIVA_TXT[n][lang]; }

/** El código de error de la base (los `LD00x` de la 162 y la 163 y los de Postgres) como una negativa que se puede traducir. */
export function negativaDeCodigo(code: string | null | undefined): Negativa | null {
  switch (code) {
    case "LD001": return "lleno";
    case "LD002": return "no_libre";
    case "LD003": return "falta_nota";
    case "LD004": return "no_es_tuyo";
    case "LD005": return "otra_tienda";
    case "42501": return "sin_permiso";
    case "P0002": return "no_existe";
    case "22023": return "dato_invalido";
    default: return null;
  }
}
