// La página en vivo: entra con el usuario del RTG, lee de la base, y cierra una tarea de UN CLIC.
//
// El dueño: *«si yo le doy a comprobar que se cambie sin pedir diálogo»*. Así que el botón no
// pregunta nada: cambia, se ve al instante, y se deshace con otro clic.
//
// **Es un fichero, no una ruta del hub.** Él lo dijo: *«no no físico en el app pero sí en el mismo de
// rtg»* — los datos en la base del RTG, la página fuera de la app.
//
// ### Qué lleva dentro y qué no
//
// Lleva la **URL** del proyecto y la **anon key**, que son públicas por diseño: sin sesión no abren
// nada, porque la RLS de la 144 solo deja leer al admin. **Nunca la llave de service-role**, y hay
// una prueba que falla si aparece.
//
// **No lleva ni una tarea dentro.** Las pide al abrirse, con la sesión de quien mira. Esto importa
// más de lo que parece: es lo que permite subir el fichero a un bucket público sin publicar de paso
// todo lo que el dueño ha pedido en dos meses.

const CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * @param {object} o
 * @param {string} o.url       NEXT_PUBLIC_SUPABASE_URL
 * @param {string} o.anonKey   la anon key, pública
 * @param {string} o.repo      para los enlaces a commits y PR
 */
export function paginaEnVivoHTML({ url, anonKey, repo = "https://github.com/codingcodertg/DELIVERY-APP" }) {
  if (!url || !anonKey) throw new Error("la página necesita la URL y la anon key");
  // Un despiste que valdría caro: si alguien pasa aquí la llave de servicio, se para.
  if (/service_role/.test(anonKey)) throw new Error("eso es una llave de service-role: NO va en la página");

  const cfg = JSON.stringify({ url, anonKey, repo }).replace(/<\//g, "<\\/");

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lo que he pedido</title>
<style>
  :root { --fondo:#f6f7f9; --papel:#fff; --texto:#1b1d21; --tenue:#667085; --borde:#e3e6ea;
          --acento:#2456c9; --ambar:#b86a1f; --verde:#1a7f4b; --rojo:#c33c3c; }
  @media (prefers-color-scheme: dark) {
    :root { --fondo:#15171b; --papel:#1d2026; --texto:#e8eaed; --tenue:#9aa1ab; --borde:#2c3038;
            --ambar:#d1782e; --verde:#34b978; --rojo:#e06666; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--fondo); color:var(--texto);
         font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif; }
  .caja { max-width:1100px; margin:0 auto; padding:22px 18px 70px; }
  h1 { font-size:24px; margin:0 0 4px; }
  .sub { color:var(--tenue); margin:0 0 18px; }
  input, select, button { font:inherit; color:inherit; background:var(--papel);
    border:1px solid var(--borde); border-radius:10px; padding:9px 12px; }
  button { cursor:pointer; }
  button.primario { background:var(--acento); color:#fff; border-color:transparent; }
  button.hecho { background:var(--verde); color:#fff; border-color:transparent; }
  .filtros { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:14px 0; }
  input[type=search] { min-width:260px; flex:1; }
  .tarjetas { display:flex; gap:9px; flex-wrap:wrap; }
  .tarjeta { background:var(--papel); border:1px solid var(--borde); border-radius:12px;
             padding:9px 13px; cursor:pointer; min-width:108px; }
  .tarjeta.on { border-color:var(--acento); box-shadow:0 0 0 1px var(--acento) inset; }
  .tarjeta b { display:block; font-size:22px; } .tarjeta span { color:var(--tenue); font-size:12.5px; }
  .dia { margin:20px 0 6px; font-weight:700; } .dia span { color:var(--tenue); font-weight:400; font-size:13px; }
  .tarea { background:var(--papel); border:1px solid var(--borde); border-radius:12px;
           padding:13px 15px; margin-bottom:9px; display:flex; gap:14px; align-items:flex-start; }
  .tarea .cuerpo { flex:1; min-width:0; }
  .tarea .id { color:var(--tenue); font-size:13px; }
  .pastilla { display:inline-block; padding:1px 9px; border-radius:999px; font-size:12.5px;
              border:1px solid currentColor; white-space:nowrap; }
  .gris { color:var(--tenue); border-color:var(--borde); } .azul { color:var(--acento); }
  .ambar { color:var(--ambar); } .verde { color:var(--verde); } .rojo { color:var(--rojo); }
  .cita { white-space:pre-wrap; background:var(--fondo); border:1px solid var(--borde);
          border-radius:9px; padding:9px 11px; margin:8px 0 0; font-size:14.5px; }
  .enlaces { margin-top:7px; font-size:14px; } a { color:var(--acento); }
  .entrar { max-width:340px; margin:70px auto; display:grid; gap:10px; }
  .vacio, .cargando { color:var(--tenue); padding:26px; text-align:center; }
  .error { color:var(--rojo); }
  .barra { position:sticky; top:0; background:var(--fondo); padding:10px 0; z-index:5;
           border-bottom:1px solid var(--borde); margin-bottom:6px; }
  details summary { cursor:pointer; color:var(--tenue); font-size:14px; margin-top:7px; }
</style>
</head>
<body>
<div class="caja">
  <div id="app"><div class="cargando">Cargando…</div></div>
</div>

<script id="cfg" type="application/json">${cfg}</script>
<script type="module">
const CFG = JSON.parse(document.getElementById("cfg").textContent);
const { createClient } = await import("${CDN}");
const sb = createClient(CFG.url, CFG.anonKey);

const $ = (s, d = document) => d.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const ESTADOS = ["En revisi\\u00f3n \\u2013 desplegado", "En revisi\\u00f3n \\u2013 no desplegado", "Ocupa revisi\\u00f3n", "Completado"];
const COLOR = ["azul", "ambar", "gris", "verde"];
const TEXTO_VERIF = { "sin verificar": "sin comprobar", "verificado": "comprobado", "fallo": "fall\\u00f3" };

let TAREAS = [], fEstado = "", q = "";

// ---------------------------------------------------------------- entrar
function pintaEntrar(error) {
  $("#app").innerHTML =
    '<div class="entrar"><h1>Lo que he pedido</h1>'
    + '<p class="sub">Entra con tu usuario del RTG.</p>'
    + '<input id="correo" type="email" placeholder="correo" autocomplete="username">'
    + '<input id="clave" type="password" placeholder="contrase\\u00f1a" autocomplete="current-password">'
    + '<button class="primario" id="btnEntrar">Entrar</button>'
    + (error ? '<p class="error">' + esc(error) + "</p>" : "")
    + "</div>";
  const entrar = async () => {
    $("#btnEntrar").disabled = true;
    const { error: e } = await sb.auth.signInWithPassword({
      email: $("#correo").value.trim(), password: $("#clave").value,
    });
    if (e) return pintaEntrar(e.message);
    arranca();
  };
  $("#btnEntrar").onclick = entrar;
  $("#clave").onkeydown = (ev) => { if (ev.key === "Enter") entrar(); };
}

// ---------------------------------------------------------------- pintar
function cuenta(estado) { return TAREAS.filter((t) => t.estado === estado).length; }

function filtra() {
  const palabras = q.toLowerCase().split(/\\s+/).filter((p) => p.length > 2);
  return TAREAS.filter((t) => {
    if (fEstado && t.estado !== fEstado) return false;
    if (!palabras.length) return true;
    const bolsa = (t.id + " " + t.resumen + " " + (t.texto_original ?? "")).toLowerCase();
    return palabras.every((p) => bolsa.includes(p));
  });
}

function pinta() {
  const l = filtra();
  const tarjeta = (etiqueta, n, valor) =>
    '<div class="tarjeta' + (fEstado === valor ? " on" : "") + '" data-estado="' + esc(valor) + '">'
    + "<b>" + n + "</b><span>" + esc(etiqueta) + "</span></div>";

  $("#app").innerHTML =
    "<h1>Lo que he pedido, y en qu\\u00e9 qued\\u00f3</h1>"
    + '<p class="sub">' + l.length + " de " + TAREAS.length + " \\u00b7 <a href='#' id='salir'>salir</a></p>"
    + '<div class="barra"><div class="tarjetas">'
    + tarjeta("todas", TAREAS.length, "")
    + ESTADOS.map((e) => tarjeta(e, cuenta(e), e)).join("")
    + '</div><div class="filtros"><input type="search" id="q" placeholder="Buscar\\u2026" value="' + esc(q) + '"></div></div>'
    + '<div id="lista"></div>';

  for (const c of document.querySelectorAll(".tarjeta")) {
    c.onclick = () => { fEstado = fEstado === c.dataset.estado ? "" : c.dataset.estado; pinta(); };
  }
  $("#q").oninput = (e) => { q = e.target.value; pintaLista(); };
  $("#salir").onclick = async (e) => { e.preventDefault(); await sb.auth.signOut(); pintaEntrar(); };
  pintaLista();
}

function pintaLista() {
  const l = filtra();
  const cont = $("#lista");
  if (!l.length) { cont.innerHTML = '<div class="vacio">Nada con esos filtros.</div>'; return; }
  const grupos = new Map();
  for (const t of l) { if (!grupos.has(t.fecha)) grupos.set(t.fecha, []); grupos.get(t.fecha).push(t); }

  cont.innerHTML = [...grupos.keys()].sort().reverse().map((f) =>
    '<div class="dia">' + esc(f) + " <span>\\u00b7 " + grupos.get(f).length + "</span></div>"
    + grupos.get(f).map(pintaTarea).join("")).join("");

  for (const b of document.querySelectorAll("[data-cerrar]")) {
    b.onclick = () => cambia(b.dataset.cerrar, b.dataset.a);
  }
}

function pintaTarea(t) {
  const i = ESTADOS.indexOf(t.estado);
  const v = t.verificacion?.estado ?? "sin verificar";
  const ev = t.evidencia ?? {};
  const cerrada = t.estado === "Completado";
  const enlaces = [
    ...(ev.decisiones ?? []).map((d) => esc(d)),
    ...(ev.prs ?? []).map((n) => "<a href='" + CFG.repo + "/pull/" + esc(n) + "' target='_blank' rel='noreferrer'>PR #" + esc(n) + "</a>"),
    ...(ev.commits ?? []).map((c) => "<a href='" + CFG.repo + "/commit/" + esc(c) + "' target='_blank' rel='noreferrer'>" + esc(c) + "</a>"),
  ].join(" \\u00b7 ");

  return '<div class="tarea" id="t-' + esc(t.id) + '">'
    + '<div class="cuerpo">'
    + '<div class="id">' + esc(t.id) + " \\u00b7 " + esc(t.fecha)
    + ' <span class="pastilla ' + (COLOR[i] ?? "gris") + '">' + esc(t.estado) + "</span>"
    + ' <span class="pastilla ' + (v === "verificado" ? "verde" : v === "fallo" ? "rojo" : "gris") + '">'
    + esc(TEXTO_VERIF[v] ?? v) + "</span></div>"
    + "<div>" + esc(t.resumen) + "</div>"
    + (t.texto_original ? "<details><summary>con mis palabras</summary><div class='cita'>" + esc(t.texto_original) + "</div></details>" : "")
    + (enlaces ? '<div class="enlaces">' + enlaces + "</div>" : "")
    + "</div>"
    // UN clic, sin diálogo, y el mismo botón deshace.
    + "<button class='" + (cerrada ? "hecho" : "") + "' data-cerrar='" + esc(t.id) + "'"
    + " data-a='" + (cerrada ? "Ocupa revisi\\u00f3n" : "Completado") + "'>"
    + (cerrada ? "\\u2713 Completado" : "Marcar completado") + "</button>"
    + "</div>";
}

// ---------------------------------------------------------------- cambiar
//
// Optimista: se pinta antes de que conteste la base, porque él pidió que cambie sin diálogo y una
// espera de medio segundo con el botón muerto se siente como que no funcionó. Si la base dice que
// no, se revierte y se dice por qué — no se deja el número bonito mintiendo.
async function cambia(id, nuevo) {
  const t = TAREAS.find((x) => x.id === id);
  if (!t) return;
  const antes = t.estado;
  t.estado = nuevo;
  pintaLista();

  const { data, error } = await sb.from("tracker_tareas")
    .update({ estado: nuevo }).eq("id", id).select("id, estado, completado_por, completado_en");

  if (error || !data?.length) {
    t.estado = antes;
    pintaLista();
    const fila = $("#t-" + CSS.escape(id));
    const aviso = document.createElement("div");
    aviso.className = "error";
    // Un "data" vacío SIN error es la RLS: el UPDATE no encontró ninguna fila suya que tocar. Un
    // update rechazado por RLS vuelve LIMPIO y sin filas, y leerlo como «guardado» es el fallo.
    // (Sin acento grave en este comentario: vive dentro de una plantilla y la cerraría.)
    aviso.textContent = error ? error.message : "No se pudo: tu sesi\\u00f3n no tiene permiso para cambiarla.";
    fila?.append(aviso);
    return;
  }
  Object.assign(t, data[0]);
  pintaLista();
}

// ---------------------------------------------------------------- arranque
async function arranca() {
  $("#app").innerHTML = '<div class="cargando">Cargando\\u2026</div>';
  const { data, error } = await sb.from("tracker_tareas").select("*");
  if (error) return pintaEntrar("No se pudo leer: " + error.message);
  TAREAS = (data ?? []).sort((a, b) => (a.fecha === b.fecha ? a.id.localeCompare(b.id) : b.fecha.localeCompare(a.fecha)));
  if (!TAREAS.length) {
    $("#app").innerHTML = '<div class="vacio">Tu sesi\\u00f3n no ve ninguna tarea.'
      + " Esta p\\u00e1gina es solo para el administrador."
      + " <a href='#' id='salir2'>salir</a></div>";
    $("#salir2").onclick = async (e) => { e.preventDefault(); await sb.auth.signOut(); pintaEntrar(); };
    return;
  }
  pinta();
}

const { data: sesion } = await sb.auth.getSession();
if (sesion?.session) arranca(); else pintaEntrar();
</script>
</body>
</html>
`;
}

export { esc };
