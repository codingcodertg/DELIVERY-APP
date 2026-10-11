// «Mi ruta» numerada por paradas (D-NEXT): entrar como chofer y fotografiar la lista.
import { abreChrome } from "./cdp.mjs";
const ANCHO = Number(process.env.ANCHO || 1440), ALTO = Number(process.env.ALTO || 900);
const nav = await abreChrome({ ancho: ANCHO, alto: ALTO });
const p = await nav.pagina("http://127.0.0.1:3917/my-route");
await p.espera(20000);
await p.evalua(`(() => {
  const s = [...document.querySelectorAll("select")].find((x) => [...x.options].some((o) => new RegExp("Admin").test(o.text)));
  const o = s && [...s.options].find((o) => new RegExp("Driver", "i").test(o.text));
  if (o) { s.value = o.value; s.dispatchEvent(new Event("change", { bubbles: true })); }
  return !!o;
})()`);
await p.espera(25000);
if (!new RegExp("my-route").test(await p.evalua("location.pathname"))) { await p.evalua(`(location.href = "/my-route", 1)`); await p.espera(20000); }
console.log(await p.evalua(`JSON.stringify({
  numeros: [...document.querySelectorAll("[data-numero-de-parada]")].map((e) => e.textContent.trim()),
  sigue: document.querySelectorAll("[data-sigue-la-parada]").length,
  pdSueltas: [...document.querySelectorAll(".bar-list *")].filter((e) => e.children.length === 0 && new RegExp("^[PD][0-9]+$").test(e.textContent.trim())).length,
})`));
await p.evalua(`(() => { const l = document.querySelector(".bar-list"); if (l) l.scrollIntoView({ block: "start" }); return !!l; })()`);
await p.espera(1200);
await p.tiro(`numeros-mi-ruta-${ANCHO}`);
nav.cierra();
