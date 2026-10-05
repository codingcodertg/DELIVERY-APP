/**
 * «Leads» (migración 162): las reglas, sin navegador y sin base.
 *
 * La base es quien manda (las funciones `lead_take`, `lead_note`, `lead_close` y las del admin): lo de aquí es lo
 * MISMO escrito otra vez para tres cosas — que la pantalla no ofrezca un botón que la base va a rechazar, que el
 * modo demo se comporte como la base, y que cada regla tenga una prueba que se pueda leer.
 */

/** El tope de leads abiertos por persona si la base no dice otra cosa (`lead_settings.max_open`). */
export const TOPE_POR_DEFECTO = 10;

export type EstadoLead = "free" | "taken" | "won" | "review" | "archived";

/** Con qué se CIERRA un lead. «Visitado, en seguimiento» no está aquí a propósito: es una nota de avance, no un cierre. */
export const RESULTADOS = ["sale", "bad_lead", "nothing", "review", "reassign"] as const;
export type Resultado = (typeof RESULTADOS)[number];

/** La etiqueta con la que un lead vuelve al banco: un resultado de cierre, o una nota del admin al liberarlo. */
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
  holder: string | null;
  holder_name: string | null;
  taken_at: string | null;
  touched_at: string | null;
  follow_up_note: string | null;
  follow_up_at: string | null;
  last_outcome: Etiqueta | null;
  last_note: string | null;
  last_by: string | null;
  last_by_name: string | null;
  last_at: string | null;
}

export type TipoDeEvento = "imported" | "taken" | "progress" | "closed" | "released" | "assigned" | "archived";

export interface EventoLead {
  id: number;
  lead_id: string;
  at: string;
  kind: TipoDeEvento;
  outcome: Resultado | null;
  note: string | null;
  actor: string | null;
  actor_name: string | null;
  subject: string | null;
  subject_name: string | null;
}

/** Quien mira. `admin` entra siempre y es el único que reasigna, libera, archiva y cambia el tope. */
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

// ---------------------------------------------------------------------------------------------------------------
// El tope y tomar
// ---------------------------------------------------------------------------------------------------------------

/** Los leads ABIERTOS de una persona: los que tiene tomados. Una venta lograda es suya pero NO ocupa puesto. */
export function abiertosDe(leads: readonly Lead[], persona: string): Lead[] {
  return leads.filter((l) => l.status === "taken" && l.holder === persona);
}

/** Las ventas logradas de una persona: suyas para siempre, fuera del banco. */
export function ventasDe(leads: readonly Lead[], persona: string): Lead[] {
  return leads.filter((l) => l.status === "won" && l.holder === persona);
}

/** Cuántos puestos le quedan. Nunca negativo: si el admin bajó el tope por debajo de lo que tiene, le quedan 0. */
export function puestosLibres(leads: readonly Lead[], persona: string, tope: number): number {
  return Math.max(0, tope - abiertosDe(leads, persona).length);
}

export type Negativa = "lleno" | "no_libre" | "falta_nota" | "no_es_tuyo" | "sin_permiso" | "no_existe" | "dato_invalido" | "otra_tienda";

/**
 * ¿Puede esta persona tomar este lead? El orden es el de `lead_take`: primero el tope, después que el lead esté libre.
 * Solo se toma lo que está LIBRE: ni lo tomado, ni una venta, ni lo que está en revisión, ni lo archivado.
 */
export function puedeTomar(lead: Lead, leads: readonly Lead[], persona: string, tope: number): { ok: true } | { ok: false; motivo: Negativa } {
  if (abiertosDe(leads, persona).length >= tope) return { ok: false, motivo: "lleno" };
  if (lead.status !== "free") return { ok: false, motivo: "no_libre" };
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------
// Cerrar
// ---------------------------------------------------------------------------------------------------------------

/**
 * A dónde va un lead al cerrarlo, y con quién se queda. Todo cierre libera el puesto de quien lo cierra, porque
 * el puesto lo ocupa solo lo que está `taken`:
 *
 * - `sale` → `won`: se queda SUYO, fuera del banco.
 * - `review` → `review`: a la cola del admin, sin dueño; nadie lo puede tomar hasta que el admin decida.
 * - `bad_lead`, `nothing`, `reassign` → `free`: vuelve al banco con la etiqueta y la nota.
 */
export function destinoAlCerrar(resultado: Resultado): { estado: EstadoLead; conservaDueno: boolean } {
  if (resultado === "sale") return { estado: "won", conservaDueno: true };
  if (resultado === "review") return { estado: "review", conservaDueno: false };
  return { estado: "free", conservaDueno: false };
}

/** La nota, recortada. Vacía o solo espacios, no vale: sin nota no se cierra ni se anota. */
export function notaLimpia(nota: string | null | undefined): string | null {
  const n = (nota ?? "").trim();
  return n.length > 0 && n.length <= NOTA_MAX ? n : null;
}
export const NOTA_MAX = 2000;

export type Hecho<T> = { ok: true; valor: T } | { ok: false; motivo: Negativa };

/** Lo que hace `lead_take`, sobre un lead en memoria. `ahora` en ISO. */
export function aplicarTomar(lead: Lead, leads: readonly Lead[], yo: Persona, tope: number, ahora: string): Hecho<Lead> {
  const p = puedeTomar(lead, leads, yo.id, tope);
  if (!p.ok) return p;
  return { ok: true, valor: { ...lead, status: "taken", holder: yo.id, holder_name: yo.name, taken_at: ahora, touched_at: ahora, follow_up_note: null, follow_up_at: null } };
}

/** Lo que hace `lead_note`: la nota de avance. El lead SIGUE abierto y sigue ocupando su puesto. */
export function aplicarNota(lead: Lead, yo: Persona, nota: string, ahora: string): Hecho<Lead> {
  const n = notaLimpia(nota);
  if (!n) return { ok: false, motivo: "falta_nota" };
  if (lead.status !== "taken" || lead.holder !== yo.id) return { ok: false, motivo: "no_es_tuyo" };
  return { ok: true, valor: { ...lead, follow_up_note: n, follow_up_at: ahora, touched_at: ahora } };
}

/** Lo que hace `lead_close`: cerrar con resultado y nota obligatoria. Solo quien lo tiene abierto. */
export function aplicarCerrar(lead: Lead, yo: Persona, resultado: Resultado, nota: string, ahora: string): Hecho<Lead> {
  const n = notaLimpia(nota);
  if (!n) return { ok: false, motivo: "falta_nota" };
  if (lead.status !== "taken" || lead.holder !== yo.id) return { ok: false, motivo: "no_es_tuyo" };
  const d = destinoAlCerrar(resultado);
  return {
    ok: true,
    valor: {
      ...lead,
      status: d.estado,
      holder: d.conservaDueno ? lead.holder : null,
      holder_name: d.conservaDueno ? lead.holder_name : null,
      taken_at: d.conservaDueno ? lead.taken_at : null,
      follow_up_note: d.conservaDueno ? lead.follow_up_note : null,
      follow_up_at: d.conservaDueno ? lead.follow_up_at : null,
      last_outcome: resultado, last_note: n, last_by: yo.id, last_by_name: yo.name, last_at: ahora, touched_at: ahora,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Quién ve qué
// ---------------------------------------------------------------------------------------------------------------

/**
 * ¿Se le enseña a esta persona el contacto del lead (dueño, teléfono, inquilino, despacho)?
 *
 * Sí si el lead está LIBRE (lo necesita para decidir si lo toma), si es SUYO, o si es admin. De un lead que tiene
 * otra persona, o que está en revisión o archivado, la tarjeta sale apagada y sin el contacto: es lo que el dueño
 * pidió («faded y bloqueadas»). **Es una regla de la pantalla, no de la base**: la RLS deja leer la fila entera a
 * quien la alcanza (con la 162, todo el que tiene el módulo; con la 163, los de su tienda y los suyos: `alcance.ts`).
 */
export function veContacto(lead: Lead, yo: Persona): boolean {
  if (yo.admin) return true;
  if (lead.status === "free") return true;
  return lead.holder === yo.id;
}

/** ¿La tarjeta sale apagada y bloqueada? Todo lo que no está libre, salvo lo que es de quien mira. */
export function bloqueado(lead: Lead, yo: Persona): boolean {
  return lead.status !== "free" && lead.holder !== yo.id;
}

// ---------------------------------------------------------------------------------------------------------------
// El banco: pools, vistas, filtros y orden
// ---------------------------------------------------------------------------------------------------------------

/** El pool de los leads sin tienda cercana (la base lo llama así; la pantalla lo traduce). */
export const POOL_SIN_TIENDA = "No store";

export interface ResumenDePool { pool: string; libres: number; tomados: number; total: number }

/** Los pools que hay, con cuántos libres y cuántos tomados. Por nombre; el de «sin tienda», al final. */
export function poolsDe(leads: readonly Lead[]): ResumenDePool[] {
  const m = new Map<string, ResumenDePool>();
  for (const l of leads) {
    const r = m.get(l.pool) ?? { pool: l.pool, libres: 0, tomados: 0, total: 0 };
    r.total++;
    if (l.status === "free") r.libres++;
    if (l.status === "taken") r.tomados++;
    m.set(l.pool, r);
  }
  return [...m.values()].sort((a, b) =>
    a.pool === POOL_SIN_TIENDA ? 1 : b.pool === POOL_SIN_TIENDA ? -1 : a.pool.localeCompare(b.pool));
}

/** Con qué pool se entra: el de la tienda de la persona si existe; si no (admin, sin tienda), el primero. */
export function poolInicial(pools: readonly ResumenDePool[], tienda: string | null): string | null {
  if (tienda && pools.some((p) => p.pool === tienda)) return tienda;
  return pools[0]?.pool ?? null;
}

/** Las dos vistas del banco. `libres` es la de entrada. */
export type Vista = "libres" | "todas";

/** El filtro de categoría de entrada: lo que sirve y lo que podría servir. `todas` enseña también lo descartado. */
export type FiltroCategoria = "utiles" | "todas" | string;

/** ¿Es una categoría de las que NO sirven? En el Excel empiezan por «No sirve». */
export function categoriaDescartada(categoria: string | null): boolean {
  return (categoria ?? "").trim().toLowerCase().startsWith("no sirve");
}

/**
 * Los filtros rápidos por situación del lead (D-473). `""` = sin filtro. Con uno puesto, la vista «Libres / Todas»
 * no cuenta: «Ocupa revisión», «Tomados» y «Vendidos» no son leads libres y si no nunca saldrían.
 */
export const SITUACIONES = ["buenos", "revision", "negados", "nada", "reasignar", "tomados", "vendidos"] as const;
export type Situacion = (typeof SITUACIONES)[number];

/** ¿La categoría del Excel es de las buenas? Empieza por «Sirve» («Sirve – usa piso»); «Might be useful» no entra. */
export function categoriaBuena(categoria: string | null): boolean {
  return (categoria ?? "").trim().toLowerCase().startsWith("sirve");
}

/**
 * ¿El lead está en esa situación?
 * - `buenos`: libre y de categoría buena.
 * - `revision`: en la cola del admin («Ocupa revisión»).
 * - `negados`: volvió al Pool General como «No es buen lead».
 * - `nada`: volvió como «No se logró nada».  · `reasignar`: volvió como «Mejor reasignarlo».
 * - `tomados`: alguien lo tiene.  · `vendidos`: venta lograda.
 */
export function enSituacion(l: Pick<Lead, "status" | "category" | "last_outcome">, s: Situacion): boolean {
  switch (s) {
    case "buenos": return l.status === "free" && categoriaBuena(l.category);
    case "revision": return l.status === "review";
    case "negados": return l.status === "free" && l.last_outcome === "bad_lead";
    case "nada": return l.status === "free" && l.last_outcome === "nothing";
    case "reasignar": return l.status === "free" && l.last_outcome === "reassign";
    case "tomados": return l.status === "taken";
    case "vendidos": return l.status === "won";
  }
}

/** Cuántos leads hay en cada situación, para el número de cada filtro. */
export function cuentaPorSituacion(leads: readonly Lead[]): Record<Situacion, number> {
  const n = { buenos: 0, revision: 0, negados: 0, nada: 0, reasignar: 0, tomados: 0, vendidos: 0 } as Record<Situacion, number>;
  for (const l of leads) for (const s of SITUACIONES) if (enSituacion(l, s)) n[s]++;
  return n;
}

export interface Filtros {
  pool: string | null;
  vista: Vista;
  categoria: FiltroCategoria;
  tipo: string;
  ciudad: string;
  busca: string;
  situacion?: Situacion | "";
}

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Dónde busca la caja de búsqueda. */
function textoDe(l: Lead): string {
  return sinAcentos([l.project_name, l.facility_name, l.site_address, l.site_city, l.site_zip, l.owner_name, l.scope_of_work, l.tabs_project, l.tenant_name].filter(Boolean).join(" · "));
}

/**
 * Los leads del banco que tocan. `libres` = solo lo que se puede tomar. `todas` = todo lo del pool, incluido lo
 * tomado, lo vendido, lo que está en revisión y lo archivado (la pantalla lo pinta apagado).
 */
export function filtrar(leads: readonly Lead[], f: Filtros): Lead[] {
  const q = sinAcentos(f.busca.trim());
  return leads.filter((l) => {
    if (f.pool !== null && l.pool !== f.pool) return false;
    if (f.situacion) {
      // Con situación puesta manda ella: ni la vista ni la categoría de entrada esconden lo que se pidió ver.
      if (!enSituacion(l, f.situacion)) return false;
      if (f.categoria !== "utiles" && f.categoria !== "todas" && l.category !== f.categoria) return false;
    } else {
      if (f.vista === "libres" && l.status !== "free") return false;
      if (f.categoria === "utiles") { if (categoriaDescartada(l.category)) return false; }
      else if (f.categoria !== "todas" && l.category !== f.categoria) return false;
    }
    if (f.tipo && l.project_type !== f.tipo) return false;
    if (f.ciudad && l.site_city !== f.ciudad) return false;
    if (q && !textoDe(l).includes(q)) return false;
    return true;
  });
}

export type Orden = "distancia" | "costo" | "fecha";

/**
 * Ordena sin tocar la lista que recibe. Distancia: lo más cerca primero. Costo: lo más caro primero. Fecha: lo
 * registrado más reciente primero. Lo que no tiene el dato va al final en los tres; a igualdad, por TABS (estable).
 */
export function ordenar(leads: readonly Lead[], orden: Orden): Lead[] {
  const clave = (l: Lead): number | null =>
    orden === "distancia" ? l.distance_miles
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

export interface FilaDeVendedor { id: string; nombre: string; abiertos: number; cerrados: number; ventas: number }

/**
 * Por vendedor: cuántos tiene abiertos ahora, cuántos ha cerrado (cualquier resultado) y cuántos de esos fueron venta.
 * Abiertos sale de los leads; cerrados y ventas, del historial (un cierre es un evento `closed`, y no se borra).
 */
export function tableroPorVendedor(leads: readonly Lead[], eventos: readonly EventoLead[]): FilaDeVendedor[] {
  const m = new Map<string, FilaDeVendedor>();
  const fila = (id: string, nombre: string | null) => {
    const f = m.get(id) ?? { id, nombre: nombre ?? "—", abiertos: 0, cerrados: 0, ventas: 0 };
    if (nombre && f.nombre === "—") f.nombre = nombre;
    m.set(id, f);
    return f;
  };
  for (const l of leads) if (l.status === "taken" && l.holder) fila(l.holder, l.holder_name).abiertos++;
  for (const e of eventos) {
    if (e.kind !== "closed" || !e.subject) continue;
    const f = fila(e.subject, e.subject_name);
    f.cerrados++;
    if (e.outcome === "sale") f.ventas++;
  }
  return [...m.values()].sort((a, b) => b.abiertos - a.abiertos || b.cerrados - a.cerrados || a.nombre.localeCompare(b.nombre));
}

/** Los leads tomados que nadie toca (ni nota de avance ni nada) desde hace `dias` días o más. Los más viejos primero. */
export function sinTocar(leads: readonly Lead[], dias: number, ahora: Date): Lead[] {
  const limite = ahora.getTime() - dias * 86400000;
  const cuando = (l: Lead) => Date.parse(l.touched_at ?? l.taken_at ?? "");
  return leads
    .filter((l) => l.status === "taken" && Number.isFinite(cuando(l)) && cuando(l) <= limite)
    .sort((a, b) => cuando(a) - cuando(b));
}

/** La cola del admin: lo que alguien cerró como «ocupa revisión». Lo más antiguo primero. */
export function colaDeRevision(leads: readonly Lead[]): Lead[] {
  return leads.filter((l) => l.status === "review").sort((a, b) => Date.parse(a.last_at ?? "") - Date.parse(b.last_at ?? ""));
}

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
export function resultadoLabel(r: Etiqueta, lang: Idioma): string { return RESULTADO_TXT[r][lang]; }

const SITUACION_TXT: Record<Situacion, { en: string; es: string }> = {
  buenos: { en: "Good leads", es: "Buenos leads" },
  revision: { en: "Needs review", es: "Ocupa revisión" },
  negados: { en: "Rejected", es: "Negados" },
  nada: { en: "Nothing came of it", es: "No se logró nada" },
  reasignar: { en: "To reassign", es: "Por reasignar" },
  tomados: { en: "Taken", es: "Tomados" },
  vendidos: { en: "Sold", es: "Vendidos" },
};
export function situacionLabel(s: Situacion, lang: Idioma): string { return SITUACION_TXT[s][lang]; }

/** Qué le pasa al lead con cada resultado, dicho en la pantalla antes de cerrar. Sale de `destinoAlCerrar`. */
export function consecuencia(r: Resultado, lang: Idioma): string {
  const d = destinoAlCerrar(r);
  if (d.estado === "won") return lang === "es" ? "Se queda contigo, fuera del Pool General." : "It stays yours, out of the General Pool.";
  if (d.estado === "review") return lang === "es" ? "Va a la cola del admin." : "It goes to the admin's queue.";
  return lang === "es" ? "Vuelve al Pool General con esta etiqueta y tu nota." : "It goes back to the General Pool with this tag and your note.";
}

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
  taken: { en: "Taken", es: "Tomado" },
  progress: { en: "Visited – following up", es: "Visitado – en seguimiento" },
  closed: { en: "Closed", es: "Cerrado" },
  released: { en: "Released by admin", es: "Liberado por el admin" },
  assigned: { en: "Assigned by admin", es: "Asignado por el admin" },
  archived: { en: "Archived by admin", es: "Archivado por el admin" },
};
export function eventoLabel(e: EventoLead, lang: Idioma): string {
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
  lleno: { en: "Your pool is full. Close a lead with its result to take another.", es: "Tu pool está lleno. Cierra un lead con su resultado para tomar otro." },
  no_libre: { en: "That lead is no longer free: someone else has it.", es: "Ese lead ya no está libre: lo tiene otra persona." },
  falta_nota: { en: "Write a note first.", es: "Escribe una nota primero." },
  no_es_tuyo: { en: "That lead is not open in your pool.", es: "Ese lead no está abierto en tu pool." },
  sin_permiso: { en: "You do not have permission for that.", es: "No tienes permiso para eso." },
  no_existe: { en: "That lead no longer exists.", es: "Ese lead ya no existe." },
  dato_invalido: { en: "The database rejected that value.", es: "La base rechazó ese dato." },
  otra_tienda: { en: "That lead belongs to another store: you can only take leads from your own store.", es: "Ese lead es de otra tienda: solo puedes tomar leads de tu tienda." },
};
export function negativaTexto(n: Negativa, lang: Idioma): string { return NEGATIVA_TXT[n][lang]; }

/** El código de error de la base (los `LD00x` de la 162, el `LD005` de la 163 y los de Postgres) como una negativa que se puede traducir. */
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
