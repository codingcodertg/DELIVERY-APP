// Sexta: tiempos fiables. Cinco capturas seguidas por página, sin tocar el DOM entre ellas.
import { readFileSync } from "node:fs";
import { abreChrome } from "./cdp.mjs";
const UMD = readFileSync(process.env.SD, "utf8");
const nav = await abreChrome({ ancho: 1440, alto: 900 });
for (const ruta of ["/", "/routes"]) {
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
  const tiempos = [];
  for (let i = 0; i < 6; i++) {
    tiempos.push(Number(await p.evalua(`(async () => {
      const t0 = performance.now();
      await snapdom.toCanvas(document.body, { clip: "viewport", backgroundColor: getComputedStyle(document.body).backgroundColor, exclude: [".help-fab"], excludeMode: "hide" });
      return Math.round(performance.now() - t0);
    })()`)));
  }
  const calientes = tiempos.slice(1).sort((a, b) => a - b);
  console.log(`${ruta.padEnd(8)} fria ${tiempos[0]} ms · calientes ${tiempos.slice(1).join(", ")} · mediana ${calientes[2]} ms`);
}
nav.cierra();
