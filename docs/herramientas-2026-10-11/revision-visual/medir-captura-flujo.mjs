// El flujo REAL de Ayuda, con el código de la rama: abrir, pulsar «Capturar», medir.
// Cuenta las llamadas a getDisplayMedia: la promesa es que la foto normal no pide permiso.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { abreChrome } from "./cdp.mjs";
const SCRATCH = process.env.SCRATCH;
mkdirSync(SCRATCH, { recursive: true });
const arg = process.argv[2] || "routes"; const ruta = arg === "ordenes" ? "/" : "/" + arg.replace(/^[/]+/, "");
const ESPERA_CALENTAR = Number(process.argv[3] ?? 4000);

const nav = await abreChrome({ ancho: Number(process.env.ANCHO || 1440), alto: Number(process.env.ALTO || 900) });
const p = await nav.pagina(`http://127.0.0.1:3917${ruta}`);
await p.espera(Number(process.env.ESPERA_INICIAL || 9000));

// Espía de getDisplayMedia: si alguien lo llama, se cuenta y se rechaza (no hay pantalla que dar).
await p.evalua(`(() => {
  window.__gdm = 0;
  const md = navigator.mediaDevices || (navigator.mediaDevices = {});
  md.getDisplayMedia = () => { window.__gdm++; return Promise.reject(Object.assign(new Error("espia"), { name: "NotAllowedError" })); };
  return true;
})()`);

const abre = await p.evalua(`(() => { const b = document.querySelector(".help-fab"); if (!b) return "sin boton"; b.click(); return "abierto"; })()`);
console.log("Ayuda:", abre);
await p.espera(ESPERA_CALENTAR); // lo que tarda alguien en escribir; aquí se calienta la foto

const mide = () => p.evalua(`(async () => {
  const boton = [...document.querySelectorAll("button")].find((b) => /Capture this screen|Capturar esta pantalla/.test(b.textContent));
  if (!boton) return JSON.stringify({ error: "sin boton de captura" });
  const t0 = performance.now();
  boton.click();
  let img = null;
  for (let i = 0; i < 4800 && !img; i++) {
    await new Promise((ok) => setTimeout(ok, 25));
    const c = document.querySelector('img[alt="Screenshot of the page"], img[alt="Captura de la página"]');
    if (c && c.complete && c.naturalWidth) img = c;
  }
  const ms = Math.round(performance.now() - t0);
  if (!img) return JSON.stringify({ error: "no salio el editor", ms, gdm: window.__gdm });
  return JSON.stringify({ ms, gdm: window.__gdm, ancho: img.naturalWidth, alto: img.naturalHeight, src: img.src });
})()`);
const primera = JSON.parse(await mide());
console.log("1er clic (incluye compilar en dev):", primera.error || (primera.ms + " ms"), "· gdm", primera.gdm);
await p.evalua(`(() => { const d = [...document.querySelectorAll("button")].find((b) => /^(Discard|Descartar)$/.test(b.textContent.trim())); if (d) d.click(); return !!d; })()`);
await p.espera(1500);
const x = JSON.parse(await mide());
if (x.error) { console.log("FALLO:", x.error, x.ms ?? "", "gdm", x.gdm ?? "?"); nav.cierra(); process.exit(1); }
console.log(`clic → editor con la foto: ${x.ms} ms · getDisplayMedia llamado: ${x.gdm} veces · ${x.ancho}x${x.alto}`);
writeFileSync(join(SCRATCH, `flujo-${ruta.replace(/\W/g, "") || "ordenes"}-${ESPERA_CALENTAR}.png`), Buffer.from(x.src.split(",")[1], "base64"));
await p.tiro(`flujo-pantalla-${ESPERA_CALENTAR}`);
nav.cierra();
