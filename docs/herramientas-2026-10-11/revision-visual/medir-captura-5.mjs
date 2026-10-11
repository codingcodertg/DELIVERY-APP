// Quinta: ¿salen los elementos FIJOS (avisos, toasts) en la captura con clip viewport y scroll?
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { abreChrome } from "./cdp.mjs";
const SCRATCH = process.env.SCRATCH;
const UMD = readFileSync(process.env.SD, "utf8");
mkdirSync(SCRATCH, { recursive: true });
const nav = await abreChrome({ ancho: 1440, alto: 900 });
const p = await nav.pagina("http://127.0.0.1:3917/");
await p.espera(9000);
await p.manda("Runtime.evaluate", { expression: UMD });
// Qué es el pie de abajo que faltó.
console.log("pie:", await p.evalua(`(() => {
  const e = [...document.querySelectorAll("body *")].find((x) => x.children.length === 0 && x.textContent.trim() === "v1.280.0" && x.getBoundingClientRect().top > 300);
  if (!e) return "no encontrado";
  let a = e, cadena = [];
  while (a && a !== document.body) { const s = getComputedStyle(a); cadena.push((a.className || a.tagName).toString().slice(0, 25) + "[" + s.position + "]"); a = a.parentElement; }
  return cadena.join(" < ");
})()`));
// Dos avisos fijos de prueba, como un toast real: abajo y arriba.
await p.evalua(`(() => {
  for (const [pos, txt] of [["bottom:24px;left:24px", "AVISO FIJO ABAJO"], ["top:120px;right:24px", "AVISO FIJO ARRIBA"]]) {
    const d = document.createElement("div");
    d.textContent = txt;
    d.setAttribute("style", "position:fixed;" + pos + ";z-index:9999;background:#dc2626;color:#fff;padding:14px 18px;font:700 18px Inter;border-radius:8px");
    document.body.appendChild(d);
  }
  scrollTo(0, 600);
  return scrollY;
})()`);
await p.espera(800);
await p.tiro("referencia-fijos");
for (let i = 0; i < 2; i++) await p.evalua(`snapdom.toCanvas(document.body, { clip: "viewport", exclude: [".help-fab"], excludeMode: "hide" }).then(() => 1)`);
const r = JSON.parse(await p.evalua(`(async () => {
  const t0 = performance.now();
  const l = await snapdom.toCanvas(document.body, { clip: "viewport", backgroundColor: getComputedStyle(document.body).backgroundColor, exclude: [".help-fab"], excludeMode: "hide" });
  return JSON.stringify({ ms: Math.round(performance.now() - t0), png: l.toDataURL("image/png") });
})()`));
console.log("captura con fijos:", r.ms, "ms");
writeFileSync(join(SCRATCH, "snapdom-fijos.png"), Buffer.from(r.png.split(",")[1], "base64"));
nav.cierra();
