// Tercera medición: dónde se va el tiempo, y la captura con la ventana desplazada.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { abreChrome } from "./cdp.mjs";

const SCRATCH = process.env.SCRATCH;
const UMD = readFileSync(process.env.MS, "utf8");
const ruta = "/" + (process.argv[2] || "").replace(/^[/]+/, "");
const BAJA = Number(process.argv[3] || 600);
mkdirSync(SCRATCH, { recursive: true });

const nav = await abreChrome({ ancho: 1440, alto: 900 });
const p = await nav.pagina(`http://127.0.0.1:3917${ruta}`);
await p.espera(9000);

// Fuentes con crossorigin, como quedará en layout.tsx.
await p.evalua(`(async () => {
  const viejo = document.querySelector('link[href*="fonts.googleapis.com/css2"]');
  if (!viejo) return;
  const nuevo = viejo.cloneNode(); nuevo.crossOrigin = "anonymous";
  await new Promise((ok) => { nuevo.onload = ok; nuevo.onerror = ok; document.head.appendChild(nuevo); });
  viejo.remove();
})()`);
await p.manda("Runtime.evaluate", { expression: UMD });

// La función de captura que se está probando, con sus perillas.
await p.evalua(`(window.__captura = async ({ debajo = true, fuentes = true, png = false } = {}) => {
  const alto = innerHeight, ancho = innerWidth, sy = scrollY, sx = scrollX;
  // Lo pegado (sticky) se desplaza cuando está «enganchado». En la copia no hay scroll, así que se
  // calcula cuánto se ha movido respecto a donde estaría suelto y se le aplica como top relativo.
  const pegados = [];
  for (const e of document.querySelectorAll("body *")) {
    if (getComputedStyle(e).position !== "sticky") continue;
    const enganchado = e.getBoundingClientRect();
    const prev = e.style.position; e.style.position = "relative";
    const suelto = e.getBoundingClientRect();
    e.style.position = prev;
    const dy = enganchado.top - suelto.top, dx = enganchado.left - suelto.left;
    if (dy || dx) { e.setAttribute("data-captura-pegado", dx + "," + dy); pegados.push(e); }
  }
  let nodos = 0, saltados = 0;
  const t0 = performance.now();
  try {
    const lienzo = await modernScreenshot.domToCanvas(document.documentElement, {
      width: ancho, height: alto,
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      font: fuentes ? undefined : false,
      filter: (n) => {
        nodos++;
        if (!(n instanceof Element)) return true;
        if (n.closest(".help-fab")) return false;
        // Lo que está ENTERO por debajo de lo visible no se clona: no afecta a la colocación de lo
        // de arriba. Lo de ARRIBA sí se clona siempre, o lo visible subiría al quitarlo.
        if (debajo) {
          const r = n.getBoundingClientRect();
          if (r.top >= alto && getComputedStyle(n).position !== "fixed") { saltados++; return false; }
        }
        return true;
      },
      onCloneNode: (copia) => {
        const body = copia.querySelector("body");
        // relative + top y no transform: un transform haría de bloque contenedor de lo fijo, y lo
        // fijo se iría con el desplazamiento. Con top relativo, lo fijo sigue pegado a la ventana.
        if (body && (sy || sx)) { body.style.position = "relative"; body.style.top = (-sy) + "px"; body.style.left = (-sx) + "px"; }
        for (const e of copia.querySelectorAll("[data-captura-pegado]")) {
          const [dx, dy] = e.getAttribute("data-captura-pegado").split(",").map(Number);
          e.style.position = "relative"; e.style.top = dy + "px"; e.style.left = dx + "px";
          e.removeAttribute("data-captura-pegado");
        }
      },
    });
    const ms = Math.round(performance.now() - t0);
    return JSON.stringify({ ms, nodos, saltados, png: png ? lienzo.toDataURL("image/png") : "" });
  } finally {
    for (const e of pegados) e.removeAttribute("data-captura-pegado");
  }
})`);

const total = await p.evalua(`document.querySelectorAll("*").length`);
console.log(`ruta ${ruta} · nodos en el DOM: ${total}`);
const c = async (op, etiqueta) => { const r = JSON.parse(await p.evalua(`window.__captura(${JSON.stringify(op)})`)); console.log(`${etiqueta.padEnd(36)} ${String(r.ms).padStart(5)} ms  (filtro vio ${r.nodos}, saltó ${r.saltados})`); return r; };

await c({ debajo: false }, "todo el documento (calentar)");
await c({ debajo: false }, "todo el documento");
await c({ debajo: true }, "sin lo de debajo");
await c({ debajo: true, fuentes: false }, "sin lo de debajo, sin fuentes");

// Con scroll: referencia de Chrome y captura, en la misma posición.
await p.evalua(`(scrollTo(0, ${BAJA}), scrollY)`);
await p.espera(1200);
console.log("scrollY real:", await p.evalua("scrollY"));
await p.tiro("referencia-con-scroll");
const s = await c({ debajo: true, png: true }, "CON SCROLL, sin lo de debajo");
writeFileSync(join(SCRATCH, "captura-con-scroll.png"), Buffer.from(s.png.split(",")[1], "base64"));
nav.cierra();
