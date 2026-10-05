import type { SupabaseClient } from "@supabase/supabase-js";
import { negativaDeCodigo, TOPE_POR_DEFECTO, type EstadoLead, type Etiqueta, type EventoLead, type Lead, type Negativa, type Persona, type Resultado } from "./reglas";

/**
 * Dónde viven los leads: `public.leads`, `public.lead_events` y `public.lead_settings` (migración 162). Una interfaz
 * con dos implementaciones —la base y el demo— para que la pantalla sea la misma en las dos.
 *
 * **Se lee con la sesión de quien mira**: la política de la 162 (`has_leads_access()`) decide. **No hay ni una
 * escritura directa**: las tres tablas no tienen INSERT, UPDATE ni DELETE por la API. Todo va por funciones, y cada
 * una devuelve el lead como quedó: lo que la pantalla pinta después es lo que dijo la base, no lo que se supuso.
 *
 * Sin la 162 aplicada (el código llega antes que la migración) se devuelve `sinTabla` y la pantalla lo dice.
 */
export type Res<T> = { ok: true; valor: T } | { ok: false; sinTabla: boolean; motivo: Negativa | null; error: string };

export interface AlmacenDeLeads {
  /** Todos los leads y el tope vigente. */
  leer(): Promise<Res<{ leads: Lead[]; tope: number }>>;
  /** El historial de UN lead, de lo más viejo a lo más nuevo. */
  historial(leadId: string): Promise<Res<EventoLead[]>>;
  /** Los cierres de todos (para el tablero del admin). */
  cierres(): Promise<Res<EventoLead[]>>;
  /** A quién se le puede asignar un lead: quien tiene el módulo, y los admins. */
  personas(): Promise<Res<Persona[]>>;
  tomar(leadId: string): Promise<Res<Lead>>;
  anotar(leadId: string, nota: string): Promise<Res<Lead>>;
  cerrar(leadId: string, resultado: Resultado, nota: string): Promise<Res<Lead>>;
  liberar(leadId: string, nota: string): Promise<Res<Lead>>;
  asignar(leadId: string, persona: string, nota: string): Promise<Res<Lead>>;
  archivar(leadId: string, nota: string): Promise<Res<Lead>>;
  ponerTope(tope: number): Promise<Res<number>>;
}

/** ¿Es «la 162 no está aplicada»? PGRST205 (tabla) / PGRST202 (función) de PostgREST; 42P01 / 42883 de Postgres. Solo esos. */
export function faltaLaTabla(error: { code?: string | null } | null | undefined): boolean {
  const code = error?.code ?? "";
  return code === "PGRST205" || code === "PGRST202" || code === "42P01" || code === "42883";
}

/** Las columnas que la pantalla usa. No se pide `*`: la dirección postal del dueño no se enseña y no se baja. */
export const COLUMNAS =
  "id, tabs_project, pool, distance_miles, category, project_type, reason, county, registered_date, project_name, facility_name, " +
  "type_of_work, scope_of_work, square_footage, estimated_cost, est_start_date, est_completion_date, permit_status, " +
  "site_address, site_city, site_zip, owner_name, owner_phone, owner_contact, tenant_name, tenant_phone, " +
  "design_firm_name, design_firm_phone, tdlr_link, status, holder, holder_name, taken_at, touched_at, " +
  "follow_up_note, follow_up_at, last_outcome, last_note, last_by, last_by_name, last_at";

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
    last_outcome: ETIQUETAS.find((e) => e === f.last_outcome) ?? null, last_note: texto(f.last_note),
    last_by: texto(f.last_by), last_by_name: texto(f.last_by_name), last_at: texto(f.last_at),
  };
}

export function eventoDeLaBase(f: Record<string, unknown>): EventoLead {
  return {
    id: Number(f.id), lead_id: String(f.lead_id), at: String(f.at), kind: f.kind as EventoLead["kind"],
    outcome: (texto(f.outcome) as Resultado | null), note: texto(f.note), actor: texto(f.actor),
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
  const eventos = async (filtro: { lead?: string; kind?: string }): Promise<Res<EventoLead[]>> => {
    const todos: EventoLead[] = [];
    for (let p = 0; p < MAX_PAGINAS; p++) {
      let q = supabase.from("lead_events").select("id, lead_id, at, kind, outcome, note, actor, actor_name, subject, subject_name");
      if (filtro.lead) q = q.eq("lead_id", filtro.lead);
      if (filtro.kind) q = q.eq("kind", filtro.kind);
      const { data, error } = await q.order("id", { ascending: true }).range(p * PAGINA, (p + 1) * PAGINA - 1);
      if (error) return fallo(error);
      const filas = (data ?? []) as unknown as Record<string, unknown>[];
      todos.push(...filas.map(eventoDeLaBase));
      if (filas.length < PAGINA) return { ok: true, valor: todos };
    }
    return { ok: false, sinTabla: false, motivo: null, error: `more than ${PAGINA * MAX_PAGINAS} events` };
  };
  return {
    async leer() {
      const ajustes = await supabase.from("lead_settings").select("max_open").maybeSingle();
      if (ajustes.error) return fallo(ajustes.error);
      const tope = num((ajustes.data as { max_open?: unknown } | null)?.max_open) ?? TOPE_POR_DEFECTO;
      const leads: Lead[] = [];
      for (let p = 0; p < MAX_PAGINAS; p++) {
        const { data, error } = await supabase.from("leads").select(COLUMNAS)
          .order("tabs_project", { ascending: true }).range(p * PAGINA, (p + 1) * PAGINA - 1);
        if (error) return fallo(error);
        const filas = (data ?? []) as unknown as Record<string, unknown>[];
        leads.push(...filas.map(leadDeLaBase));
        if (filas.length < PAGINA) return { ok: true, valor: { leads, tope } };
      }
      return { ok: false, sinTabla: false, motivo: null, error: `more than ${PAGINA * MAX_PAGINAS} leads` };
    },
    historial: (leadId) => eventos({ lead: leadId }),
    cierres: () => eventos({ kind: "closed" }),
    async personas() {
      const { data, error } = await supabase.from("profiles").select("id, full_name, store, role, module_access");
      if (error) return fallo(error);
      const filas = (data ?? []) as { id: string; full_name: string | null; store: string | null; role: string | null; module_access: string[] | null }[];
      return {
        ok: true,
        valor: filas
          .filter((f) => f.role === "admin" || (f.module_access ?? []).includes("leads"))
          .map((f) => ({ id: f.id, name: f.full_name?.trim() || "—", store: f.store, admin: f.role === "admin" }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    },
    tomar: (leadId) => llamar("lead_take", { p_lead: leadId }),
    anotar: (leadId, nota) => llamar("lead_note", { p_lead: leadId, p_note: nota }),
    cerrar: (leadId, resultado, nota) => llamar("lead_close", { p_lead: leadId, p_outcome: resultado, p_note: nota }),
    liberar: (leadId, nota) => llamar("lead_admin_release", { p_lead: leadId, p_note: nota }),
    asignar: (leadId, persona, nota) => llamar("lead_admin_assign", { p_lead: leadId, p_user: persona, p_note: nota }),
    archivar: (leadId, nota) => llamar("lead_admin_archive", { p_lead: leadId, p_note: nota }),
    async ponerTope(tope) {
      const { data, error } = await supabase.rpc("leads_set_cap", { p_max: tope });
      if (error) return fallo(error);
      return { ok: true, valor: num(data) ?? tope };
    },
  };
}
