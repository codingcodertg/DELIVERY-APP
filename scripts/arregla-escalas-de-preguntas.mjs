// Arregla las escalas de las preguntas de RR. HH. que van al revés (D-NEXT, 2026-10-19).
//
// El dueño: «mires todas las preguntas y mires el rating system porque están al revés … todas deberían ser uno como worst
// y four como good. Y hay unas que sería afecta levemente o afecta, que es number four … afecta sería número uno».
//
// Medido (167 preguntas en `recruiting.questions`):
//   · 25 con la escala de RIESGO al revés: 1=No Risk … 4=Affecting. En el código (`scorecards.ts`) esa escala llevaba
//     `descending: true` para que la media le diera la vuelta al grado; en la base NINGUNA fila conserva esa marca.
//     10 preguntas hermanas ya estaban bien (1=Affecting … 4=No Risk).
//   · 1 de riesgo revuelta (1=Affecting, 2=No Risk, 3=Possible, 4=Slightly Affecting).
//   · 1 de desempeño revuelta (1=Good, 2=Great, 3=Mediocre, 4=Bad / None).
//   · 1 con etiquetas rotas (1=Worst, 2=Bad, 3=Bad, 4=Worst): vuelve a la escala global (Worst / Bad / Average / Good).
//   · 5 con texto en mojibake («Â¿», «Ã¡»): se decodifican (latin1 → utf8).
//
// Qué escribe (solo con --escribe; sin él, lo cuenta y no toca nada):
//   1. `questions.scale` de esas 28 filas, con el orden bueno: 1 = lo peor (Afecta), 4 = lo mejor (Sin riesgo).
//   2. Las entrevistas hechas NO cambian. Medido en el ensayo: los reclutadores calificaron por NÚMERO (4 = bueno) aunque
//      la etiqueta dijera «Afecta» (p. ej. cuatro preguntas de riesgo con 4 en una entrevista de media 3,67); traducir
//      por etiqueta (4 → 1) habría hundido entrevistas buenas. Solo se cuentan, para el registro.
//   3. Los textos con mojibake.
// Antes de escribir guarda lo anterior en D:\CLAUDE\respaldos\escalas-antes-<fecha>.json (para deshacer a mano).
//
//   node --env-file=.env.local scripts/arregla-escalas-de-preguntas.mjs            → ensayo (no escribe)
//   node --env-file=.env.local scripts/arregla-escalas-de-preguntas.mjs --escribe  → escribe

import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync } from "node:fs";

const ESCRIBE = process.argv.includes("--escribe");

const nivel = (value, en, es) => ({ value, label_en: en, label_es: es, example_en: "", example_es: "" });
/** Riesgo, bien: 1 = lo peor. */
export const RIESGO = [nivel(1, "Affecting", "Afecta"), nivel(2, "Slightly Affecting", "Afecta levemente"), nivel(3, "Possible", "Posible"), nivel(4, "No Risk", "Sin riesgo")];
export const DESEMPENO = [nivel(1, "Bad / None", "Malo / Ninguno"), nivel(2, "Mediocre", "Mediocre"), nivel(3, "Good", "Bueno"), nivel(4, "Great", "Excelente")];

const etiquetas = (scale) => (scale ?? []).map((l) => l.label_en);
const esRiesgo = (scale) => { const s = new Set(etiquetas(scale)); return s.size === 4 && ["No Risk", "Possible", "Slightly Affecting", "Affecting"].every((x) => s.has(x)); };
const esDesempeno = (scale) => { const s = new Set(etiquetas(scale)); return s.size === 4 && ["Bad / None", "Mediocre", "Good", "Great"].every((x) => s.has(x)); };
const igual = (a, b) => JSON.stringify(etiquetas(a)) === JSON.stringify(etiquetas(b));
const rota = (scale) => JSON.stringify(etiquetas(scale)) === JSON.stringify(["Worst", "Bad", "Bad", "Worst"]);

/** Qué escala debe tener la pregunta, o null si ya está bien. `mapa`: grado viejo → grado nuevo por ETIQUETA (informativo;
 *  no se aplica a las entrevistas, ver cabecera). */
export function arregloDe(q) {
  const sc = q.scale;
  if (!sc || !sc.length) return null;
  let nueva = null;
  if (esRiesgo(sc) && !igual(sc, RIESGO)) nueva = RIESGO;
  else if (esDesempeno(sc) && !igual(sc, DESEMPENO)) nueva = DESEMPENO;
  else if (rota(sc)) return { nueva: null, mapa: null, motivo: "etiquetas rotas → escala global" };
  if (!nueva) return null;
  const mapa = {};
  for (const viejo of sc) mapa[viejo.value] = nueva.find((n) => n.label_en === viejo.label_en).value;
  return { nueva, mapa, motivo: `${etiquetas(sc).join("/")} → ${etiquetas(nueva).join("/")}` };
}

export const mojibake = (t) => /Â|Ã/.test(t ?? "");
export function desmojibakea(t) {
  try { return Buffer.from(t, "latin1").toString("utf8"); } catch { return t; }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  const db = createClient(url, key, { db: { schema: "recruiting" } });

  const { data: preguntas, error } = await db.from("questions").select("*").order("sort");
  if (error) throw new Error(error.message);
  const arreglos = new Map();
  for (const q of preguntas) { const a = arregloDe(q); if (a) arreglos.set(q.id, { q, ...a }); }
  const conTexto = preguntas.filter((q) => mojibake(q.text) || mojibake(q.text_es));
  console.log(`${preguntas.length} preguntas · ${arreglos.size} con la escala al revés o revuelta · ${conTexto.length} con texto en mojibake`);
  for (const a of arreglos.values()) console.log(`  ${a.q.id.slice(0, 8)} [${a.q.category}] ${a.q.role} · ${a.motivo}`);
  for (const q of conTexto) console.log(`  texto ${q.id.slice(0, 8)}: «${(q.text_es || q.text).slice(0, 50)}» → «${desmojibakea(q.text_es || q.text).slice(0, 50)}»`);

  // Entrevistas que calificaron alguna de esas preguntas: se cuentan, no se tocan (ver cabecera).
  const idsQueCambian = new Set([...arreglos.values()].filter((a) => a.mapa).map((a) => a.q.id));
  const { data: candidatos, error: e2 } = await db.from("candidates").select("id, interview").not("interview", "is", null);
  if (e2) throw new Error(e2.message);
  let entrevistas = 0, respuestas = 0;
  for (const c of candidatos) {
    const n = Object.entries(c.interview?.answers ?? {}).filter(([qid, v]) => idsQueCambian.has(qid) && v?.grade != null).length;
    if (n) { entrevistas++; respuestas += n; }
  }
  console.log(`${candidatos.length} entrevistas · ${entrevistas} calificaron alguna de esas preguntas (${respuestas} respuestas); se quedan como están.`);

  if (!ESCRIBE) { console.log("\nENSAYO: nada escrito. Con --escribe se aplica."); return; }

  mkdirSync("D:/CLAUDE/respaldos", { recursive: true });
  const sello = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(`D:/CLAUDE/respaldos/escalas-antes-${sello}.json`, JSON.stringify({
    preguntas: [...arreglos.values()].map((a) => ({ id: a.q.id, scale: a.q.scale })).concat(conTexto.map((q) => ({ id: q.id, text: q.text, text_es: q.text_es }))),
  }, null, 1));
  let n = 0;
  for (const a of arreglos.values()) {
    const { data, error: e } = await db.from("questions").update({ scale: a.nueva }).eq("id", a.q.id).select("id");
    if (e) throw new Error(`${a.q.id}: ${e.message}`); if (!data?.length) throw new Error(`${a.q.id}: 0 filas`); n++;
  }
  for (const q of conTexto) {
    const patch = {}; if (mojibake(q.text)) patch.text = desmojibakea(q.text); if (mojibake(q.text_es)) patch.text_es = desmojibakea(q.text_es);
    const { data, error: e } = await db.from("questions").update(patch).eq("id", q.id).select("id");
    if (e) throw new Error(`${q.id}: ${e.message}`); if (!data?.length) throw new Error(`${q.id}: 0 filas`); n++;
  }
  console.log(`\nESCRITO: ${n} filas (respaldo en D:/CLAUDE/respaldos/escalas-antes-${sello}.json)`);
}

if (process.argv[1] && /arregla-escalas-de-preguntas\.mjs$/.test(process.argv[1])) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
