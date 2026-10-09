// Resuelve los conflictos de DECISIONS.md poniendo "ours" y DETRAS "theirs" en cada bloque.
// Solo vale si cada bloque es "las dos ramas anadieron entradas al final". Imprime cada bloque
// resumido para comprobarlo a ojo, y aborta si algun lado de un bloque no empieza por una cabecera
// de entrada o una linea en blanco (señal de que se tocaron las mismas lineas).
import { readFileSync, writeFileSync } from "node:fs";
const F = "DECISIONS.md";
const txt = readFileSync(F, "utf8");
const eol = txt.includes("\r\n") ? "\r\n" : "\n";
const L = txt.split(eol);
const out = [];
let i = 0, bloques = 0, raro = 0;
while (i < L.length) {
  if (L[i].startsWith("<<<<<<< ")) {
    const ours = [], theirs = [];
    i++;
    while (!L[i].startsWith("=======")) ours.push(L[i++]);
    i++;
    while (!L[i].startsWith(">>>>>>> ")) theirs.push(L[i++]);
    i++;
    bloques++;
    const cab = (a) => a.filter((l) => /^## D-/.test(l));
    console.log(`bloque ${bloques}: ours ${ours.length} lineas [${cab(ours).map((l) => l.slice(0, 14)).join(", ")}] | theirs ${theirs.length} lineas [${cab(theirs).map((l) => l.slice(0, 14)).join(", ")}]`);
    const primeraReal = (a) => a.find((l) => l.trim() !== "") ?? "";
    for (const [n, a] of [["ours", ours], ["theirs", theirs]]) {
      if (a.length && !/^(## D-|---)/.test(primeraReal(a))) { console.log(`   RARO: ${n} empieza por: ${primeraReal(a).slice(0, 80)}`); raro++; }
    }
    out.push(...ours, ...(ours.length && theirs.length && ours.at(-1).trim() !== "" ? [""] : []), ...theirs);
  } else out.push(L[i++]);
}
if (raro) { console.log("NO se escribe: hay bloques que no son solo anadidos al final"); process.exit(1); }
writeFileSync(F, out.join(eol));
console.log("escrito:", bloques, "bloque(s) resueltos por union");
