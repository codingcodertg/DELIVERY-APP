#!/usr/bin/env node
// Sube la página en vivo al cubo `tracker`, para que tenga una URL fija.
//
//   node tracker/sube-pagina.mjs                 # ENSAYO: la genera y la comprueba, no sube nada
//   node tracker/sube-pagina.mjs --escribir      # de verdad
//
// **Nace en ensayo**, como el importador: un script que publica por defecto es un script que alguien
// corre «para ver» y descubre después qué publicó. Y este publica en una URL que cualquiera abre.
//
// Antes de subir, **se revisa a sí mismo**. El cubo es público de solo lectura, así que lo que se
// suba queda a la vista de quien tenga el enlace: si la página llevara una llave de servicio o una
// sola tarea dentro, esto sería una fuga y no una comodidad. Las dos cosas se comprueban aquí,
// además de en las pruebas, porque son dos momentos distintos: la prueba mira el código, esto mira
// **el fichero exacto que se va a subir**.

import { paginaEnVivoHTML } from "./pagina-en-vivo.mjs";

const ESCRIBIR = process.argv.includes("--escribir");
const CUBO = "tracker";
const OBJETO = "informe.html";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
const servicio = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;

function muere(msg) {
  console.error(msg);
  process.exit(1);
}

if (!url || !anon) {
  muere("faltan NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY (las dos son públicas)."
    + "\n  En un worktree no están a propósito: esto se hace desde el checkout principal.");
}

const html = paginaEnVivoHTML({ url, anonKey: anon });

// ---------------------------------------------------------------- revisarse antes de publicar
const problemas = [];
if (/service_role/.test(html)) problemas.push("lleva la cadena «service_role» dentro");
if (/SUPABASE_SERVICE/.test(html)) problemas.push("nombra una variable de servicio");
if (/"T-\d{4}"/.test(html)) problemas.push("lleva tareas dentro; tiene que pedirlas al abrirse");
if (!html.includes(anon)) problemas.push("no lleva la anon key, así que no podría entrar nadie");
if (problemas.length) {
  muere("NO se sube. La página tiene problemas:\n  - " + problemas.join("\n  - "));
}

const publica = url.replace(/\/+$/, "") + "/storage/v1/object/public/" + CUBO + "/" + OBJETO;

console.log((ESCRIBIR ? "SUBIENDO" : "ENSAYO (no sube nada)") + "  ·  " + Math.round(html.length / 1024) + " KB");
console.log("  revisada: sin llaves de servicio, sin tareas dentro, con la anon key.");
console.log("  destino:  " + CUBO + "/" + OBJETO);
console.log("  quedará en: " + publica);

if (!ESCRIBIR) {
  console.log("");
  console.log("Repite con --escribir cuando quieras publicarla.");
  process.exit(0);
}

if (!servicio) {
  muere("para subir hace falta SUPABASE_SERVICE_ROLE_KEY. La escritura del cubo es solo suya (145).");
}

const { createClient } = await import("@supabase/supabase-js");
const db = createClient(url, servicio, { auth: { persistSession: false } });

const { error } = await db.storage.from(CUBO).upload(OBJETO, new Blob([html], { type: "text/html" }), {
  upsert: true,
  contentType: "text/html; charset=utf-8",
  // Una hora: lo justo para que no haga falta esperar a que caduque tras publicar un cambio, y
  // suficiente para que abrirla dos veces seguidas no vuelva a bajarla.
  cacheControl: "3600",
});
if (error) muere("no se pudo subir: " + error.message);

// Se comprueba CONTRA EL SERVIDOR, no dando por bueno que un upload sin error significa publicado.
const r = await fetch(publica, { cache: "no-store" });
if (!r.ok) muere("subida sin error, pero la URL pública responde " + r.status + ". Mira el cubo antes de darlo por hecho.");
const bajado = await r.text();
if (bajado.length !== html.length) {
  muere("lo que responde la URL no es del mismo tamaño que lo subido (" + bajado.length + " vs " + html.length + ").");
}
console.log("");
console.log("publicada y comprobada bajándola: " + publica);
