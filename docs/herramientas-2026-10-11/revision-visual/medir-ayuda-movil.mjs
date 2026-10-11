import { abreChrome } from "./cdp.mjs";
const nav = await abreChrome({ ancho: 390, alto: 844 });
const p = await nav.pagina("http://127.0.0.1:3917/");
await p.espera(10000);
console.log(await p.evalua(`JSON.stringify({
  url: location.pathname,
  fab: document.querySelectorAll(".help-fab").length,
  ayuda: [...document.querySelectorAll("button, a")].filter((e) => new RegExp("(Help|Ayuda)").test(e.textContent)).map((e) => e.tagName + "|" + e.textContent.trim().slice(0, 30) + "|" + String(e.className).slice(0, 30)).slice(0, 8),
  anchoReal: innerWidth,
})`));
await p.tiro("movil-390");
nav.cierra();
