/**
 * El historial de una merma (reunión 11 nov, 11 PM: «una pestaña de actividad con los cambios del reporte»).
 *
 * Junta dos fuentes: lo que la base anota desde la 297 (`warehouse_report_log`: etapas, fotos, grupo, firmas, ediciones)
 * y lo que se puede DERIVAR de la propia fila para los reportes de antes (alta y la fecha/actor de cada etapa). Si la
 * bitácora ya trae cambios de etapa, las etapas derivadas no se repiten. Regla PURA, sin React ni red.
 */
import type { EntradaDeHistorial } from "./datos";

export interface FilaParaHistorial {
  created_at: string;
  author_name?: string | null;
  photographed_at?: string | null;
  approved_at?: string | null;
  approved_by?: string | null;
  dumped_at?: string | null;
  dumped_by?: string | null;
  adjusted_at?: string | null;
  adjusted_by?: string | null;
}

export interface EventoDeHistorial {
  at: string;
  quien: string | null;
  texto: string;
}

type Lang = "en" | "es";
const ETAPA: Record<string, [string, string]> = {
  documented: ["Documented", "Documentada"], photographed: ["Photographed", "Fotografiada"], approved: ["Approved", "Aprobada"],
  dumped: ["Dumped", "Desechada"], adjusted: ["Adjusted", "Ajustada"],
};
const CAMPO: Record<string, [string, string]> = {
  product_name: ["product", "producto"], product_sku: ["SKU", "SKU"], product_id: ["catalog product", "producto del catálogo"],
  unit_cost: ["price per piece", "precio por pieza"], boxes: ["boxes", "cajas"], pieces_per_box: ["pieces per box", "piezas por caja"],
  loose_pieces: ["loose pieces", "piezas sueltas"], total_pieces: ["total pieces", "piezas totales"], damaged_pieces: ["damaged", "dañadas"],
  sample_pieces: ["sample", "muestra"], scrap_type: ["type", "tipo"], return_type: ["where from", "de dónde"], reason: ["reason", "motivo"],
  crma: ["CRMA", "CRMA"], broken_by: ["broken by", "lo rompió"], broken_on: ["date broken", "fecha del daño"], store: ["store", "tienda"],
  answers: ["comments / answers", "comentarios / respuestas"],
};

const etapa = (e: unknown, lang: Lang) => { const x = ETAPA[String(e ?? "")]; return x ? x[lang === "es" ? 1 : 0] : String(e ?? "—"); };
const corto = (v: unknown): string => {
  if (v == null || v === "") return "—";
  if (Array.isArray(v)) return v.length ? `${v.length}` : "—";
  if (typeof v === "object") return "…";
  const s = String(v);
  return s.length > 40 ? `${s.slice(0, 37)}…` : s;
};

export function textoDeEntrada(e: EntradaDeHistorial, lang: Lang): string {
  const es = lang === "es";
  const d = e.detail ?? {};
  switch (e.kind) {
    case "created": return es ? "Reporte creado" : "Report created";
    case "stage": return es ? `Etapa: ${etapa(d.de, lang)} → ${etapa(d.a, lang)}` : `Stage: ${etapa(d.de, lang)} → ${etapa(d.a, lang)}`;
    case "photos": return es ? `Fotos: ${d.antes ?? 0} → ${d.despues ?? 0}` : `Photos: ${d.antes ?? 0} → ${d.despues ?? 0}`;
    case "group": {
      const nombre = d.nombre ? ` «${String(d.nombre)}»` : "";
      if (d.a && !d.de) return es ? `Agregada al grupo${nombre}` : `Added to group${nombre}`;
      if (d.de && !d.a) return es ? `Sacada del grupo${nombre}` : `Removed from group${nombre}`;
      return es ? `Cambió de grupo${nombre}` : `Moved to group${nombre}`;
    }
    case "signature": {
      const slot = d.slot === "gerente" ? (es ? "gerente" : "manager") : (es ? "supervisor" : "supervisor");
      const quien = d.firmante ? ` (${String(d.firmante)})` : "";
      return d.accion === "quitada"
        ? (es ? `Firma de ${slot} quitada${quien}` : `${slot} signature removed${quien}`)
        : (es ? `Firmó como ${slot}${quien}` : `Signed as ${slot}${quien}`);
    }
    case "edited": {
      const partes = Object.entries(d).map(([k, v]) => {
        const nom = CAMPO[k] ? CAMPO[k][es ? 1 : 0] : k;
        const [a, b] = Array.isArray(v) ? v : [undefined, undefined];
        return k === "answers" ? nom : `${nom}: ${corto(a)} → ${corto(b)}`;
      });
      return (es ? "Editado — " : "Edited — ") + partes.join(" · ");
    }
    default: return e.kind;
  }
}

/** La lista final, de lo más viejo a lo más nuevo. `nombre` traduce un id de perfil a nombre. */
export function eventosDeHistorial(
  r: FilaParaHistorial, bitacora: readonly EntradaDeHistorial[], nombre: (id: string | null | undefined) => string | null, lang: Lang,
): EventoDeHistorial[] {
  const es = lang === "es";
  const out: EventoDeHistorial[] = [];
  const conEtapas = bitacora.some((e) => e.kind === "stage");
  if (!bitacora.some((e) => e.kind === "created")) out.push({ at: r.created_at, quien: r.author_name ?? null, texto: es ? "Reporte creado" : "Report created" });
  if (!conEtapas) {
    if (r.photographed_at && r.photographed_at !== r.created_at) out.push({ at: r.photographed_at, quien: null, texto: es ? "Etapa: Fotografiada" : "Stage: Photographed" });
    if (r.approved_at) out.push({ at: r.approved_at, quien: nombre(r.approved_by), texto: es ? "Etapa: Aprobada" : "Stage: Approved" });
    if (r.dumped_at) out.push({ at: r.dumped_at, quien: nombre(r.dumped_by), texto: es ? "Etapa: Desechada" : "Stage: Dumped" });
    if (r.adjusted_at) out.push({ at: r.adjusted_at, quien: nombre(r.adjusted_by), texto: es ? "Etapa: Ajustada" : "Stage: Adjusted" });
  }
  for (const e of bitacora) out.push({ at: e.at, quien: e.actor_name, texto: textoDeEntrada(e, lang) });
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
