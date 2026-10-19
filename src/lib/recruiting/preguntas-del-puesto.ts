// Qué preguntas lleva la entrevista de un candidato, y quién puede decidirlo (D-NEXT).
//
// Dos preguntas, las dos puras:
//   1. `conjuntoDeEntrevista` — de qué conjunto se entrevista. El orden (vacante > puesto > implícito por
//      preguntas > predeterminado) ya vivía dentro de `InterviewModal`; aquí solo se saca para poder medirlo.
//   2. `preguntasDeEntrevista` — la lista final, filtrada y con las categorías de preselección delante.
//
// Más la puerta: `puedeAsignarPreguntasAlPuesto(rol)` decide quién ve el selector 📚 de cada vacante en
// Ajustes → Vacantes. Antes solo salía al CREAR la vacante; una vacante ya creada no tenía forma de recibir
// preguntas, y la otra puerta (el «Puesto:» del conjunto en Preguntas) es solo de admin.

export const PRESCREEN_CATEGORIES = ["Tenure", "Language Skill", "Education / Certifications"];

export type PreguntaMin = {
  id: string;
  role: string;
  active: boolean;
  set_id?: string | null;
  category?: string | null;
};
export type ConjuntoMin = { id: string; is_default: boolean; role?: string | null };
export type VacanteMin = { id: string; role: string | null; question_set_id?: string | null };

export type OrigenDelConjunto = "vacante" | "puesto" | "implicito" | "predeterminado" | "ninguno";

/**
 * De qué conjunto se entrevista, y por qué. `vacante` es la que tiene el candidato (`job_id`), ya resuelta
 * por quien llama; `rolDelCandidato`, su puesto.
 */
export function conjuntoDeEntrevista(args: {
  vacante: VacanteMin | null;
  rolDelCandidato: string | null | undefined;
  conjuntos: ConjuntoMin[];
  preguntas: PreguntaMin[];
}): { setId: string | null; origen: OrigenDelConjunto } {
  const { vacante, rolDelCandidato, conjuntos, preguntas } = args;
  if (vacante?.question_set_id) return { setId: vacante.question_set_id, origen: "vacante" };
  if (rolDelCandidato) {
    const propio = conjuntos.find((s) => s.role === rolDelCandidato);
    if (propio) return { setId: propio.id, origen: "puesto" };
    // El enlace implícito: un conjunto cuyo puesto nunca se marcó pero que tiene preguntas con ese rol.
    const implicito = preguntas.find((q) => q.active && q.role === rolDelCandidato && q.set_id)?.set_id;
    if (implicito) return { setId: implicito, origen: "implicito" };
  }
  const def = conjuntos.find((s) => s.is_default);
  return def ? { setId: def.id, origen: "predeterminado" } : { setId: null, origen: "ninguno" };
}

/**
 * La lista que ve quien entrevista. Una pregunta entra si está activa, pertenece al conjunto elegido (o no hay
 * conjunto) y su rol es «all», el del candidato o —solo cuando el conjunto lo fijó la vacante— el de la vacante:
 * si alguien sujetó ese conjunto a esa vacante, una pregunta etiquetada con el puesto de la vacante no se
 * esconde porque el candidato quedara registrado con otro nombre de puesto.
 */
export function preguntasDeEntrevista<Q extends PreguntaMin>(args: {
  vacante: VacanteMin | null;
  rolDelCandidato: string | null | undefined;
  conjuntos: ConjuntoMin[];
  preguntas: Q[];
}): Q[] {
  const { vacante, rolDelCandidato, conjuntos, preguntas } = args;
  const { setId, origen } = conjuntoDeEntrevista({ vacante, rolDelCandidato, conjuntos, preguntas });
  const rolesQueEntran = new Set<string>(["all"]);
  if (rolDelCandidato) rolesQueEntran.add(rolDelCandidato);
  if (origen === "vacante" && vacante?.role) rolesQueEntran.add(vacante.role);
  const filtradas = preguntas.filter(
    (q) => q.active && rolesQueEntran.has(q.role) && (setId ? q.set_id === setId : true),
  );
  // Las categorías de preselección delante, en ese orden; el resto conserva su orden (sort estable).
  const indice = (q: PreguntaMin) => {
    const i = PRESCREEN_CATEGORIES.indexOf(q.category ?? "");
    return i === -1 ? PRESCREEN_CATEGORIES.length : i;
  };
  return filtradas.slice().sort((a, b) => indice(a) - indice(b));
}

/** Quién puede cambiar el conjunto de preguntas de una vacante: admin y gerente de RR. HH.; el reclutador lo ve. */
export function puedeAsignarPreguntasAlPuesto(rol: string | null | undefined): boolean {
  return rol === "admin" || rol === "manager";
}

/** Cuántas preguntas activas tiene cada conjunto — para que un conjunto vacío se note en el selector. */
export function preguntasActivasPorConjunto(preguntas: PreguntaMin[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const q of preguntas) {
    if (!q.active || !q.set_id) continue;
    m.set(q.set_id, (m.get(q.set_id) ?? 0) + 1);
  }
  return m;
}
