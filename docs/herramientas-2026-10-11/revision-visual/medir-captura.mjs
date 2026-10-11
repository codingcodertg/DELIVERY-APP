// Mide la captura SIN permiso (modern-screenshot, DOM → lienzo) contra el demo local.
// Contesta tres preguntas antes de reescribir D-509:
//   1. ¿Cómo hace scroll el app? (ventana o contenedor interior; qué es fixed/sticky)
//   2. ¿Sale el mapa? (mosaicos de Leaflet desde servidores con CORS)
//   3. ¿Cuánto tarda?
// Uso: SCRATCH=<carpeta> MS=<ruta a modern-screenshot/dist/index.js> node medir-captura.mjs [ruta]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { abreChrome } from "./cdp.mjs";

const SCRATCH = process.env.SCRATCH;
const UMD = readFileSync(process.env.MS, "utf8");
const ruta = "/" + (process.argv[2] || "routes").replace(/^[/]+/, "");
mkdirSync(SCRATCH, { recursive: true });

const nav = await abreChrome({ ancho: 1440, alto: 900 });
const p = await nav.pagina(`http://127.0.0.1:3917${ruta}`);
await p.espera(9000);

const modelo = await p.evalua(`(() => {
  const se = document.scrollingElement;
  const todos = [...document.querySelectorAll("body *")];
  const scrollers = todos.filter((e) => {
    const s = getComputedStyle(e);
    return (s.overflowY === "auto" || s.overflowY === "scroll") && e.scrollHeight > e.clientHeight + 4;
  }).map((e) => String(e.className || e.tagName).slice(0, 50) + " h=" + e.clientHeight + "/" + e.scrollHeight);
  const fijos = todos.filter((e) => {
    const pos = getComputedStyle(e).position;
    return pos === "fixed" || pos === "sticky";
  }).map((e) => getComputedStyle(e).position + ":" + String(e.className || e.tagName).slice(0, 40));
  return JSON.stringify({
    ventana: se.scrollHeight + "/" + innerHeight,
    scrollers,
    fijos: fijos.slice(0, 15),
    mapa: !!document.querySelector(".leaflet-container"),
    mosaicos: document.querySelectorAll(".leaflet-tile-loaded").length,
    origenesDeMosaicos: [...new Set([...document.querySelectorAll(".leaflet-tile")].map((i) => new URL(i.src).host))],
  }, null, 1);
})()`);
console.log("== MODELO DE SCROLL ==\n" + modelo);

// Referencia: lo que de verdad pinta Chrome.
await p.tiro("referencia-chrome");

// La librería, inyectada tal cual (UMD → globalThis.modernScreenshot). Como cadena, sin plantilla.
await p.manda("Runtime.evaluate", { expression: UMD });

const r = await p.evalua(`(async () => {
  const t0 = performance.now();
  const lienzo = await modernScreenshot.domToCanvas(document.documentElement, {
    width: innerWidth,
    height: innerHeight,
    backgroundColor: getComputedStyle(document.body).backgroundColor,
  });
  const ms = Math.round(performance.now() - t0);
  return JSON.stringify({ ms, ancho: lienzo.width, alto: lienzo.height, png: lienzo.toDataURL("image/png") });
})()`);
const res = JSON.parse(r);
console.log(`== CAPTURA DOM == ${res.ms} ms, ${res.ancho}x${res.alto}`);
writeFileSync(join(SCRATCH, "captura-dom.png"), Buffer.from(res.png.split(",")[1], "base64"));

nav.cierra();
console.log("PNG en " + SCRATCH);
