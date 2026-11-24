import type { SupabaseClient } from "@supabase/supabase-js";
import { ALCANCE_SIN_REGLA, alcanceDeLaBase, type Alcance } from "./alcance";
import { negativaDeCodigo, esTipoDeAccion, type EstadoLead, type Etiqueta, type EventoLead, type Lead, type Negativa, type TipoDeAccion } from "./reglas";
import type { LlamadaDeLead } from "./llamadas-rc";
import type { LlamadasDeVendedor, Periodo } from "./estadisticas";

/**
 * Dónde viven los leads: `public.leads` y `public.lead_events` (migración 162; la etapa y el «visto en N cargas», 328).
 * Una interfaz con dos implementaciones —la base y el demo— para que la pantalla sea la misma en las dos.
 *
 * **Se lee con la sesión de quien mira**: la política decide (`has_leads_access()`, 162; y por tienda, 163). **No hay ni una
 * escritura directa**: las tablas no tienen INSERT, UPDATE ni DELETE por la API. Todo va por funciones, y cada
 * una devuelve el lead como quedó: lo que la pantalla pinta después es lo que dijo la base, no lo que se supuso.
 *
 * Sin la 162 aplicada (el código llega antes que la migración) se devuelve `sinTabla` y la pantalla lo dice.
 */
export type Res<T> = { ok: true; valor: T } | { ok: false; sinTabla: boolean; motivo: Negativa | null; error: string };

export interface AlmacenDeLeads {
  /** Los leads que quien mira ALCANZA (los de su tienda y los suyos, o todos: lo decide la base, migración 163) y ese alcance. */
  leer(): Promise<Res<{ leads: Lead[]; alcance: Alcance }>>;
  /** El historial de UN lead, de lo más viejo a lo más nuevo. */
  historial(leadId: string): Promise<Res<EventoLead[]>>;
  /** Todo el historial (para el tablero del admin: cotizaciones, notas y ventas por persona y por tienda). */
  eventos(): Promise<Res<EventoLead[]>>;
  /**
   * La nota de avance (328): con una etapa, esa es la etapa del lead; sin etapa, la nota es obligatoria. Quien VE el
   * lead puede anotar. Devuelve el lead como quedó.
   */
  anotar(leadId: string, nota: string, etapa: TipoDeAccion | null): Promise<Res<Lead>>;
  /**
   * Pone (o quita, con `telefono` null) el teléfono A MANO del contratista (`owner`) o del propietario (`tenant`). Quien
   * VE el lead puede. La base valida y deja la nota en el historial (335). Sin la 335, `motivo` es `sin_migracion`.
   */
  guardarTelefono(leadId: string, quien: "owner" | "tenant", telefono: string | null, ext: string | null, contacto: string | null): Promise<Res<Lead>>;
  /** Archivar (solo admin). Un archivado no se ve en el banco. */
  archivar(leadId: string, nota: string): Promise<Res<Lead>>;
  /**
   * D-762: los clientes con los que coinciden los leads cruzados (218): cuenta, tienda y el vendedor que los lleva hoy
   * (nombre del perfil, o null). Se leen de `erp.customers` con la sesión de quien mira: el admin los ve todos.
   */
  clientesCruzados(ids: readonly number[]): Promise<Res<Map<number, ClienteCruzado>>>;
  /**
   * Las llamadas de RingCentral a los teléfonos de UN lead, la más nueva primero (337). Quien VE el lead puede; a quien no
   * lo ve la base la niega (`error` con el código 42501 o P0002, y la pantalla deja la lista vacía).
   */
  llamadasDeLead(leadId: string): Promise<Res<LlamadaDeLead[]>>;
  /** La URL firmada (10 minutos) para escuchar una de esas llamadas. Sin grabación o sin ver el lead, `ok: false`. */
  grabacionDeLlamada(leadId: string, llamadaId: string): Promise<Res<string>>;
  /** Las llamadas del rango por nombre de vendedor (RingCentral). Solo admin y gerente (337). */
  llamadasPorVendedor(periodo: Periodo): Promise<Res<{ porVendedor: LlamadasDeVendedor[]; total: number }>>;
  /**
   * El puesto de color de cada persona que ya trabajó un lead (migración 345): 1 el primero, 2 el segundo… Nunca falla:
   * sin la 345 (la función no existe) o ante cualquier error, el mapa sale vacío y las franjas se pintan neutras.
   */
  puestosDeVendedores(): Promise<Map<string, number>>;
}

export interface ClienteCruzado {
  id: number; account: string; store: string; rep_id: string | null; rep_name: string | null;
  // D-763: lo que enseña la tarjeta del cliente dentro de Leads, sin salir a la app de Clientes.
  contact_name: string | null; contact_title: string | null; phone: string | null; email: string | null; address: string | null;
  account_no: string | null; terms: string | null; credit_limit: number | null; activity_status: string | null; status_store: string | null; notes: string | null;
}
const COLUMNAS_CRUZADO = "id, account, store, rep_id, contact_name, contact_title, phone, email, address, account_no, terms, credit_limit, activity_status, status_store, notes";

/** ¿Es «la 162 no está aplicada»? PGRST205 (tabla) / PGRST202 (función) de PostgREST; 42P01 / 42883 de Postgres. Solo esos. */
export function faltaLaTabla(error: { code?: string | null } | null | undefined): boolean {
  const code = error?.code ?? "";
  return code === "PGRST205" || code === "PGRST202" || code === "42P01" || code === "42883";
}

/**
 * ¿Es «la 163 no está aplicada»? Solo que la FUNCIÓN `leads_my_scope` no exista (PGRST202 de PostgREST, 42883 de
 * Postgres). El código llega antes que la migración: mientras tanto no hay regla por tienda y se ve como con la 162.
 * Cualquier otro error NO es esto: se dice, y no se abre nada.
 */
export function faltaElAlcance(error: { code?: string | null } | null | undefined): boolean {
  const code = error?.code ?? "";
  return code === "PGRST202" || code === "42883";
}

/**
 * Las columnas que la pantalla usa. No se pide `*`: la dirección postal del dueño no se enseña y no se baja.
 * Son tres versiones, de la más nueva a la más vieja, porque la base puede ir por detrás del código:
 *   · COLUMNAS: con la 328 (`times_seen`, `last_seen_at`) y la 253 (`follow_up_action`, la etapa).
 *   · COLUMNAS_SIN_328: sin las dos de la 328 (la etapa sí).
 *   · COLUMNAS_SIN_253: sin la etapa tampoco (lo demás es de la 162).
 * Al faltar una columna (42703 / PGRST204) se baja a la siguiente. La lista nunca se pierde por eso.
 */
export const COLUMNAS_SIN_253 =
  "id, tabs_project, pool, distance_miles, category, project_type, reason, county, registered_date, project_name, facility_name, " +
  "type_of_work, scope_of_work, square_footage, estimated_cost, est_start_date, est_completion_date, permit_status, " +
  "site_address, site_city, site_zip, owner_name, owner_phone, owner_contact, tenant_name, tenant_phone, " +
  "design_firm_name, design_firm_phone, tdlr_link, status, holder, holder_name, taken_at, touched_at, " +
  "follow_up_note, follow_up_at, last_outcome, last_note, last_by, last_by_name, last_at, source, imported_at, customer_match_id, customer_match_note";
export const COLUMNAS_SIN_328 = COLUMNAS_SIN_253.replace("follow_up_at, last_outcome", "follow_up_at, follow_up_action, last_outcome");
export const COLUMNAS_SIN_335 = COLUMNAS_SIN_328 + ", times_seen, last_seen_at";
/** Los teléfonos añadidos a mano (335). Sin la 335, la lista baja a `COLUMNAS_SIN_335` y el lead sale sin ellos. */
const COLUMNAS_TELEFONO_A_MANO = [
  "owner_phone_manual", "owner_phone_manual_contact", "owner_phone_manual_by", "owner_phone_manual_by_name", "owner_phone_manual_at",
  "tenant_phone_manual", "tenant_phone_manual_contact", "tenant_phone_manual_by", "tenant_phone_manual_by_name", "tenant_phone_manual_at",
].join(", ");
export const COLUMNAS = COLUMNAS_SIN_335 + ", " + COLUMNAS_TELEFONO_A_MANO;
/** De la más nueva a la más vieja: al faltar una columna (42703 / PGRST204) se baja a la siguiente. */
export const COLUMNAS_EN_ORDEN = [COLUMNAS, COLUMNAS_SIN_335, COLUMNAS_SIN_328, COLUMNAS_SIN_253] as const;

const EVENTO_COLUMNAS = "id, lead_id, at, kind, outcome, note, action, actor, actor_name, subject, subject_name";
const EVENTO_COLUMNAS_SIN_253 = EVENTO_COLUMNAS.replace(", action", "");

/** ¿Es «falta una columna» (la 253 o la 328 no están aplicadas)? 42703 de Postgres; PGRST204 de PostgREST. */
export const faltaLaColumna = (error: { code?: string } | null | undefined): boolean => error?.code === "42703" || error?.code === "PGRST204";

export const PAGINA = 1000;
export const MAX_PAGINAS = 20;

const texto = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
/** `numeric` llega como número o, según el camino, como texto: las dos valen; lo demás, null. */
const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const ESTADOS: readonly EstadoLead[] = ["free", "taken", "won", "review", "archived"];
const ETIQUETAS: readonly Etiqueta[] = ["sale", "bad_lead", "nothing", "review", "reassign", "admin"];

/** Una fila de la base con los tipos que la pantalla espera. Un estado desconocido se trata como archivado: no se ofrece. */
export function leadDeLaBase(f: Record<string, unknown>): Lead {
  const estado = ESTADOS.find((e) => e === f.status) ?? "archived";
  return {
    id: String(f.id), tabs_project: String(f.tabs_project ?? ""), pool: String(f.pool ?? ""),
    distance_miles: num(f.distance_miles), category: texto(f.category), project_type: texto(f.project_type),
    reason: texto(f.reason), county: texto(f.county), registered_date: texto(f.registered_date),
    project_name: texto(f.project_name), facility_name: texto(f.facility_name), type_of_work: texto(f.type_of_work),
    scope_of_work: texto(f.scope_of_work), square_footage: num(f.square_footage), estimated_cost: num(f.estimated_cost),
    est_start_date: texto(f.est_start_date), est_completion_date: texto(f.est_completion_date),
    permit_status: texto(f.permit_status), site_address: texto(f.site_address), site_city: texto(f.site_city),
    site_zip: texto(f.site_zip), owner_name: texto(f.owner_name), owner_phone: texto(f.owner_phone),
    owner_contact: texto(f.owner_contact), tenant_name: texto(f.tenant_name), tenant_phone: texto(f.tenant_phone),
    design_firm_name: texto(f.design_firm_name), design_firm_phone: texto(f.design_firm_phone), tdlr_link: texto(f.tdlr_link),
    status: estado, holder: texto(f.holder), holder_name: texto(f.holder_name), taken_at: texto(f.taken_at),
    touched_at: texto(f.touched_at), follow_up_note: texto(f.follow_up_note), follow_up_at: texto(f.follow_up_at),
    follow_up_action: esTipoDeAccion(f.follow_up_action) ? f.follow_up_action : null,
    last_outcome: ETIQUETAS.find((e) => e === f.last_outcome) ?? null, last_note: texto(f.last_note),
    last_by: texto(f.last_by), last_by_name: texto(f.last_by_name), last_at: texto(f.last_at),
    // D-760 (218): sin la columna (base vieja) se lee como 'tdlr' y sin cliente.
    source: f.source === "privado" ? "privado" : "tdlr",
    // Cuándo entró el lote (el import semanal): de ahí salen las semanas del STXP Pool (semanas.ts).
    imported_at: texto(f.imported_at),
    customer_match_id: num(f.customer_match_id), customer_match_note: texto(f.customer_match_note),
    // 328: sin la columna (base vieja), una carga y sin fecha de la última.
    times_seen: num(f.times_seen) ?? 1, last_seen_at: texto(f.last_seen_at),
    // 335: sin las columnas (base vieja), ningún teléfono a mano.
    owner_phone_manual: texto(f.owner_phone_manual), owner_phone_manual_contact: texto(f.owner_phone_manual_contact),
    owner_phone_manual_by: texto(f.owner_phone_manual_by), owner_phone_manual_by_name: texto(f.owner_phone_manual_by_name),
    owner_phone_manual_at: texto(f.owner_phone_manual_at),
    tenant_phone_manual: texto(f.tenant_phone_manual), tenant_phone_manual_contact: texto(f.tenant_phone_manual_contact),
    tenant_phone_manual_by: texto(f.tenant_phone_manual_by), tenant_phone_manual_by_name: texto(f.tenant_phone_manual_by_name),
    tenant_phone_manual_at: texto(f.tenant_phone_manual_at),
  };
}

export function eventoDeLaBase(f: Record<string, unknown>): EventoLead {
  return {
    id: Number(f.id), lead_id: String(f.lead_id), at: String(f.at), kind: f.kind as EventoLead["kind"],
    outcome: (texto(f.outcome) as EventoLead["outcome"]), note: texto(f.note), action: esTipoDeAccion(f.action) ? f.action : null, actor: texto(f.actor),
    actor_name: texto(f.actor_name), subject: texto(f.subject), subject_name: texto(f.subject_name),
  };
}

type ErrorDeBase = { code?: string | null; message: string };
function fallo<T>(error: ErrorDeBase): Res<T> {
  return { ok: false, sinTabla: faltaLaTabla(error), motivo: negativaDeCodigo(error.code), error: error.message };
}

export function almacenDeLaBase(supabase: SupabaseClient): AlmacenDeLeads {
  /** Una función que devuelve el lead como quedó. */
  const llamar = async (fn: string, args: Record<string, unknown>): Promise<Res<Lead>> => {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return fallo(error);
    if (!data || typeof data !== "object") return { ok: false, sinTabla: false, motivo: null, error: "empty answer" };
    return { ok: true, valor: leadDeLaBase(data as Record<string, unknown>) };
  };
  const eventos = async (filtro: { lead?: string }): Promise<Res<EventoLead[]>> => {
    const todos: EventoLead[] = [];
    let columnas = EVENTO_COLUMNAS;
    for (let p = 0; p < MAX_PAGINAS; p++) {
      let q = supabase.from("lead_events").select(columnas);
      if (filtro.lead) q = q.eq("lead_id", filtro.lead);
      const { data, error } = await q.order("id", { ascending: true }).range(p * PAGINA, (p + 1) * PAGINA - 1);
      if (error && faltaLaColumna(error) && columnas === EVENTO_COLUMNAS) { columnas = EVENTO_COLUMNAS_SIN_253; p--; continue; }
      if (error) return fallo(error);
      const filas = (data ?? []) as unknown as Record<string, unknown>[];
      todos.push(...filas.map(eventoDeLaBase));
      if (filas.length < PAGINA) return { ok: true, valor: todos };
    }
    return { ok: false, sinTabla: false, motivo: null, error: `more than ${PAGINA * MAX_PAGINAS} events` };
  };
  return {
    async leer() {
      // El alcance se le PREGUNTA a la base: es la misma regla que su política aplica a las filas de abajo.
      const mio = await supabase.rpc("leads_my_scope");
      if (mio.error && !faltaElAlcance(mio.error)) return fallo(mio.error);
      const alcance = mio.error ? ALCANCE_SIN_REGLA : alcanceDeLaBase(mio.data);
      const leads: Lead[] = [];
      let intento = 0;
      for (let p = 0; p < MAX_PAGINAS; p++) {
        const { data, error } = await supabase.from("leads").select(COLUMNAS_EN_ORDEN[intento]!)
          .order("tabs_project", { ascending: true }).range(p * PAGINA, (p + 1) * PAGINA - 1);
        if (error && faltaLaColumna(error) && intento < COLUMNAS_EN_ORDEN.length - 1) { intento++; p--; continue; }
        if (error) return fallo(error);
        const filas = (data ?? []) as unknown as Record<string, unknown>[];
        leads.push(...filas.map(leadDeLaBase));
        if (filas.length < PAGINA) return { ok: true, valor: { leads, alcance } };
      }
      return { ok: false, sinTabla: false, motivo: null, error: `more than ${PAGINA * MAX_PAGINAS} leads` };
    },
    historial: (leadId) => eventos({ lead: leadId }),
    eventos: () => eventos({}),
    async clientesCruzados(ids) {
      const mapa = new Map<number, ClienteCruzado>();
      const unicos = [...new Set(ids)].filter((n) => Number.isFinite(n));
      if (!unicos.length) return { ok: true, valor: mapa };
      const { data, error } = await supabase.schema("erp").from("customers").select(COLUMNAS_CRUZADO).in("id", unicos);
      if (error) return fallo(error);
      const filas = (data ?? []) as unknown as Omit<ClienteCruzado, "rep_name">[];
      const reps = [...new Set(filas.map((f) => f.rep_id).filter((r): r is string => !!r))];
      const nombre = new Map<string, string>();
      if (reps.length) {
        const { data: perfiles } = await supabase.from("perfiles_publicos").select("id, full_name").in("id", reps);
        for (const p of (perfiles ?? []) as { id: string; full_name: string | null }[]) if (p.full_name) nombre.set(p.id, p.full_name);
      }
      for (const f of filas) mapa.set(Number(f.id), { ...f, id: Number(f.id), credit_limit: f.credit_limit == null ? null : Number(f.credit_limit), rep_name: f.rep_id ? (nombre.get(f.rep_id) ?? null) : null });
      return { ok: true, valor: mapa };
    },
    // Sin etapa se manda null: la 328 exige la nota cuando no hay etapa, y la acepta vacía cuando la hay.
    anotar: (leadId, nota, etapa) => llamar("lead_note", { p_lead: leadId, p_note: nota, p_action: etapa }),
    async guardarTelefono(leadId, quien, telefono, ext, contacto) {
      const { data, error } = await supabase.rpc("lead_set_phone", {
        p_lead: leadId, p_quien: quien, p_telefono: telefono, p_ext: ext, p_contacto: contacto,
      });
      // Sin la 335 no existe la función (PGRST202 / 42883): se dice qué falta, no un error de base.
      if (error && (error.code === "PGRST202" || error.code === "42883")) {
        return { ok: false, sinTabla: false, motivo: "sin_migracion", error: error.message };
      }
      if (error) return fallo(error);
      if (!data || typeof data !== "object") return { ok: false, sinTabla: false, motivo: null, error: "empty answer" };
      return { ok: true, valor: leadDeLaBase(data as Record<string, unknown>) };
    },
    archivar: (leadId, nota) => llamar("lead_admin_archive", { p_lead: leadId, p_note: nota }),
    async llamadasDeLead(leadId) {
      const { data, error } = await supabase.rpc("leads_llamadas_de_lead", { p_lead: leadId });
      if (error) return fallo(error);
      return { ok: true, valor: (data ?? []) as LlamadaDeLead[] };
    },
    async grabacionDeLlamada(leadId, llamadaId) {
      const r = await fetch(`/api/leads/llamadas/grabacion?lead=${encodeURIComponent(leadId)}&id=${encodeURIComponent(llamadaId)}`, { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as { url?: string } | null;
      if (!r.ok || !j?.url) return { ok: false, sinTabla: false, motivo: null, error: `status ${r.status}` };
      return { ok: true, valor: j.url };
    },
    async llamadasPorVendedor(periodo) {
      const { data, error } = await supabase.rpc("leads_estadisticas_de_llamadas", {
        p_desde: periodo.desde.toISOString(), p_hasta: periodo.hasta.toISOString(),
      });
      if (error) return fallo(error);
      const porVendedor = ((data ?? []) as { rep_name: string | null; llamadas: number | string }[])
        .map((r) => ({ rep_name: r.rep_name, llamadas: Number(r.llamadas) }));
      return { ok: true, valor: { porVendedor, total: porVendedor.reduce((n, r) => n + r.llamadas, 0) } };
    },
    async puestosDeVendedores() {
      try {
        const { data, error } = await supabase.rpc("leads_colores_de_vendedores");
        if (error || !Array.isArray(data)) return new Map<string, number>();
        return new Map((data as { profile_id: string; puesto: number | string }[]).map((r) => [String(r.profile_id), Number(r.puesto)]));
      } catch {
        return new Map<string, number>();
      }
    },
  };
}
