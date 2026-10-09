// Pulsa Ayer / Mañana / Hoy en el Gestor (demo) con clics de persona y lee la fecha y el botón marcado.
import { abreChrome } from "./cdp.mjs";
const URL = process.env.URL ?? "http://127.0.0.1:3962/routes";
for (const [ancho, alto] of [[1280, 900], [390, 844]]) {
  const nav = await abreChrome({ ancho, alto });
  const p = await nav.pagina(URL);
  await p.espera(10000);
  const lee = () => p.evalua(`({ fecha: document.querySelector('input[type=date]')?.value, marcado: [...document.querySelectorAll('[data-atajo-fecha]')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent), botones: [...document.querySelectorAll('[data-atajo-fecha]')].map(b => b.textContent), lado: document.documentElement.scrollWidth - document.documentElement.clientWidth })`);
  console.log(ancho, "al abrir:", JSON.stringify(await lee()));
  for (const dias of ["-1", "1", "0"]) {
    const r = await p.evalua(`(() => { const b = document.querySelector('[data-atajo-fecha="${dias}"]'); if (!b) return null; b.scrollIntoView({ block: "center" }); const x = b.getBoundingClientRect(); return { x: x.x + x.width / 2, y: x.y + x.height / 2 }; })()`);
    if (!r) { console.log("sin botón", dias); continue; }
    await p.espera(300);
    await p.raton("mousePressed", r.x, r.y); await p.raton("mouseReleased", r.x, r.y);
    await p.espera(800);
    console.log(ancho, "tras", dias, ":", JSON.stringify(await lee()));
  }
  await p.tiro(`atajos-fecha-${ancho}`);
  nav.cierra();
}
