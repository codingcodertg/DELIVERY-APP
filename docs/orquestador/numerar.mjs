// Sustituye D-NEXT por el numero de la rama que escribio ESA linea (git blame), solo en lineas
// que esta release anade respecto de origin/main. Sin --escribir, solo cuenta.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 1 << 28 });
const RAMAS = { "<SHA COMPLETO DE LA RAMA>": "D-NNN" }; // el orquestador lo cambia en cada release
const deCommit = new Map();
for (const [sha, num] of Object.entries(RAMAS)) for (const c of git("log", "--format=%H", `origin/main..${sha}`).trim().split("\n").filter(Boolean)) {
  if (deCommit.has(c) && deCommit.get(c) !== num) throw new Error("commit en dos ramas: " + c);
  deCommit.set(c, num);
}
const escribir = process.argv.includes("--escribir");
const ficheros = git("diff", "--name-only", "origin/main", "HEAD").trim().split("\n").filter(Boolean);
const cuenta = {}; let sinDueno = 0;
for (const f of ficheros) {
  let txt; try { txt = readFileSync(f, "utf8"); } catch { continue; }
  if (!txt.includes("D-NEXT")) continue;
  const eol = txt.includes("\r\n") ? "\r\n" : "\n";
  const L = txt.split(eol);
  const blame = git("blame", "--porcelain", "HEAD", "--", f).split("\n");
  const commitDeLinea = [];
  for (const b of blame) { const m = /^([0-9a-f]{40}) \d+ (\d+)/.exec(b); if (m) commitDeLinea[+m[2] - 1] = m[1]; }
  let cambios = 0;
  for (let i = 0; i < L.length; i++) {
    if (!L[i].includes("D-NEXT")) continue;
    const num = deCommit.get(commitDeLinea[i]);
    if (!num) { sinDueno++; console.log(`   sin rama (se deja): ${f}:${i + 1}  ${L[i].trim().slice(0, 90)}`); continue; }
    const n = L[i].split("D-NEXT").length - 1;
    L[i] = L[i].split("D-NEXT").join(num); cambios += n;
    cuenta[num] = (cuenta[num] || 0) + n;
  }
  if (cambios) { console.log(`${f}: ${cambios}`); if (escribir) writeFileSync(f, L.join(eol)); }
}
console.log("por numero:", JSON.stringify(cuenta), "| dejadas sin rama:", sinDueno, escribir ? "| ESCRITO" : "| (ensayo)");
