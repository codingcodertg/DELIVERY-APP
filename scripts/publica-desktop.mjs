// Publica la app de escritorio para que las instaladas se actualicen solas (D-811).
//
//   cd desktop && npm install && npm run dist && cd ..
//   node --env-file=.env.local scripts/publica-desktop.mjs
//
// Sube al almacén privado de Blob (BLOB_READ_WRITE_TOKEN, el mismo de /api/download) los DOS ficheros que
// electron-builder deja en desktop/dist, con nombre estable:
//   desktop/dist/latest.yml              → apps/latest.yml
//   desktop/dist/RTG-Hub-Setup-<v>.exe   → apps/RTG-Hub-Setup.exe
// Siempre los dos juntos: el sha512 del yml tiene que ser el del exe que se sirve, o la app descarta la descarga.
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
const { put } = createRequire(import.meta.url)("@vercel/blob");

if (!process.env.BLOB_READ_WRITE_TOKEN) { console.error("Falta BLOB_READ_WRITE_TOKEN (usa --env-file=.env.local)."); process.exit(2); }
const dist = join("desktop", "dist");
const exe = readdirSync(dist).find((n) => /^RTG-Hub-Setup-[\w.-]+\.exe$/.test(n));
if (!exe) { console.error(`No hay RTG-Hub-Setup-<v>.exe en ${dist}: compila primero (cd desktop && npm run dist).`); process.exit(1); }
const yml = readFileSync(join(dist, "latest.yml"), "utf8");
if (!yml.includes(exe)) { console.error(`latest.yml no nombra ${exe}: son de compilaciones distintas.`); process.exit(1); }
console.log(`Publicando ${exe} (${(readFileSync(join(dist, exe)).length / 1048576).toFixed(0)} MB) y latest.yml…`);
const subidas = [
  ["apps/RTG-Hub-Setup.exe", readFileSync(join(dist, exe)), "application/octet-stream"],
  ["apps/latest.yml", yml, "text/yaml"],
];
for (const [nombre, cuerpo, contentType] of subidas) {
  const r = await put(nombre, cuerpo, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType });
  console.log(`  ${nombre} → ${r.pathname}`);
}
console.log(`Listo: ${/version:\s*(\S+)/.exec(yml)?.[1] ?? "?"}. Las apps instaladas (1.2.0+) la bajan solas en ≤ 4 h.`);
