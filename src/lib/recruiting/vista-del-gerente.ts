import type { Candidate, Contact, Stage, UserRole } from "./types";

/* ---- Vista del gerente de tienda (D-NEXT, 2026-10-19; migración 183) ----
 * El dueño: «una vista para los managers de la HR app … van a poder ver los candidatos que fueron puestos para
 * in-person interview … hoy tuvieron estos … van a poder decir hire, no hire, y reason why not hire … cada manager
 * va a ver solo los de su tienda … solo van a poder ver el tab de candidatos por ahora … ahí tiene que salir
 * resolución del gerente: no hire, hire».
 *
 * Quién ve qué lo decide la BASE (183: `recruiting_candidate_visible`, por `profiles.store` y palabra entera);
 * aquí solo se agrupa y se decide qué escribe cada botón. `tiendaCoincide` es el espejo en TS de esa regla,
 * para enseñar «Tienda: RDZ Edinburg» y para medir la regla en pruebas. */

export const ROL_GERENTE_DE_TIENDA: UserRole = "store_manager";

export function esGerenteDeTienda(role: string | null | undefined): boolean {
  return role === ROL_GERENTE_DE_TIENDA;
}

/** Las pestañas que ve cada rol: el gerente de tienda, solo Candidatos (es la raíz del módulo). */
export function pestanasVisibles<T extends { id: string; adminOnly?: boolean; roles?: string[] }>(tabs: readonly T[], role: string): T[] {
  if (esGerenteDeTienda(role)) return tabs.filter((t) => t.id === "candidates");
  return tabs.filter((t) => (!t.adminOnly || role === "admin") && (!t.roles || t.roles.includes(role)));
}

/** Espejo de la 183: la `location` del candidato («Edinburg») es palabra entera del `store` del perfil («RDZ Edinburg»). */
export function tiendaCoincide(storeDelPerfil: string | null | undefined, location: string | null | undefined): boolean {
  const l = (location ?? "").trim().toLowerCase();
  const s = (storeDelPerfil ?? "").trim().toLowerCase();
  if (!l || !s) return false;
  return (" " + s + " ").includes(" " + l + " ");
}

export type GrupoDelGerente = "hoy" | "proximos" | "pendientes" | "resueltos";

const DIA = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** En qué grupo cae un candidato visible: resuelto (contratado/descartado), hoy, próximos, o pendiente (cita pasada o sin fecha). */
export function grupoDelCandidato(c: Pick<Candidate, "status" | "inperson_date">, stages: readonly Stage[], ahora: Date = new Date()): GrupoDelGerente {
  const etapa = stages.find((s) => s.key === c.status);
  if (etapa && etapa.type !== "active") return "resueltos";
  if (!c.inperson_date) return "pendientes";
  const d = new Date(c.inperson_date);
  if (Number.isNaN(d.getTime())) return "pendientes";
  const dia = DIA(d), hoy = DIA(ahora);
  if (dia === hoy) return "hoy";
  return dia > hoy ? "proximos" : "pendientes";
}

/** Los cuatro grupos, cada uno ordenado por la fecha de la cita (los resueltos, del más reciente al más viejo). */
export function agruparParaElGerente(candidatos: readonly Candidate[], stages: readonly Stage[], ahora: Date = new Date()): Record<GrupoDelGerente, Candidate[]> {
  const g: Record<GrupoDelGerente, Candidate[]> = { hoy: [], proximos: [], pendientes: [], resueltos: [] };
  for (const c of candidatos) if (!c.archived) g[grupoDelCandidato(c, stages, ahora)].push(c);
  const fecha = (c: Candidate) => c.inperson_date ?? "";
  g.hoy.sort((a, b) => fecha(a).localeCompare(fecha(b)));
  g.proximos.sort((a, b) => fecha(a).localeCompare(fecha(b)));
  g.pendientes.sort((a, b) => fecha(b).localeCompare(fecha(a)));
  g.resueltos.sort((a, b) => b.stage_changed_at.localeCompare(a.stage_changed_at));
  return g;
}

export type Decision = "hire" | "no_hire";

/** Marcas en `contacts` de la resolución (así el reclutador ve quién y cuándo, con `created_by`/`created_at`). */
export const RESULTADO_CONTRATAR = "hired by manager";
export const RESULTADO_NO_CONTRATAR = "not hired by manager";

export type Resolucion =
  | { ok: true; patch: Partial<Candidate>; contacto: Pick<Contact, "type" | "result" | "note"> }
  | { ok: false; motivo: "sin-razon" | "sin-etapa" };

/**
 * Qué escribe cada botón. «Contratar» → la etapa ganada del pipeline (hired). «No contratar» → la etapa perdida
 * (discarded) con la razón OBLIGATORIA en `discard_reason` y `discard_source = "manager"` (campos que ya existen:
 * la ficha ya pinta «por Gerente»). Sin la etapa en el pipeline no se escribe nada.
 */
export function resolverCandidato(decision: Decision, razon: string, stages: readonly Stage[]): Resolucion {
  const tipo = decision === "hire" ? "won" : "lost";
  const etapa = stages.find((s) => s.type === tipo);
  if (!etapa) return { ok: false, motivo: "sin-etapa" };
  const r = razon.trim();
  if (decision === "no_hire" && !r) return { ok: false, motivo: "sin-razon" };
  if (decision === "hire") {
    return {
      ok: true,
      patch: { status: etapa.key },
      contacto: { type: "In person", result: RESULTADO_CONTRATAR, note: r.slice(0, 200) },
    };
  }
  return {
    ok: true,
    patch: { status: etapa.key, discard_reason: r, discard_source: "manager" },
    contacto: { type: "In person", result: RESULTADO_NO_CONTRATAR, note: r.slice(0, 200) },
  };
}

export type ResolucionVista = { decision: Decision; razon: string; cuando: string; por: string | null };

/** La última resolución del gerente de un candidato (de `contacts`), o null si no la hay. */
export function resolucionDelGerente(contactos: readonly Contact[], candidateId: string): ResolucionVista | null {
  const k = contactos
    .filter((x) => x.candidate_id === candidateId && x.type === "In person" && (x.result === RESULTADO_CONTRATAR || x.result === RESULTADO_NO_CONTRATAR))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!k) return null;
  return { decision: k.result === RESULTADO_CONTRATAR ? "hire" : "no_hire", razon: k.note ?? "", cuando: k.created_at, por: k.created_by };
}

/** «Resolución del gerente: Contratar» / «No contratar · razón», como se pinta en la lista del reclutador. */
export function textoDeLaResolucion(r: ResolucionVista, lang: "en" | "es", nombreDeQuien?: string | null): string {
  const que = r.decision === "hire" ? (lang === "es" ? "Contratar" : "Hire") : (lang === "es" ? "No contratar" : "No hire");
  const partes = [`${lang === "es" ? "Resolución del gerente" : "Manager's decision"}: ${que}`];
  if (r.razon) partes.push(r.razon);
  const d = new Date(r.cuando);
  const fecha = d.toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { day: "numeric", month: "short" });
  partes.push(nombreDeQuien ? `${fecha} · ${nombreDeQuien}` : fecha);
  return partes.join(" · ");
}
