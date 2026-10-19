#!/usr/bin/env node
// Inventario de SOLO LECTURA: por que al dueno no le salen las preguntas del puesto «Accounting Associate» (D-582).
//
// Uso (desde el checkout principal, que es donde vive .env.local):
//   node --env-file=.env.local scripts/_inv-rrhh-preguntas.mjs [texto-del-puesto]
//
// Lee con service-role (salta RLS) y NO escribe nada: solo select. Imprime:
//   1. el recruiting_role del dueno (careers@rdztilegroup.net) y de cualquier otro admin/manager de recruiting;
//   2. los puestos (settings.roles) y si el texto buscado esta entre ellos;
//   3. las vacantes (recruiting.jobs) que casen con el texto: estado, role, question_set_id;
//   4. los conjuntos (question_sets) con su puesto, si son predeterminados y cuantas preguntas activas tienen;
//   5. las preguntas activas cuyo `role` case con el texto, y en que conjunto estan;
//   6. los candidatos no archivados de esas vacantes: su `role` (es lo que filtra la entrevista) y su job_id.
// Sin acentos, como el resto de scripts.

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (correr con --env-file=.env.local)");
  process.exit(2);
}
const texto = (process.argv[2] ?? "accounting").toLowerCase();
const casa = (s) => typeof s === "string" && s.toLowerCase().includes(texto);

const pub = createClient(URL, KEY, { db: { schema: "public" } });
const rec = createClient(URL, KEY, { db: { schema: "recruiting" } });

const must = ({ data, error }, que) => {
  if (error) throw new Error(que + ": " + error.message);
  return data ?? [];
};

// 1. quien es quien en recruiting
const perfiles = must(await pub.from("profiles").select("id, full_name, role, recruiting_role, module_access").not("recruiting_role", "is", null), "profiles");
const { data: users } = await pub.auth.admin.listUsers({ perPage: 1000 });
const emailDe = new Map((users?.users ?? []).map((u) => [u.id, u.email]));
console.log("== 1. Perfiles con recruiting_role");
for (const p of perfiles) {
  const email = emailDe.get(p.id) ?? "?";
  const marca = email === "careers@rdztilegroup.net" ? "  <-- dueno" : "";
  console.log(`  ${p.recruiting_role.padEnd(9)} ${(p.full_name ?? "").padEnd(28)} ${email}${marca}`);
}

// 2. puestos configurados
const settings = must(await rec.from("settings").select("*"), "settings");
const roles = settings.flatMap((s) => (Array.isArray(s.roles) ? s.roles : []));
console.log("\n== 2. settings.roles:", JSON.stringify(roles));
console.log("   casa con «" + texto + "»:", JSON.stringify(roles.filter(casa)));

// 3. vacantes
const jobs = must(await rec.from("jobs").select("id, title, role, status, question_set_id, created_at").order("created_at"), "jobs");
console.log("\n== 3. Vacantes (" + jobs.length + ")");
for (const j of jobs) {
  const m = casa(j.title) || casa(j.role) ? "  <-- casa" : "";
  console.log(`  ${j.status.padEnd(6)} ${j.title.padEnd(32)} role=${String(j.role).padEnd(24)} set=${j.question_set_id ?? "null"}${m}`);
}

// 4. conjuntos y conteo
const sets = must(await rec.from("question_sets").select("id, name, role, is_default, created_at").order("created_at"), "question_sets");
const preguntas = must(await rec.from("questions").select("id, text, role, active, set_id, category"), "questions");
console.log("\n== 4. Conjuntos (" + sets.length + ")");
for (const s of sets) {
  const n = preguntas.filter((q) => q.set_id === s.id && q.active).length;
  const nTot = preguntas.filter((q) => q.set_id === s.id).length;
  console.log(`  ${s.is_default ? "*" : " "} ${s.name.padEnd(32)} puesto=${String(s.role).padEnd(24)} activas=${n}/${nTot} id=${s.id}`);
}
console.log("  preguntas sin conjunto:", preguntas.filter((q) => !q.set_id).length, "/", preguntas.length, "en total");

// 5. preguntas cuyo rol casa
const delPuesto = preguntas.filter((q) => casa(q.role));
console.log("\n== 5. Preguntas con role que casa con «" + texto + "» (" + delPuesto.length + ")");
for (const q of delPuesto) {
  const s = sets.find((x) => x.id === q.set_id);
  console.log(`  ${q.active ? "on " : "off"} role=${q.role.padEnd(24)} set=${s ? s.name : "(sin conjunto)"} ${q.text.slice(0, 60)}`);
}

// 6. candidatos de esas vacantes
const jobIds = jobs.filter((j) => casa(j.title) || casa(j.role)).map((j) => j.id);
if (jobIds.length) {
  const cands = must(await rec.from("candidates").select("id, full_name, role, job_id, archived").in("job_id", jobIds), "candidates");
  console.log("\n== 6. Candidatos en esas vacantes (" + cands.length + ")");
  for (const c of cands) {
    const j = jobs.find((x) => x.id === c.job_id);
    console.log(`  ${c.archived ? "arch" : "    "} ${(c.full_name ?? "").padEnd(28)} role=${String(c.role).padEnd(24)} vacante=${j?.title}`);
  }
} else {
  console.log("\n== 6. Ninguna vacante casa; no se listan candidatos.");
}
const porRol = {};
const todos = must(await rec.from("candidates").select("role").eq("archived", false), "candidates roles");
for (const c of todos) porRol[c.role ?? "null"] = (porRol[c.role ?? "null"] ?? 0) + 1;
console.log("   candidatos activos por role:", JSON.stringify(porRol));
