#!/usr/bin/env node
// Escribe `public/tracker.html` para que la página tenga una URL fija:
// **https://rtg-hub.vercel.app/tracker.html**
//
// Corre en el `prebuild`, así que su primera obligación no es funcionar: es **no tumbar el
// despliegue**. Si falta cualquier cosa, escribe una página que lo dice y sale con 0. Una app de
// entregas caída porque una página de notas no encontró una variable sería un mal reparto del daño.
//
// ### Por qué aquí y no en un cubo de Storage
//
// Supabase Storage **sobrescribe a `text/plain`** el content-type de los `.html` de un cubo público,
// a propósito, como defensa contra páginas engañosas, y manda `X-Content-Type-Options: nosniff` para
// cerrar el único rodeo. La URL del cubo enseñaría el código fuente en vez de la página. Está
// medido; las fuentes, en la entrada de `DECISIONS.md`.
//
// `public/` de Next se sirve tal cual, con su tipo correcto, desde el mismo dominio del RTG. Es lo
// que el dueño pidió: *«no no físico en el app pero sí en el mismo de rtg»* — no es una ruta del hub,
// no sale en ningún menú y no lo enlaza nada.
//
// ### Lo que este generador NO lee
//
// **`SUPABASE_SERVICE_ROLE_KEY`, jamás.** No aparece en este fichero, y una prueba lo fija. Lo que
// escribe acaba servido en una URL pública: la anon key va porque es pública por diseño y sin sesión
// no abre nada —la RLS de la 144 solo deja leer al admin—, y la de servicio lo abriría todo.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { paginaEnVivoHTML } from "./pagina-en-vivo.mjs";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const DESTINO = join(REPO, "public", "tracker.html");

/**
 * Los valores de mentira que `scripts/verify.mjs` y el CI inyectan para poder compilar sin llaves.
 *
 * Medido: los dos llaman a `next build` **directamente**, no a `npm run build`, así que el
 * `prebuild` no corre ahí y estos valores no deberían llegar nunca. Se comprueban igual, porque
 * «no debería llegar» y «no llega» no son lo mismo, y el día que alguien corra `npm run build` en
 * local sin `.env.local` esto es lo que impide publicar una página con una llave inventada dentro.
 */
const DE_MENTIRA = ["placeholder", "ci-placeholder", "not-a-real-key", "ejemplo.supabase.co"];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

function noConfigurada(motivo) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tracker</title>
<style>body{margin:0;background:#15171b;color:#e8eaed;font:16px/1.6 system-ui,sans-serif}
main{max-width:520px;margin:15vh auto;padding:0 20px}h1{font-size:22px}p{color:#9aa1ab}</style>
</head><body><main>
<h1>Esta página no quedó configurada</h1>
<p>Se generó sin las variables del proyecto, así que no puede entrar a ningún sitio.</p>
<p>${motivo}</p>
<p>No es un fallo de la app: el resto del RTG funciona igual.</p>
</main></body></html>
`;
}

let html;
let comoQuedo;
try {
  if (!url || !anon) {
    comoQuedo = "sin configurar: faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY";
    html = noConfigurada("Faltan <code>NEXT_PUBLIC_SUPABASE_URL</code> o <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.");
  } else if (DE_MENTIRA.some((m) => url.includes(m) || anon.includes(m))) {
    // Publicar una página con un valor de compilación dentro sería peor que no publicarla: se abre,
    // pide la contraseña y nunca entra, y nadie sabe por qué.
    comoQuedo = "sin configurar: las variables son valores de compilación, no los de verdad";
    html = noConfigurada("Las variables con las que se generó son valores de compilación, no los reales.");
  } else {
    html = paginaEnVivoHTML({ url, anonKey: anon });
    comoQuedo = "lista, con la URL y la anon key del proyecto";
  }
} catch (e) {
  // Ni un error inesperado puede tumbar el build.
  comoQuedo = "sin configurar: " + String(e?.message ?? e);
  html = noConfigurada("No se pudo generar.");
}

try {
  mkdirSync(dirname(DESTINO), { recursive: true });
  writeFileSync(DESTINO, html);
  console.log("tracker: public/tracker.html " + comoQuedo);
} catch (e) {
  // Tampoco un disco lleno o un permiso. Se dice y se sigue.
  console.log("tracker: no se pudo escribir public/tracker.html (" + String(e?.message ?? e) + "); se sigue igual");
}
process.exit(0);
