import type { AlmacenDeLeads, Res } from "./almacen";
import { alcanceDe, alcanzaElLead, PERMISO_OTRAS_TIENDAS, PERMISO_POOL_PRIVADO, privadosVisibles, type Alcance } from "./alcance";
import {
  aplicarNota, notaLimpia, type EventoLead, type Lead, type Negativa, type Persona, type TipoDeAccion,
} from "./reglas";

/**
 * Leads INVENTADOS para el modo demo (`NEXT_PUBLIC_LOCAL_MODE`), que no tiene base. Ni un dato real: los nombres
 * dicen «Demo», los teléfonos son 555-01xx y las direcciones no existen. Fijos —no al azar— para que una captura de
 * hoy y otra de mañana enseñen lo mismo. Las categorías y los tipos sí son los del Excel, porque son clasificación
 * nuestra y la pantalla los traduce.
 */
export const PERSONAS_DEMO: Persona[] = [
  { id: "demo-ana", name: "Ana Demo", store: "RDZ Brownsville", admin: false, role: "sales" },
  { id: "demo-beto", name: "Beto Demo", store: "RDZ Edinburg", admin: false, role: "sales" },
  { id: "demo-admin", name: "Admin Demo", store: null, admin: true, role: "admin" },
  // Dos managers, para enseñar el interruptor de la 163: una con «ver leads de otras tiendas» y otro sin él.
  { id: "demo-gema", name: "Gema Demo", store: "RDZ McAllen", admin: false, role: "manager", permissions: [PERMISO_OTRAS_TIENDAS] },
  // D-770: Hugo tiene la casilla del STXP Pool (los demás no): ve los privados de Weslaco y, agotados, los de Pharr.
  { id: "demo-hugo", name: "Hugo Demo", store: "RDZ Weslaco", admin: false, role: "manager", permissions: [PERMISO_POOL_PRIVADO] },
];

/** El alcance de una persona del demo: la misma cuenta que hace la base (`leads_my_scope()`), con `alcanceDe`. */
export function alcanceDemo(p: Persona): Alcance {
  return alcanceDe({ role: p.admin ? "admin" : p.role, permissions: p.permissions, store: p.store });
}

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

/**
 * Las etapas del demo, por índice de lead: cubren todas las etapas y un lead sin ninguna. Quien anotó la última nota
 * (`ana`, `beto`) es el último contacto. La venta (`closed`) es de Beto, y es el único lead con dueño.
 */
const ETAPAS_DEMO: Record<number, { etapa: TipoDeAccion | null; quien: "ana" | "beto"; nota: string; dias: number }> = {
  1: { etapa: "made_contact", quien: "ana", nota: "Hablé con la recepción; pasan el correo al dueño.", dias: 2 },
  2: { etapa: "no_answer", quien: "beto", nota: "Tres llamadas y nadie contesta.", dias: 4 },
  3: { etapa: "quote", quien: "beto", nota: "Quote #DEMO-1041", dias: 3 },
  4: { etapa: "appointment", quien: "ana", nota: "Cita el jueves a las 10 en la obra.", dias: 1 },
  5: { etapa: "negotiation", quien: "beto", nota: "Piden precio por 2,400 pies².", dias: 6 },
  6: { etapa: "lost", quien: "ana", nota: "Se fueron con otro instalador.", dias: 9 },
  7: { etapa: "bad_lead", quien: "ana", nota: "Es una franquicia: compran por corporativo.", dias: 4 },
  8: { etapa: "closed", quien: "beto", nota: "Vendido: porcelanato para 2,400 sqft.", dias: 12 },
  9: { etapa: "made_contact", quien: "beto", nota: "Dejé mensaje con el contratista.", dias: 1 },
  10: { etapa: "quote", quien: "ana", nota: "Quote #DEMO-1047", dias: 5 },
  11: { etapa: "bad_lead", quien: "beto", nota: "El teléfono es de otra empresa.", dias: 8 },
  12: { etapa: null, quien: "beto", nota: "Pendiente de confirmar el permiso.", dias: 2 },
};

/** En cuántas cargas apareció cada lead (los que vuelven en el import de cada 10 días). */
const VECES_VISTO: Record<number, number> = { 1: 2, 4: 3, 9: 2, 10: 2, 13: 2, 22: 4, 27: 2 };

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
      follow_up_note: null, follow_up_at: null, follow_up_action: null, last_outcome: null, last_note: null, last_by: null, last_by_name: null, last_at: null,
      times_seen: VECES_VISTO[i] ?? 1, last_seen_at: VECES_VISTO[i] ? hace(7) : null,
    });
  }
  // Las etapas: nota de avance, quién la anotó y cuándo. La venta es de Beto y deja el lead como won.
  const [ana, beto] = PERSONAS_DEMO;
  const quienDe = (q: "ana" | "beto") => (q === "ana" ? ana : beto);
  for (const [k, e] of Object.entries(ETAPAS_DEMO)) {
    const i = Number(k);
    const p = quienDe(e.quien);
    leads[i] = {
      ...leads[i], follow_up_note: e.nota, follow_up_action: e.etapa, follow_up_at: hace(e.dias), touched_at: hace(e.dias),
      last_by: p.id, last_by_name: p.name, last_at: hace(e.dias),
      ...(e.etapa === "closed" ? { status: "won" as const, holder: p.id, holder_name: p.name, taken_at: hace(30) } : {}),
    };
  }
  // Uno archivado por el admin: no se ve en el banco.
  leads[40] = { ...leads[40], status: "archived", follow_up_action: null };
  // D-770: el STXP Pool del demo (permisos municipales inventados, source 'privado'), por tienda. Weslaco con TRES
  // libres: en cuanto Hugo los tome, le aparece Pharr (la más cercana), y después McAllen. Datos inventados como los
  // demás: TABS «DEMO…», teléfonos 555-01xx, enlaces a example.com.
  const STXP: [string, string][] = [
    ["RDZ Brownsville", "Brownsville"], ["RDZ Brownsville", "Los Fresnos"], ["RDZ Weslaco", "Weslaco"], ["RDZ Weslaco", "Mercedes"], ["RDZ Weslaco", "Weslaco"],
    ["RDZ Pharr", "Pharr"], ["RDZ Pharr", "San Juan"], ["RDZ McAllen", "McAllen"], ["RDZ McAllen", "Mission"], ["RDZ Edinburg", "Edinburg"],
  ];
  STXP.forEach(([pool, ciudad], k) => {
    const n = String(k + 1).padStart(2, "0");
    leads.push({
      ...leads[k], id: `demo-stxp-${n}`, tabs_project: `DEMO-STXP-${n}`, pool, source: "privado", imported_at: hace(k < 5 ? 30 : 3),
      project_name: `Permiso municipal Demo ${n}`, facility_name: null, site_city: ciudad, site_address: `${200 + k * 7} Av. Demo`,
      owner_name: `Contratista Demo ${n} LLC`, owner_phone: `(956) 555-01${String(50 + k).padStart(2, "0")}`, tenant_name: `Propietario Demo ${n}`, tdlr_link: `https://example.com/demo/stxp/${n}`,
      customer_match_id: k === 0 ? 1 : null, customer_match_note: k === 0 ? "teléfono igual al del cliente CONTRATISTA DEMO 01" : null,
      status: "free", holder: null, holder_name: null, taken_at: null, touched_at: null, follow_up_note: null, follow_up_at: null, follow_up_action: null,
      last_outcome: null, last_note: null, last_by: null, last_by_name: null, last_at: null, times_seen: 1, last_seen_at: null,
    });
  });
  return leads;
}

/**
 * El almacén del demo: en memoria, se pierde al recargar. **Aplica las mismas reglas que la base** (`aplicarNota`:
 * la etapa, la nota obligatoria sin etapa, quién hizo el último contacto; solo lo que se ve). `quien` dice quién está
 * actuando (en el demo se cambia de persona con un desplegable).
 *
 * **Y la misma regla por tienda que la base** (migración 163): `leer` devuelve solo lo que esa persona alcanza, el
 * historial de un lead que no alcanza sale vacío, y anotar en uno de otra tienda se rechaza.
 */
export function almacenDemo(quien: () => Persona): AlmacenDeLeads {
  let leads = leadsDemo();
  let serie = 0;
  const eventos: EventoLead[] = [];
  // El historial de partida: una carga, y una nota por cada etapa del demo, con su fecha y su autor.
  for (const l of leads) {
    eventos.push({ id: ++serie, lead_id: l.id, at: l.imported_at ?? new Date().toISOString(), kind: "imported", outcome: null, note: null, actor: null, actor_name: "import script", subject: null, subject_name: null });
  }
  for (const [k, e] of Object.entries(ETAPAS_DEMO)) {
    const l = leads[Number(k)];
    const p = e.quien === "ana" ? PERSONAS_DEMO[0] : PERSONAS_DEMO[1];
    eventos.push({ id: ++serie, lead_id: l.id, at: l.last_at ?? "", kind: "progress", outcome: null, note: e.nota, action: e.etapa, actor: p.id, actor_name: p.name, subject: p.id, subject_name: p.name });
  }
  const no = <T,>(motivo: Negativa): Res<T> => ({ ok: false, sinTabla: false, motivo, error: motivo });
  const apunta = (lead: Lead, kind: EventoLead["kind"], extra: Partial<EventoLead> = {}) => {
    const yo = quien();
    eventos.push({ id: ++serie, lead_id: lead.id, at: new Date().toISOString(), kind, outcome: null, note: null, actor: yo.id, actor_name: yo.name, subject: yo.id, subject_name: yo.name, ...extra });
  };
  const guarda = (l: Lead): Res<Lead> => { leads = leads.map((x) => (x.id === l.id ? l : x)); return { ok: true, valor: { ...l } }; };
  const busca = (id: string) => leads.find((l) => l.id === id);
  // D-770: lo privado se alcanza por el STXP Pool (permiso + tienda y cercanas); lo del estado, por la 163.
  const alcanza = (l: Lead, yo: Persona) => (l.source === "privado"
    ? privadosVisibles(leads, { ...yo, role: yo.admin ? "admin" : yo.role }).some((x) => x.id === l.id)
    : alcanzaElLead(l, alcanceDemo(yo), yo.id));
  return {
    async clientesCruzados() { return { ok: true, valor: new Map() }; },
    async leer() {
      const yo = quien();
      const alcance = alcanceDemo(yo);
      return { ok: true, valor: { leads: leads.filter((l) => alcanza(l, yo)).map((l) => ({ ...l })), alcance } };
    },
    async historial(leadId) {
      const yo = quien();
      const l = busca(leadId);
      if (!l || !alcanza(l, yo)) return { ok: true, valor: [] };
      return { ok: true, valor: eventos.filter((e) => e.lead_id === leadId) };
    },
    async eventos() {
      const yo = quien();
      return { ok: true, valor: eventos.filter((e) => {
        const l = busca(e.lead_id);
        return !!l && alcanza(l, yo);
      }) };
    },
    async anotar(leadId, nota, etapa) {
      const l = busca(leadId);
      if (!l) return no("no_existe");
      if (!alcanza(l, quien())) return no("otra_tienda");
      const r = aplicarNota(l, quien(), nota, new Date().toISOString(), etapa);
      if (!r.ok) return no(r.motivo);
      apunta(l, "progress", { note: notaLimpia(nota), action: etapa });
      return guarda(r.valor);
    },
    async archivar(leadId, nota) {
      const yo = quien();
      if (!yo.admin) return no("sin_permiso");
      const l = busca(leadId);
      if (!l) return no("no_existe");
      apunta(l, "archived", { note: notaLimpia(nota), subject: l.holder, subject_name: l.holder_name });
      return guarda({ ...l, status: "archived", holder: null, holder_name: null, taken_at: null, follow_up_note: null, follow_up_action: null, follow_up_at: null, touched_at: new Date().toISOString() });
    },
  };
}
