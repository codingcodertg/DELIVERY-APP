// La página del tracker, en un solo sitio.
//
// **La misma función pinta las dos versiones**: la que sirve `server.mjs` —que además deja escribir—
// y el fichero suelto que se abre con doble clic (`node tracker/cli.mjs html > tracker/informe.html`).
// Si fueran dos plantillas acabarían discrepando, y entonces el dueño vería una cosa en la pantalla
// y otra en el fichero que se guarda. Es el mismo motivo por el que el reparto de la cola de almacén
// devuelve las dos listas juntas.
//
// El HTML se escribe entero aquí, sin nada de fuera: ni tipografías, ni librerías, ni CDN. Un
// informe que necesita internet para pintarse no es un fichero que puedas guardar.

import { ESTADOS, HECHO, VERIFICACION, ZONA_NEGOCIO, diaLocal, todas } from "./tarea.mjs";

const REPO = "https://github.com/codingcodertg/DELIVERY-APP";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * @param {object} opciones
 * @param {boolean} opciones.editable  la servida deja cambiar estado y añadir notas; la suelta, no.
 * @param {Array}   opciones.tareas    por defecto, las del repo.
 */
export function informeHTML({ editable = false, tareas = todas() } = {}) {
  const datos = {
    tareas,
    estados: ESTADOS,
    hecho: HECHO,
    verificacion: VERIFICACION,
    zona: ZONA_NEGOCIO,
    repo: REPO,
    editable,
    generado: diaLocal(),
  };
  // `</script>` dentro de los datos cerraría la etiqueta antes de tiempo; pasa con cualquier texto
  // que hable de HTML, y el dueño pega de todo.
  const json = JSON.stringify(datos).replace(/<\//g, "<\\/");

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lo que he pedido</title>
<style>
  :root {
    --fondo: #f6f7f9; --papel: #fff; --texto: #1b1d21; --tenue: #667085; --borde: #e3e6ea;
    --acento: #2456c9; --ambar: #b86a1f; --verde: #1a7f4b; --rojo: #c33c3c;
  }
  @media (prefers-color-scheme: dark) {
    :root { --fondo: #15171b; --papel: #1d2026; --texto: #e8eaed; --tenue: #9aa1ab; --borde: #2c3038;
            --ambar: #d1782e; --verde: #34b978; --rojo: #e06666; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--fondo); color: var(--texto);
         font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .caja { max-width: 1180px; margin: 0 auto; padding: 22px 20px 60px; }
  h1 { font-size: 23px; margin: 0 0 4px; }
  .sub { color: var(--tenue); margin: 0 0 20px; }
  .tarjetas { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
  .tarjeta { background: var(--papel); border: 1px solid var(--borde); border-radius: 12px;
             padding: 10px 14px; cursor: pointer; min-width: 116px; }
  .tarjeta.on { border-color: var(--acento); box-shadow: 0 0 0 1px var(--acento) inset; }
  .tarjeta b { display: block; font-size: 23px; line-height: 1.15; }
  .tarjeta span { color: var(--tenue); font-size: 12.5px; }
  .grupo-titulo { color: var(--tenue); font-size: 12px; text-transform: uppercase;
                  letter-spacing: .06em; margin: 16px 0 6px; }
  .filtros { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 16px 0 6px; }
  input, select, button, textarea { font: inherit; color: inherit; background: var(--papel);
    border: 1px solid var(--borde); border-radius: 9px; padding: 7px 10px; }
  input[type=search] { min-width: 280px; }
  button { cursor: pointer; }
  button.primario { background: var(--acento); color: #fff; border-color: transparent; }
  .dia { margin: 22px 0 6px; font-weight: 700; }
  .dia span { color: var(--tenue); font-weight: 400; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; background: var(--papel);
          border: 1px solid var(--borde); border-radius: 12px; overflow: hidden; }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--borde); vertical-align: top; }
  th { color: var(--tenue); font-weight: 600; font-size: 11.5px; text-transform: uppercase; letter-spacing: .05em; }
  tr:last-child td { border-bottom: 0; }
  tr.fila { cursor: pointer; }
  tr.fila:hover td { background: color-mix(in srgb, var(--acento) 7%, transparent); }
  .pastilla { display: inline-block; padding: 1px 9px; border-radius: 999px; font-size: 12px;
              white-space: nowrap; border: 1px solid currentColor; }
  .gris { color: var(--tenue); border-color: var(--borde); }
  .azul { color: var(--acento); } .ambar { color: var(--ambar); }
  .verde { color: var(--verde); } .rojo { color: var(--rojo); }
  .hijo td:first-child { padding-left: 30px; }
  .cita { white-space: pre-wrap; background: var(--fondo); border: 1px solid var(--borde);
          border-radius: 10px; padding: 11px 13px; margin: 6px 0 16px; }
  .campo { display: grid; grid-template-columns: 150px 1fr; gap: 5px 14px; margin-bottom: 5px; }
  .campo b { color: var(--tenue); font-weight: 600; }
  a { color: var(--acento); }
  dialog { border: 1px solid var(--borde); border-radius: 14px; background: var(--papel);
           color: var(--texto); max-width: 820px; width: calc(100% - 28px); padding: 0; }
  dialog::backdrop { background: rgba(0,0,0,.5); }
  .cab { padding: 15px 20px; border-bottom: 1px solid var(--borde); display: flex;
         justify-content: space-between; gap: 12px; align-items: baseline; flex-wrap: wrap; }
  .cuerpo { padding: 16px 20px; max-height: 62vh; overflow: auto; }
  .acciones { padding: 13px 20px; border-top: 1px solid var(--borde); display: flex;
              gap: 8px; flex-wrap: wrap; align-items: center; }
  .notas li { margin-bottom: 7px; }
  .vacio { color: var(--tenue); padding: 30px; text-align: center; }
  .aviso { color: var(--rojo); }
  .pie { color: var(--tenue); font-size: 13px; margin-top: 34px; border-top: 1px solid var(--borde); padding-top: 14px; }
  @media print {
    .filtros, .tarjetas, .acciones { display: none; }
    body { background: #fff; } .caja { max-width: none; }
  }
</style>
</head>
<body>
<div class="caja">
  <h1>Lo que he pedido, y en qué quedó</h1>
  <p class="sub" id="sub"></p>

  <div class="tarjetas" id="tarjetas"></div>
  <div class="tarjetas" id="tarjetasV"></div>

  <div class="filtros">
    <input type="search" id="q" placeholder="Buscar por palabras…" autocomplete="off">
    <label>desde <input type="date" id="desde"></label>
    <label>hasta <input type="date" id="hasta"></label>
    <select id="hizo"><option value="">lo hizo Claude: todo</option></select>
    <button id="limpiar">Limpiar</button>
  </div>

  <main id="lista"></main>

  <p class="pie" id="pie"></p>
</div>

<dialog id="detalle"><form method="dialog" id="formDetalle"></form></dialog>

<script id="datos" type="application/json">${json}</script>
<script>
const D = JSON.parse(document.getElementById("datos").textContent);
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const diaLocal = (iso) => {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: D.zona, year: "numeric", month: "2-digit", day: "2-digit" })
      .format(new Date(iso));
  } catch { return String(iso).slice(0, 10); }
};

// Las mismas palabras del dueño para el estado, y un color por cada una.
const COLOR_ESTADO = { 0: "azul", 1: "ambar", 2: "gris", 3: "verde" };
const COLOR_VERIF = { "sin verificar": "gris", "verificado": "verde", "fallo": "rojo" };
const TEXTO_VERIF = { "sin verificar": "sin comprobar", "verificado": "comprobado", "fallo": "falló" };

let fEstado = "", fVerif = "", parecidos = null;

// Buscar por palabras, aquí mismo: el fichero suelto no tiene servidor al que preguntar.
const ACENTOS = new RegExp("[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]", "g");
const palabras = (t) => String(t ?? "").normalize("NFD").replace(ACENTOS, "").toLowerCase()
  .split(/[^a-z0-9#-]+/).filter((p) => p.length > 2);

function busca(q) {
  const qs = palabras(q);
  if (!qs.length) return null;
  const m = new Map();
  for (const t of D.tareas) {
    const bolsa = new Set(palabras([t.id, t.resumen, t.texto_original,
      (t.evidencia?.decisiones ?? []).join(" "), (t.notas ?? []).map((n) => n.texto).join(" ")].join(" ")));
    const comunes = [...new Set(qs.filter((p) => bolsa.has(p)))];
    if (comunes.length) m.set(t.id, { puntos: comunes.length / qs.length, comunes });
  }
  return m;
}

const verifDe = (t) => t.verificacion?.estado ?? "sin verificar";

function filtra() {
  const desde = $("#desde").value, hasta = $("#hasta").value, hizo = $("#hizo").value;
  return D.tareas.filter((t) => {
    if (fEstado && t.estado !== fEstado) return false;
    if (fVerif && verifDe(t) !== fVerif) return false;
    if (desde && t.fecha < desde) return false;
    if (hasta && t.fecha > hasta) return false;
    if (hizo && t.lo_hizo_claude !== hizo) return false;
    if (parecidos && !parecidos.has(t.id)) return false;
    return true;
  });
}

function pintaTarjetas() {
  const c = $("#tarjetas"); c.innerHTML = "";
  const hacer = (donde, etiqueta, n, valor, activo, alPulsar) => {
    const d = document.createElement("div");
    d.className = "tarjeta" + (activo ? " on" : "");
    d.innerHTML = "<b>" + n + "</b><span>" + esc(etiqueta) + "</span>";
    d.onclick = alPulsar;
    donde.append(d);
  };
  hacer(c, "todas", D.tareas.length, "", !fEstado, () => { fEstado = ""; pinta(); });
  for (const e of D.estados) {
    hacer(c, e, D.tareas.filter((t) => t.estado === e).length, e,
      fEstado === e, () => { fEstado = fEstado === e ? "" : e; pinta(); });
  }
  const v = $("#tarjetasV"); v.innerHTML = "";
  for (const k of D.verificacion) {
    hacer(v, "¿se comprobó? " + (TEXTO_VERIF[k] ?? k), D.tareas.filter((t) => verifDe(t) === k).length, k,
      fVerif === k, () => { fVerif = fVerif === k ? "" : k; pinta(); });
  }
}

function pinta() {
  pintaTarjetas();
  let l = filtra();
  if (parecidos) l = [...l].sort((a, b) => parecidos.get(b.id).puntos - parecidos.get(a.id).puntos);
  $("#sub").textContent = l.length === D.tareas.length
    ? D.tareas.length + " peticiones, de la más nueva a la más vieja."
    : l.length + " de " + D.tareas.length + " peticiones.";
  const main = $("#lista"); main.innerHTML = "";
  if (!l.length) { main.innerHTML = '<div class="vacio">Nada con esos filtros.</div>'; return; }

  const grupos = new Map();
  for (const t of l) {
    const clave = parecidos ? "Lo que más se parece" : t.fecha;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(t);
  }
  const claves = parecidos ? [...grupos.keys()] : [...grupos.keys()].sort().reverse();

  for (const clave of claves) {
    const h = document.createElement("div");
    h.className = "dia";
    h.innerHTML = esc(clave) + ' <span>· ' + grupos.get(clave).length + "</span>";
    main.append(h);
    const tabla = document.createElement("table");
    tabla.innerHTML = "<thead><tr><th style='width:86px'>Nº</th><th style='width:205px'>Estado</th>"
      + "<th style='width:135px'>¿Se comprobó?</th><th>Qué pedí</th></tr></thead>";
    const tb = document.createElement("tbody");
    for (const t of grupos.get(clave)) {
      const tr = document.createElement("tr");
      tr.className = "fila" + (t.padre ? " hijo" : "");
      const p = parecidos?.get(t.id);
      const iv = verifDe(t);
      tr.innerHTML = "<td>" + esc(t.id) + (t.padre ? "<br><span class='pastilla gris'>de " + esc(t.padre) + "</span>" : "") + "</td>"
        + "<td><span class='pastilla " + (COLOR_ESTADO[D.estados.indexOf(t.estado)] ?? "gris") + "'>" + esc(t.estado) + "</span></td>"
        + "<td><span class='pastilla " + (COLOR_VERIF[iv] ?? "gris") + "'>" + esc(TEXTO_VERIF[iv] ?? iv) + "</span></td>"
        + "<td>" + esc(t.resumen)
        + (p ? "<div class='pastilla gris' style='margin-top:4px'>coincide en: " + esc(p.comunes.join(", ")) + "</div>" : "")
        + "</td>";
      tr.onclick = () => abre(t.id);
      tb.append(tr);
    }
    tabla.append(tb);
    main.append(tabla);
  }
}

function enlaces(t) {
  const ev = t.evidencia ?? {};
  const fila = (k, html) => html ? "<div class='campo'><b>" + k + "</b><span>" + html + "</span></div>" : "";
  const prs = (ev.prs ?? []).map((n) => "<a href='" + D.repo + "/pull/" + esc(n) + "' target='_blank' rel='noreferrer'>#" + esc(n) + "</a>").join(" · ");
  const commits = (ev.commits ?? []).map((c) => "<a href='" + D.repo + "/commit/" + esc(c) + "' target='_blank' rel='noreferrer'><code>" + esc(c) + "</code></a>").join(" · ");
  return fila("decisión", (ev.decisiones ?? []).map(esc).join(", "))
    + fila("pull request", prs)
    + fila("commit", commits)
    + fila("ficheros", (ev.ficheros ?? []).map(esc).join(", "))
    + fila("enlaces", (ev.links ?? []).map((u) => "<a href='" + esc(u) + "' target='_blank' rel='noreferrer'>" + esc(u) + "</a>").join(" · "))
    + fila("de dónde salió", (t.fuentes ?? []).map(esc).join("<br>"));
}

function abre(id) {
  const t = D.tareas.find((x) => x.id === id);
  if (!t) return;
  const hijas = D.tareas.filter((x) => x.padre === t.id);
  const v = t.verificacion ?? {};
  const iv = verifDe(t);

  $("#formDetalle").innerHTML =
    "<div class='cab'><b>" + esc(t.id) + " · " + esc(t.fecha) + "</b>"
    + "<span><span class='pastilla " + (COLOR_ESTADO[D.estados.indexOf(t.estado)] ?? "gris") + "'>" + esc(t.estado) + "</span> "
    + "<span class='pastilla " + (COLOR_VERIF[iv] ?? "gris") + "'>" + esc(TEXTO_VERIF[iv] ?? iv) + "</span></span></div>"
    + "<div class='cuerpo'>"
    + "<p>" + esc(t.resumen) + "</p>"
    + (t.texto_original ? "<b style='color:var(--tenue);font-size:13px'>Con mis palabras</b><div class='cita'>" + esc(t.texto_original) + "</div>" : "")
    + "<div class='campo'><b>¿lo hizo Claude?</b><span>" + esc(t.lo_hizo_claude) + "</span></div>"
    + "<div class='campo'><b>¿se comprobó?</b><span>" + esc(TEXTO_VERIF[iv] ?? iv)
      + (v.prueba ? " — " + esc(v.prueba) : "")
      + (v.fecha ? " (" + esc(diaLocal(v.fecha)) + ")" : "") + "</span></div>"
    + (t.padre ? "<div class='campo'><b>parte de</b><span>" + esc(t.padre) + "</span></div>" : "")
    + (hijas.length ? "<div class='campo'><b>se partió en</b><span>" + hijas.map((x) => esc(x.id)).join(", ") + "</span></div>" : "")
    + enlaces(t)
    + (t.notas?.length ? "<b style='color:var(--tenue);font-size:13px'>Notas</b><ul class='notas'>"
        + t.notas.map((n) => "<li>[" + esc(diaLocal(n.fecha)) + "] " + esc(n.texto) + "</li>").join("") + "</ul>" : "")
    + "</div>"
    + (D.editable
      ? "<div class='acciones'>"
        + "<select id='nuevoEstado'>" + D.estados.map((e) => "<option" + (e === t.estado ? " selected" : "") + ">" + esc(e) + "</option>").join("") + "</select>"
        + "<select id='nuevaVerif'>" + D.verificacion.map((k) => "<option value='" + esc(k) + "'" + (k === iv ? " selected" : "") + ">¿se comprobó? " + esc(TEXTO_VERIF[k] ?? k) + "</option>").join("") + "</select>"
        + "<input id='nuevaNota' placeholder='Añadir una nota…' style='flex:1;min-width:200px'>"
        + "<label><input type='checkbox' id='confirmado'> lo confirmo yo</label>"
        + "<button type='button' class='primario' id='guardar'>Guardar</button>"
        + "<button value='cerrar'>Cerrar</button><span id='error' class='aviso'></span></div>"
      : "<div class='acciones'><button value='cerrar'>Cerrar</button></div>");

  if (D.editable) {
    $("#guardar").onclick = async () => {
      const cuerpo = {
        estado: $("#nuevoEstado").value,
        nota: $("#nuevaNota").value,
        confirmadoPorElDueno: $("#confirmado").checked,
      };
      const verif = $("#nuevaVerif").value;
      if (verif !== iv) { cuerpo.verificacion = verif; cuerpo.prueba = $("#nuevaNota").value; }
      const r = await fetch("/api/tarea/" + encodeURIComponent(t.id), {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo),
      });
      const d = await r.json();
      if (!r.ok) { $("#error").textContent = d.error ?? "no se pudo guardar"; return; }
      Object.assign(t, d.tarea);
      $("#detalle").close();
      pinta();
    };
  }
  $("#detalle").showModal();
}

let temporizador;
$("#q").oninput = () => {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => { parecidos = busca($("#q").value.trim()); pinta(); }, 140);
};
for (const id of ["#desde", "#hasta", "#hizo"]) $(id).onchange = pinta;
$("#limpiar").onclick = () => {
  $("#q").value = ""; $("#desde").value = ""; $("#hasta").value = ""; $("#hizo").value = "";
  fEstado = ""; fVerif = ""; parecidos = null; pinta();
};
for (const h of D.hecho) $("#hizo").add(new Option("lo hizo Claude: " + h, h));
$("#pie").textContent = "Generado el " + D.generado + " desde el repositorio."
  + (D.editable ? "" : " Este fichero es una foto: para cambiar algo, abre el tracker con «npm run tracker».");
pinta();
</script>
</body>
</html>
`;
}
