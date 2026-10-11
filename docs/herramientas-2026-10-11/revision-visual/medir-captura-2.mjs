// Segunda medición: fuentes con crossorigin, Ayuda fuera por filtro, y dos capturas seguidas.
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

// Lo que hará el arreglo en layout.tsx: la hoja de Google Fonts con crossorigin. Aquí se simula
// recreando el <link>, porque cambiarle el atributo a uno ya cargado no lo vuelve a pedir.
const fuentes = await p.evalua(`(async () => {
  const viejo = document.querySelector('link[href*="fonts.googleapis.com/css2"]');
  if (!viejo) return "sin link de fuentes";
  const nuevo = viejo.cloneNode();
  nuevo.crossOrigin = "anonymous";
  await new Promise((ok) => { nuevo.onload = ok; nuevo.onerror = ok; document.head.appendChild(nuevo); });
  viejo.remove();
  let legibles = 0;
  for (const h of document.styleSheets) { try { if (h.href && h.href.includes("fonts.googleapis") && h.cssRules.length) legibles++; } catch {} }
  return "hojas de fuentes legibles: " + legibles;
})()`);
console.log(fuentes);

await p.manda("Runtime.evaluate", { expression: UMD });

const captura = (n) => p.evalua(`(async () => {
  const t0 = performance.now();
  const lienzo = await modernScreenshot.domToCanvas(document.documentElement, {
    width: innerWidth,
    height: innerHeight,
    backgroundColor: getComputedStyle(document.body).backgroundColor,
    filter: (nodo) => !(nodo instanceof Element && nodo.closest(".help-fab")),
  });
  const ms = Math.round(performance.now() - t0);
  return JSON.stringify({ ms, ancho: lienzo.width, alto: lienzo.height, png: ${n === 2 ? 'lienzo.toDataURL("image/png")' : '""'} });
})()`);

const a = JSON.parse(await captura(1));
console.log(`captura 1: ${a.ms} ms`);
const b = JSON.parse(await captura(2));
console.log(`captura 2: ${b.ms} ms, ${b.ancho}x${b.alto}`);
writeFileSync(join(SCRATCH, "captura-dom-2.png"), Buffer.from(b.png.split(",")[1], "base64"));
nav.cierra();
