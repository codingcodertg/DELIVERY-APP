import type { Stage } from "./types";

/**
 * El nombre de una etapa en el idioma de la persona (D-687).
 *
 * Las etapas viven en la base (`recruiting.stages.label`), con UNA columna de nombre y escrita en inglés. Todas
 * las pantallas de RRHH pintaban ese texto tal cual, así que el tablero, las píldoras de estado, los filtros y
 * las métricas seguían en inglés aunque la persona eligiera español en «Personalizar»: era lo más visible de la
 * app y no pasaba por `t()`.
 *
 * Solo se traducen las seis etapas de fábrica y solo si su nombre sigue siendo el de fábrica: si el admin la
 * renombró en Ajustes, lo que escribió es lo que se ve, en los dos idiomas.
 */
const ES: Record<string, { en: string; es: string }> = {
  registered: { en: "Registered", es: "Registrado" },
  phone: { en: "Phone Interview", es: "Entrevista telefónica" },
  standby: { en: "Standby", es: "En espera" },
  inperson: { en: "In Person Interview", es: "Entrevista presencial" },
  hired: { en: "Hired", es: "Contratado" },
  discarded: { en: "Discarded", es: "Descartado" },
};

const norma = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, " ");

export function etiquetaDeEtapa(stage: Pick<Stage, "key" | "label">, lang: "en" | "es"): string {
  if (lang !== "es") return stage.label;
  const fabrica = ES[stage.key];
  if (fabrica && norma(stage.label) === norma(fabrica.en)) return fabrica.es;
  return stage.label;
}

/** Las etapas con el nombre ya en el idioma de la persona; lo demás, intacto. */
export function etapasEnIdioma(stages: Stage[], lang: "en" | "es"): Stage[] {
  if (lang !== "es") return stages;
  return stages.map((s) => {
    const label = etiquetaDeEtapa(s, lang);
    return label === s.label ? s : { ...s, label };
  });
}
