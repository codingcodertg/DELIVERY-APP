import type { AlmacenDeLeads, Res } from "./almacen";
import {
  aplicarCerrar, aplicarNota, aplicarTomar, notaLimpia, TOPE_POR_DEFECTO,
  type EventoLead, type Lead, type Negativa, type Persona, type Resultado,
} from "./reglas";

/**
 * Leads INVENTADOS para el modo demo (`NEXT_PUBLIC_LOCAL_MODE`), que no tiene base. Ni un dato real: los nombres
 * dicen «Demo», los teléfonos son 555-01xx y las direcciones no existen. Fijos —no al azar— para que una captura de
 * hoy y otra de mañana enseñen lo mismo. Las categorías y los tipos sí son los del Excel, porque son clasificación
 * nuestra y la pantalla los traduce.
 */
export const PERSONAS_DEMO: Persona[] = [
  { id: "demo-ana", name: "Ana Demo", store: "RDZ Brownsville", admin: false },
  { id: "demo-beto", name: "Beto Demo", store: "RDZ Edinburg", admin: false },
  { id: "demo-admin", name: "Admin Demo", store: null, admin: true },
];

const TIENDAS = ["RDZ Brownsville", "RDZ Edinburg", "RDZ McAllen", "RDZ Weslaco"];
const CIUDADES: Record<string, string[]> = {
  "RDZ Brownsville": ["Brownsville", "Los Fresnos"],
  "RDZ Edinburg": ["Edinburg", "Elsa"],
  "RDZ McAllen": ["McAllen", "Mission"],
  "RDZ Weslaco": ["Weslaco", "Mercedes"],
};
const TIPOS = ["Plaza / local comercial", "Clínica / médico", "Oficinas / suites", "Restaurante / comida", "Vivienda (casas, apartamentos)", "Warehouse / industrial"];
const CATEGORIAS = ["Sirve – usa piso", "Sirve – usa piso", "Might be useful", "Sirve – usa piso", "No sirve – cadena / franquicia"];
const OBRAS = ["New Construction", "Renovation/Alteration", "Additions to Existing Building"];

export function leadsDemo(ahora: Date = new Date()): Lead[] {
  const hace = (dias: number) => new Date(ahora.getTime() - dias * 86400000).toISOString();
  const dia = (dias: number) => hace(dias).slice(0, 10);
  const leads: Lead[] = [];
  for (let i = 1; i <= 44; i++) {
    const pool = TIENDAS[i % TIENDAS.length];
    const n = String(i).padStart(2, "0");
    leads.push({
      id: `demo-lead-${n}`, tabs_project: `DEMO20260000${n}`, pool,
      distance_miles: Math.round((1.2 + ((i * 37) % 290) / 10) * 10) / 10,
      category: CATEGORIAS[i % CATEGORIAS.length], project_type: TIPOS[i % TIPOS.length],
      reason: i % 5 === 0 ? "Cadena con proveedor nacional" : null, county: i % 2 ? "Cameron" : "Hidalgo",
      registered_date: dia(3 + i * 4), project_name: `Proyecto Demo ${n}`, facility_name: `Local Demo ${n}`,
      type_of_work: OBRAS[i % OBRAS.length], scope_of_work: "Interior finish-out of a demo tenant space (invented).",
      square_footage: 900 + ((i * 713) % 9000), estimated_cost: 40000 + ((i * 91377) % 2400000),
      est_start_date: dia(-20 - i), est_completion_date: dia(-140 - i * 2), permit_status: i % 3 ? "Review Complete" : "Project Registered",
      site_address: `${100 + i * 12} Calle Demo`, site_city: CIUDADES[pool][i % 2], site_zip: `7850${i % 10}`,
      owner_name: `Dueño Demo ${n} LLC`, owner_phone: `(956) 555-01${n}`, owner_contact: i % 3 ? `Contacto Demo ${n}` : null,
      tenant_name: i % 4 === 0 ? `Inquilino Demo ${n}` : null, tenant_phone: i % 4 === 0 ? `956-555-01${n}` : null,
      design_firm_name: i % 2 ? `Despacho Demo ${n}` : null, design_firm_phone: i % 2 ? `956-555-01${n}` : null,
      tdlr_link: `https://example.com/demo/DEMO20260000${n}`,
      status: "free", holder: null, holder_name: null, taken_at: null, touched_at: null,
      follow_up_note: null, follow_up_at: null, last_outcome: null, last_note: null, last_by: null, last_by_name: null, last_at: null,
    });
  }
  const [ana, beto] = PERSONAS_DEMO;
  const tomar = (i: number, p: Persona, dias: number) => {
    leads[i] = { ...leads[i], status: "taken", holder: p.id, holder_name: p.name, taken_at: hace(dias), touched_at: hace(dias) };
  };
  // Los índices 3, 7, 11… son del pool de Brownsville (la tienda de Ana); 0, 4, 8… de Edinburg (la de Beto).
  // Ana tiene 9 abiertos: con uno más llena su pool y el siguiente se le rechaza. Dos llevan semanas sin tocar.
  [0, 4, 1, 15, 19, 23, 27, 31, 35].forEach((i, k) => tomar(i, ana, k < 2 ? 21 + k : 2 + k));
  leads[19] = { ...leads[19], follow_up_note: "Visité la obra; el contratista decide en dos semanas.", follow_up_at: hace(3), touched_at: hace(3) };
  // Beto tiene 3 abiertos (uno en el pool de Brownsville, para que Ana lo vea bloqueado) y una venta allí mismo.
  tomar(8, beto, 5); tomar(12, beto, 1); tomar(39, beto, 3);
  leads[43] = { ...leads[43], status: "won", holder: beto.id, holder_name: beto.name, taken_at: hace(30), touched_at: hace(12), last_outcome: "sale", last_note: "Vendido: porcelanato para 2,400 sqft.", last_by: beto.id, last_by_name: beto.name, last_at: hace(12) };
  // Devueltos al banco con su etiqueta, y uno en la cola de revisión.
  leads[3] = { ...leads[3], last_outcome: "nothing", last_note: "Tres llamadas y nadie contesta.", last_by: beto.id, last_by_name: beto.name, last_at: hace(6), touched_at: hace(6) };
  leads[7] = { ...leads[7], last_outcome: "reassign", last_note: "Queda más cerca de Weslaco; que lo vea alguien de allá.", last_by: ana.id, last_by_name: ana.name, last_at: hace(9), touched_at: hace(9) };
  leads[11] = { ...leads[11], last_outcome: "bad_lead", last_note: "Es una franquicia: compran por corporativo.", last_by: ana.id, last_by_name: ana.name, last_at: hace(4), touched_at: hace(4) };
  leads[13] = { ...leads[13], status: "review", last_outcome: "review", last_note: "El teléfono es de otra empresa; revisar el permiso.", last_by: beto.id, last_by_name: beto.name, last_at: hace(2), touched_at: hace(2) };
  return leads;
}

/**
 * El almacén del demo: en memoria, se pierde al recargar. **Aplica las mismas reglas que la base** por las funciones
 * de `reglas` (tope, solo lo libre, nota obligatoria, solo lo tuyo): lo que el demo deja hacer, la base también.
 * `quien` dice quién está actuando (en el demo se cambia de persona con un desplegable).
 */
export function almacenDemo(quien: () => Persona): AlmacenDeLeads {
  let leads = leadsDemo();
  let tope = TOPE_POR_DEFECTO;
  let serie = 0;
  const eventos: EventoLead[] = [];
  for (const l of leads) {
    if (l.last_outcome && l.last_outcome !== "admin" && l.last_by) {
      eventos.push({ id: ++serie, lead_id: l.id, at: l.last_at ?? "", kind: "closed", outcome: l.last_outcome, note: l.last_note, actor: l.last_by, actor_name: l.last_by_name, subject: l.last_by, subject_name: l.last_by_name });
    }
  }
  const no = <T,>(motivo: Negativa): Res<T> => ({ ok: false, sinTabla: false, motivo, error: motivo });
  const apunta = (lead: Lead, kind: EventoLead["kind"], extra: Partial<EventoLead> = {}) => {
    const yo = quien();
    eventos.push({ id: ++serie, lead_id: lead.id, at: new Date().toISOString(), kind, outcome: null, note: null, actor: yo.id, actor_name: yo.name, subject: yo.id, subject_name: yo.name, ...extra });
  };
  const guarda = (l: Lead): Res<Lead> => { leads = leads.map((x) => (x.id === l.id ? l : x)); return { ok: true, valor: { ...l } }; };
  const busca = (id: string) => leads.find((l) => l.id === id);
  const soloAdmin = (id: string, hace: (l: Lead, yo: Persona) => Res<Lead>): Res<Lead> => {
    const yo = quien();
    if (!yo.admin) return no("sin_permiso");
    const l = busca(id);
    return l ? hace(l, yo) : no("no_existe");
  };
  return {
    async leer() { return { ok: true, valor: { leads: leads.map((l) => ({ ...l })), tope } }; },
    async historial(leadId) { return { ok: true, valor: eventos.filter((e) => e.lead_id === leadId) }; },
    async cierres() { return { ok: true, valor: eventos.filter((e) => e.kind === "closed") }; },
    async personas() { return { ok: true, valor: PERSONAS_DEMO.map((p) => ({ ...p })) }; },
    async tomar(leadId) {
      const l = busca(leadId);
      if (!l) return no("no_existe");
      const r = aplicarTomar(l, leads, quien(), tope, new Date().toISOString());
      if (!r.ok) return no(r.motivo);
      apunta(l, "taken");
      return guarda(r.valor);
    },
    async anotar(leadId, nota) {
      const l = busca(leadId);
      if (!l) return no("no_existe");
      const r = aplicarNota(l, quien(), nota, new Date().toISOString());
      if (!r.ok) return no(r.motivo);
      apunta(l, "progress", { note: r.valor.follow_up_note });
      return guarda(r.valor);
    },
    async cerrar(leadId, resultado: Resultado, nota) {
      const l = busca(leadId);
      if (!l) return no("no_existe");
      const r = aplicarCerrar(l, quien(), resultado, nota, new Date().toISOString());
      if (!r.ok) return no(r.motivo);
      apunta(l, "closed", { outcome: resultado, note: r.valor.last_note });
      return guarda(r.valor);
    },
    async liberar(leadId, nota) {
      return soloAdmin(leadId, (l, yo) => {
        if (l.status === "free") return no("no_libre");
        const n = notaLimpia(nota);
        const ahora = new Date().toISOString();
        apunta(l, "released", { note: n, subject: l.holder, subject_name: l.holder_name });
        return guarda({
          ...l, status: "free", holder: null, holder_name: null, taken_at: null, follow_up_note: null, follow_up_at: null, touched_at: ahora,
          ...(n ? { last_outcome: "admin" as const, last_note: n, last_by: yo.id, last_by_name: yo.name, last_at: ahora } : {}),
        });
      });
    },
    async asignar(leadId, persona, nota) {
      return soloAdmin(leadId, (l) => {
        const a = PERSONAS_DEMO.find((p) => p.id === persona);
        if (!a) return no("dato_invalido");
        const ahora = new Date().toISOString();
        apunta(l, "assigned", { note: notaLimpia(nota), subject: a.id, subject_name: a.name });
        return guarda({ ...l, status: "taken", holder: a.id, holder_name: a.name, taken_at: ahora, touched_at: ahora, follow_up_note: null, follow_up_at: null });
      });
    },
    async archivar(leadId, nota) {
      return soloAdmin(leadId, (l) => {
        apunta(l, "archived", { note: notaLimpia(nota), subject: l.holder, subject_name: l.holder_name });
        return guarda({ ...l, status: "archived", holder: null, holder_name: null, taken_at: null, follow_up_note: null, follow_up_at: null, touched_at: new Date().toISOString() });
      });
    },
    async ponerTope(n) {
      if (!quien().admin) return no("sin_permiso");
      if (!Number.isInteger(n) || n < 1 || n > 100) return no("dato_invalido");
      tope = n;
      return { ok: true, valor: n };
    },
  };
}
