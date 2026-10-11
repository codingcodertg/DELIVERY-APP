// Cuarta medición: snapdom en la misma página y en las mismas condiciones que modern-screenshot.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { abreChrome } from "./cdp.mjs";

const SCRATCH = process.env.SCRATCH;
const UMD = readFileSync(process.env.SD, "utf8");
const ruta = "/" + (process.argv[2] || "").replace(/^[/]+/, "");
const BAJA = Number(process.argv[3] || 600);
mkdirSync(SCRATCH, { recursive: true });

const nav = await abreChrome({ ancho: 1440, alto: 900 });
const p = await nav.pagina(`http://127.0.0.1:3917${ruta}`);
await p.espera(9000);
await p.evalua(`(async () => {
  const viejo = document.querySelector('link[href*="fonts.googleapis.com/css2"]');
  if (!viejo) return;
  const nuevo = viejo.cloneNode(); nuevo.crossOrigin = "anonymous";
  await new Promise((ok) => { nuevo.onload = ok; nuevo.onerror = ok; document.head.appendChild(nuevo); });
  viejo.remove();
})()`);
await p.manda("Runtime.evaluate", { expression: UMD });
console.log("snapdom cargado:", await p.evalua("typeof window.snapdom"));
console.log(`ruta ${ruta} · nodos: ${await p.evalua('document.querySelectorAll("*").length')}`);

const c = async (op, etiqueta, png = false) => {
  const r = JSON.parse(await p.evalua(`(async () => {
    const t0 = performance.now();
    const lienzo = await snapdom.toCanvas(document.body, Object.assign({
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      exclude: [".help-fab"], excludeMode: "hide",
    }, ${JSON.stringify(op)}));
    const ms = Math.round(performance.now() - t0);
    return JSON.stringify({ ms, ancho: lienzo.width, alto: lienzo.height, png: ${png} ? lienzo.toDataURL("image/png") : "" });
  })()`));
  console.log(`${etiqueta.padEnd(30)} ${String(r.ms).padStart(5)} ms  ${r.ancho}x${r.alto}`);
  return r;
};

await c({}, "body entero (calentar)");
await c({}, "body entero");
await c({ clip: "viewport" }, "clip viewport");
await c({ clip: "viewport" }, "clip viewport (2a)");
const sinScroll = await c({ clip: "viewport" }, "clip viewport (3a, png)", true);
writeFileSync(join(SCRATCH, "snapdom-sin-scroll.png"), Buffer.from(sinScroll.png.split(",")[1], "base64"));

await p.evalua(`(scrollTo(0, ${BAJA}), scrollY)`);
await p.espera(1200);
console.log("scrollY real:", await p.evalua("scrollY"));
await p.tiro("referencia-con-scroll-sd");
const conScroll = await c({ clip: "viewport" }, "CON SCROLL clip viewport", true);
writeFileSync(join(SCRATCH, "snapdom-con-scroll.png"), Buffer.from(conScroll.png.split(",")[1], "base64"));
nav.cierra();
