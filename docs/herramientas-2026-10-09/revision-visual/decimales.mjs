// Teclea decimales tecla a tecla en los campos del Estimador (demo) y lee lo que queda en pantalla.
import { abreChrome } from "./cdp.mjs";
const URL = process.env.URL ?? "http://127.0.0.1:3961/estimator";
const nav = await abreChrome({ ancho: 1280, alto: 900 });
const p = await nav.pagina(URL);
await p.espera(9000);
const hay = await p.evalua(`[...document.querySelectorAll("[data-sfcaja],[data-precio],[data-requested]")].length`);
console.log("campos de línea en pantalla:", hay);
if (!hay) {
  const botones = await p.evalua(`[...document.querySelectorAll("button")].map(b => b.textContent.trim()).filter(Boolean).slice(0, 40).join(" | ")`);
  console.log("botones:", botones);
}
async function teclea(selector, texto) {
  const r = await p.evalua(`(() => { const e = document.querySelector('${selector}'); if (!e) return null; e.scrollIntoView({ block: "center" }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  if (!r) return `sin ${selector}`;
  await p.espera(300);
  await p.raton("mousePressed", r.x, r.y); await p.raton("mouseReleased", r.x, r.y);
  await p.manda("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2 });
  await p.manda("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2 });
  await p.manda("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
  await p.manda("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
  for (const ch of texto) {
    await p.manda("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch });
    await p.manda("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
    await p.espera(60);
  }
  await p.espera(300);
  return p.evalua(`document.querySelector('${selector}').value`);
}
console.log("SF pedidos  «1250.5» →", JSON.stringify(await teclea("[data-requested]", "1250.5")));
console.log("SF / caja   «23.80»  →", JSON.stringify(await teclea("[data-sfcaja]", "23.80")));
console.log("$/SF        «1.89»   →", JSON.stringify(await teclea("[data-precio]", "1.89")));
console.log("SF real en pantalla:", await p.evalua(`document.querySelector("[data-sfreal]")?.textContent`));
await p.tiro("decimales-estimador");
nav.cierra();
