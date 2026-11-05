/** Operaciones de almacén (D-883, migración 247): los siete reportes. Las claves son las de `warehouse_reports.kind`. */
export const TIPOS = ["incident", "zone", "insubordination", "safety", "maintenance", "positive", "scrap"] as const;
export type TipoDeReporte = (typeof TIPOS)[number];

/** Los de RR. HH.: van al expediente y solo los ven admin, RR. HH. (admin/gerente) y el gerente de la tienda. */
export const TIPOS_DE_RRHH: readonly TipoDeReporte[] = ["zone", "insubordination", "positive"];
export function esDeRrhh(k: TipoDeReporte): boolean {
  return TIPOS_DE_RRHH.includes(k);
}
export function esTipo(k: unknown): k is TipoDeReporte {
  return typeof k === "string" && (TIPOS as readonly string[]).includes(k);
}

export const INFO_DE_TIPO: Record<TipoDeReporte, { emoji: string; en: string; es: string; desc_en: string; desc_es: string }> = {
  incident: { emoji: "⚠️", en: "Incident", es: "Incidente", desc_en: "Something went wrong on the floor", desc_es: "Algo salió mal en el piso" },
  zone: { emoji: "🚧", en: "Zone infraction", es: "Infracción de zona", desc_en: "Someone out of their area", desc_es: "Alguien fuera de su área" },
  insubordination: { emoji: "✋", en: "Insubordination", es: "Insubordinación", desc_en: "Refused an instruction", desc_es: "Se negó a una instrucción" },
  safety: { emoji: "🦺", en: "Safety infraction", es: "Infracción de seguridad", desc_en: "PPE, exits, forklift, equipment", desc_es: "Protección, salidas, montacargas" },
  maintenance: { emoji: "🔧", en: "Maintenance log", es: "Mantenimiento", desc_en: "Forklifts and pallet jacks", desc_es: "Montacargas y patines" },
  positive: { emoji: "⭐", en: "Positive observation", es: "Observación positiva", desc_en: "Recognize good work", desc_es: "Reconocer un buen trabajo" },
  scrap: { emoji: "🧱", en: "Scrap / damage", es: "Merma / daños", desc_en: "Broken or sample merchandise", desc_es: "Material roto o de muestra" },
};
