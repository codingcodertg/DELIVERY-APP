// «Mi ruta» con el mapa del Gestor (D-NEXT): entrar como chofer en el demo, mirar el mapa, tocar una parada.
import { abreChrome } from "./cdp.mjs";
const ANCHO = Number(process.env.ANCHO || 1440), ALTO = Number(process.env.ALTO || 900);
const nav = await abreChrome({ ancho: ANCHO, alto: ALTO });
const p = await nav.pagina("http://127.0.0.1:3917/my-route");
await p.espera(Number(process.env.ESPERA_INICIAL || 20000));

// «Ver como»: las opciones del selector del demo, y elegir un chofer.
const opciones = await p.evalua(`JSON.stringify([...document.querySelectorAll("select")].map((s) => [...s.options].map((o) => o.value + "=" + o.text.trim())).filter((l) => l.some((x) => new RegExp("Admin").test(x)))[0] || [])`);
console.log("opciones de Ver como:", opciones);
const elegido = await p.evalua(`(() => {
  const s = [...document.querySelectorAll("select")].find((x) => [...x.options].some((o) => new RegExp("Admin").test(o.text)));
  if (!s) return "sin selector";
  const o = [...s.options].find((o) => new RegExp("Carlos|Driver|Chofer", "i").test(o.text));
  if (!o) return "sin opcion de chofer";
  s.value = o.value; s.dispatchEvent(new Event("change", { bubbles: true }));
  return o.text.trim();
})()`);
console.log("ver como:", elegido);
await p.espera(Number(process.env.ESPERA_CAMBIO || 12000));
if (!new RegExp("my-route").test(await p.evalua("location.pathname"))) { await p.evalua(`(location.href = "/my-route", 1)`); await p.espera(15000); }

const r = await p.evalua(`JSON.stringify({
  ruta: location.pathname,
  titulo: (document.querySelector(".page-head h2") || {}).textContent,
  mapaDelGestor: document.querySelectorAll("[data-mapa-del-gestor]").length,
  mapasLeaflet: document.querySelectorAll(".leaflet-container").length,
  marcas: document.querySelectorAll(".leaflet-marker-icon").length,
  lineas: document.querySelectorAll(".leaflet-overlay-pane path").length,
  leyenda: !!document.querySelector("[data-mapa-del-gestor] .map-legend, [data-mapa-del-gestor] [data-leyenda], [data-mapa-del-gestor] [class*=legend]"),
  textoLeyenda: ((document.querySelector("[data-mapa-del-gestor]") || {}).innerText || "").slice(0, 160),
  tuRuta: [...document.querySelectorAll(".section-label")].map((e) => e.textContent.trim()).filter((x) => new RegExp("route|ruta", "i").test(x)).slice(0, 2),
})`);
console.log(r);
await p.tiro(`mi-ruta-${ANCHO}`);

// Tocar una parada del mapa: traerla a la vista y pulsar. Debe abrir su orden.
const toque = await p.evalua(`(async () => {
  const todas = [...document.querySelectorAll("[data-mapa-del-gestor] .leaflet-marker-icon")]; const m = todas.find((e) => !(e.textContent || "").trim() && !e.querySelector("svg")) || todas.find((e) => /^[0-9]+$/.test((e.textContent || "").trim()));
  if (!m) return "sin parada en el mapa";
  m.scrollIntoView({ block: "center" });
  await new Promise((ok) => setTimeout(ok, 600));
  const antes = document.querySelectorAll(".overlay").length;
  m.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((ok) => setTimeout(ok, 2500));
  return "parada [" + (m.textContent || "").trim() + "] " + String(m.className).slice(0, 40) + " · overlays antes " + antes + " despues " + document.querySelectorAll(".overlay").length;
})()`);
console.log("toque:", toque);
await p.tiro(`mi-ruta-toque-${ANCHO}`);
nav.cierra();
