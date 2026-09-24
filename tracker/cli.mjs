#!/usr/bin/env node
// El tracker por línea de órdenes: add, update, search, show, list.
//
//   node tracker/cli.mjs add --resumen "..." [--texto "..."] [--fecha 2026-09-23] ...
//   node tracker/cli.mjs update T-0001 --estado "en revision - desplegado" --nota "..."
//   node tracker/cli.mjs search "almacen recepcion"
//   node tracker/cli.mjs show T-0001
//   node tracker/cli.mjs list [--estado ...] [--desde ...] [--hasta ...] [--contar]
//
// Todo lleva `--json` para que otro programa lo lea sin parsear texto para humanos.

import { readFileSync } from "node:fs";
import { informeHTML } from "./informe.mjs";
import { paginaEnVivoHTML } from "./pagina-en-vivo.mjs";
import {
  ESTADOS, ESTADO_FINAL, HECHO, VERIFICACION, ahoraLocal, busca, diaLocal, normalizaEstado,
  normalizaVerificacion, tapaSecretos, tareaNueva, valida,
} from "./tarea.mjs";
// **La base manda desde la 144.** Leer sin ella funciona y avisa; escribir sin ella falla
// diciendolo. Ver `fuente.mjs` y `tareas/LEEME.md`.
import { exigeBase, guarda, hayBase, lee, leeTodas, porQueNoHayBase, siguienteId } from "./fuente.mjs";

// ---------------------------------------------------------------- argumentos

/** Banderas repetibles: `--commit a --commit b` da las dos, no la ultima. */
const REPETIBLES = new Set(["commit", "pr", "fichero", "decision", "link", "fuente", "nota", "estado-lista"]);

function lee_argv(argv) {
  const sueltos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { sueltos.push(a); continue; }
    const nombre = a.slice(2);
    const valor = argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    if (REPETIBLES.has(nombre)) (flags[nombre] ??= []).push(valor);
    else flags[nombre] = valor;
  }
  return { sueltos, flags };
}

const { sueltos, flags } = lee_argv(process.argv.slice(2));
const orden = sueltos[0];
const salidaJSON = flags.json === true;

function muere(msg, codigo = 2) {
  console.error(msg);
  process.exit(codigo);
}

// ---------------------------------------------------------------- pintar

const ANCHO = 100;
const corta = (s, n) => (s.length <= n ? s : s.slice(0, n - 1) + String.fromCharCode(0x2026));

function pintaFila(t) {
  const hijo = t.padre ? "  " + String.fromCharCode(0x21b3) + " " : "";
  return [
    t.id.padEnd(7),
    t.fecha,
    t.lo_hizo_claude.padEnd(7),
    t.estado.padEnd(27),
    hijo + corta(t.resumen.split("\n")[0], ANCHO),
  ].join("  ");
}

// Las tareas de esta corrida, leidas una sola vez. `pintaDetalle` las necesita para las subtareas
// y no puede ser asincrona sin arrastrar a todo lo demas.
let CACHE = null;

function pintaDetalle(t) {
  const l = [];
  l.push(t.id + "  " + String.fromCharCode(0x00b7) + "  " + t.fecha + "  " + String.fromCharCode(0x00b7) + "  " + t.estado);
  if (t.padre) l.push("subtarea de: " + t.padre);
  l.push("");
  l.push(t.resumen);
  if (t.texto_original) {
    l.push("");
    l.push("--- lo que pidió, literal -------------------------------------------------");
    l.push(t.texto_original);
    l.push("---------------------------------------------------------------------------");
  }
  l.push("");
  l.push("lo hizo Claude: " + t.lo_hizo_claude);
  const v = t.verificacion ?? {};
  l.push("¿se comprobó?: " + (v.estado ?? "sin verificar")
    + (v.prueba ? "  — " + v.prueba : "")
    + (v.fecha ? "  (" + diaLocal(v.fecha) + ")" : ""));
  const e = t.evidencia ?? {};
  for (const [k, v] of Object.entries(e)) if (v?.length) l.push(k + ": " + v.join(", "));
  const hijas = (CACHE ?? []).filter((x) => x.padre === t.id);
  if (hijas.length) l.push("subtareas: " + hijas.map((x) => x.id).join(", "));
  if (t.fuentes?.length) l.push("de dónde salió: " + t.fuentes.join(", "));
  if (t.notas?.length) {
    l.push("");
    l.push("notas:");
    for (const n of t.notas) l.push("  [" + diaLocal(n.fecha) + "] " + n.texto);
  }
  return l.join("\n");
}

// ---------------------------------------------------------------- recoger campos

function evidenciaDe(f) {
  return {
    commits: f.commit ?? [],
    prs: (f.pr ?? []).map(String),
    ficheros: f.fichero ?? [],
    decisiones: f.decision ?? [],
    links: f.link ?? [],
  };
}

/** El texto original puede venir en la bandera o en un fichero: un mensaje largo del dueno no cabe
 *  comodo en una linea de ordenes, y pegarlo a trozos lo rompe. */
function textoDe(f) {
  if (f["texto-de"]) return readFileSync(f["texto-de"], "utf8");
  return typeof f.texto === "string" ? f.texto : "";
}

/**
 * Dice de donde salen los datos cuando NO salen de la base.
 *
 * Por la salida de error, para que `cli.mjs html > informe.html` no meta el aviso dentro del
 * fichero. Y se dice siempre: una lista de la copia congelada puede tener dias de retraso, y
 * ensenarla como si fuera la de hoy es lo que hace que alguien discuta con un numero que ya no
 * existe.
 */
function avisaDelOrigen(origen, aviso) {
  if (origen === "la base") return;
  console.error("aviso: leyendo la COPIA CONGELADA de tracker/tareas/, no la base.");
  console.error("  " + aviso.split("\n").join("\n  "));
}

function avisaDeLoTapado(tapados, donde) {
  if (tapados.length) console.error("aviso: se tapó " + tapados.join(", ") + " en " + donde + " antes de escribirlo al repo");
}

// ---------------------------------------------------------------- ordenes

async function cmd_add() {
  exigeBase();
  if (!flags.resumen || flags.resumen === true) muere("add necesita --resumen \"...\"");
  const estado = flags.estado ? normalizaEstado(flags.estado) : undefined;
  if (flags.estado && !estado) muere("estado desconocido. Los que hay:\n  " + ESTADOS.join("\n  "));
  if (estado === ESTADO_FINAL && !flags["confirmado-por-el-dueno"]) {
    muere("«" + ESTADO_FINAL + "» solo lo pone el dueño: añade --confirmado-por-el-dueno y una --nota que diga cuándo lo dijo.");
  }
  const hecho = flags.hizo && flags.hizo !== true ? flags.hizo : undefined;
  if (hecho && !HECHO.includes(hecho)) muere("--hizo tiene que ser uno de: " + HECHO.join(", "));

  const resumen = tapaSecretos(String(flags.resumen));
  const texto = tapaSecretos(textoDe(flags));
  avisaDeLoTapado([...resumen.tapados, ...texto.tapados], "lo que se iba a guardar");

  const t = tareaNueva({
    id: await siguienteId(),
    fecha: flags.fecha && flags.fecha !== true ? flags.fecha : undefined,
    resumen: resumen.texto,
    texto_original: texto.texto,
    lo_hizo_claude: hecho,
    estado,
    padre: flags.padre && flags.padre !== true ? flags.padre : null,
    evidencia: evidenciaDe(flags),
    notas: (flags.nota ?? []).map((n) => ({ fecha: ahoraLocal(), texto: tapaSecretos(n).texto })),
    fuentes: flags.fuente ?? [],
  });
  if (t.padre && !(await lee(t.padre))) muere("la tarea madre " + t.padre + " no existe");
  const problemas = valida(t);
  if (problemas.length) muere("tarea invalida: " + problemas.join("; "));
  await guarda(t);
  if (salidaJSON) console.log(JSON.stringify(t, null, 2));
  else console.log("creada " + t.id + "  " + t.fecha + "  " + t.estado + "\n  " + t.resumen);
}

async function cmd_update() {
  exigeBase();
  const id = sueltos[1];
  if (!id) muere("update necesita el id: node tracker/cli.mjs update T-0001 --estado ...");
  const t = await lee(id);
  if (!t) muere("no existe " + id);

  let cambios = 0;
  if (flags.estado && flags.estado !== true) {
    const e = normalizaEstado(flags.estado);
    if (!e) muere("estado desconocido. Los que hay:\n  " + ESTADOS.join("\n  "));
    // La regla del dueno, en el unico sitio por el que se puede escribir este estado.
    if (e === ESTADO_FINAL && !flags["confirmado-por-el-dueno"]) {
      muere("«" + ESTADO_FINAL + "» solo lo pone el dueño.\n"
        + "  Si lo confirmó, repite con --confirmado-por-el-dueno y una --nota que diga cuándo y dónde lo dijo.");
    }
    if (e === ESTADO_FINAL && !(flags.nota ?? []).length) {
      muere("para cerrar una tarea hace falta además una --nota diciendo cuándo y dónde lo confirmó.");
    }
    t.estado = e; cambios++;
  }
  if (flags.hizo && flags.hizo !== true) {
    if (!HECHO.includes(flags.hizo)) muere("--hizo tiene que ser uno de: " + HECHO.join(", "));
    t.lo_hizo_claude = flags.hizo; cambios++;
  }
  if (flags.resumen && flags.resumen !== true) { t.resumen = tapaSecretos(String(flags.resumen)).texto; cambios++; }
  if (flags.fecha && flags.fecha !== true) {
    // `fecha` es **cuándo lo pidió el dueño**, y se equivoca con facilidad: es tentador poner la del
    // commit, la de la fila de un espejo o la del día en que uno se entera. Se puede corregir desde
    // aquí, y no editando el JSON a mano, para que el cambio pase por la validación y se note.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(flags.fecha)) muere("--fecha tiene que ser YYYY-MM-DD");
    t.fecha = flags.fecha; cambios++;
  }
  if (flags.padre && flags.padre !== true) {
    if (!(await lee(flags.padre))) muere("la tarea madre " + flags.padre + " no existe");
    t.padre = flags.padre; cambios++;
  }
  if (flags["sin-padre"]) { t.padre = null; cambios++; }
  if (flags.verificacion && flags.verificacion !== true) {
    const v = normalizaVerificacion(flags.verificacion);
    if (!v) muere("--verificacion tiene que ser uno de: " + VERIFICACION.join(", "));
    // La prueba es obligatoria salvo para volver a «sin verificar»: un «verificado» sin decir
    // quién lo midió, cuándo y cómo es peor que no afirmar nada, porque se cree.
    const prueba = flags.prueba && flags.prueba !== true ? String(flags.prueba) : "";
    if (v !== VERIFICACION[0] && !prueba.trim()) {
      muere("para marcar «" + v + "» hace falta --prueba con quién lo midió, cuándo y cómo");
    }
    t.verificacion = { estado: v, prueba: tapaSecretos(prueba).texto, fecha: v === VERIFICACION[0] ? null : ahoraLocal() };
    cambios++;
  }

  const nueva = evidenciaDe(flags);
  for (const k of Object.keys(nueva)) {
    if (!nueva[k].length) continue;
    // La evidencia SUMA: se anade, no se reemplaza. Una tarea que se retoca tres veces tiene que
    // acabar con los tres commits, no con el ultimo.
    t.evidencia[k] = [...new Set([...(t.evidencia[k] ?? []), ...nueva[k]])];
    cambios++;
  }
  for (const n of flags.nota ?? []) {
    const { texto, tapados } = tapaSecretos(n);
    avisaDeLoTapado(tapados, "la nota");
    t.notas.push({ fecha: ahoraLocal(), texto });
    cambios++;
  }
  for (const f of flags.fuente ?? []) { t.fuentes = [...new Set([...(t.fuentes ?? []), f])]; cambios++; }

  CACHE = (await leeTodas()).tareas;
  if (!cambios) muere("update sin nada que cambiar: pasa --estado, --hizo, --nota, --commit, --pr, --fichero, --decision, --link, --padre o --resumen", 1);
  const problemas = valida(t);
  if (problemas.length) muere("tarea invalida: " + problemas.join("; "));
  const guardada = await guarda(t);
  if (salidaJSON) console.log(JSON.stringify(guardada, null, 2));
  else console.log(pintaDetalle(guardada));
}

async function cmd_search() {
  const consulta = sueltos.slice(1).join(" ") || (typeof flags.q === "string" ? flags.q : "");
  if (!consulta.trim()) muere("search necesita algo que buscar");
  const limite = Number(flags.limite) || 5;
  const { tareas, origen, aviso } = await leeTodas();
  CACHE = tareas;
  avisaDelOrigen(origen, aviso);
  const r = busca(consulta, tareas, { limite, minimo: Number(flags.minimo) || 0.08 });
  if (salidaJSON) { console.log(JSON.stringify(r, null, 2)); return; }
  if (!r.length) { console.log("nada parecido en el tracker."); return; }
  for (const { tarea, puntos, comunes } of r) {
    console.log(pintaFila(tarea));
    console.log("         parecido " + Math.round(puntos * 100) + "%  por: " + comunes.join(", "));
  }
}

async function cmd_show() {
  const id = sueltos[1];
  if (!id) muere("show necesita el id");
  const { tareas, origen, aviso } = await leeTodas();
  CACHE = tareas;
  avisaDelOrigen(origen, aviso);
  const t = tareas.find((x) => x.id === id);
  if (!t) muere("no existe " + id);
  console.log(salidaJSON ? JSON.stringify(t, null, 2) : pintaDetalle(t));
}

async function cmd_list() {
  const { tareas, origen, aviso } = await leeTodas();
  CACHE = tareas;
  avisaDelOrigen(origen, aviso);
  let l = tareas;
  if (flags.estado && flags.estado !== true) {
    const e = normalizaEstado(flags.estado);
    if (!e) muere("estado desconocido. Los que hay:\n  " + ESTADOS.join("\n  "));
    l = l.filter((t) => t.estado === e);
  }
  if (flags.hizo && flags.hizo !== true) l = l.filter((t) => t.lo_hizo_claude === flags.hizo);
  if (flags.desde && flags.desde !== true) l = l.filter((t) => t.fecha >= flags.desde);
  if (flags.hasta && flags.hasta !== true) l = l.filter((t) => t.fecha <= flags.hasta);
  if (flags.padre && flags.padre !== true) l = l.filter((t) => t.padre === flags.padre);
  if (flags.sueltas) l = l.filter((t) => !t.padre);
  if (flags.verificacion && flags.verificacion !== true) {
    const v = normalizaVerificacion(flags.verificacion);
    if (!v) muere("--verificacion tiene que ser uno de: " + VERIFICACION.join(", "));
    l = l.filter((t) => (t.verificacion?.estado ?? VERIFICACION[0]) === v);
  }
  // Las que no tienen NADA que pulsar. Se puede preguntar, en vez de que el hueco pase por
  // despiste: en la reconstrucción hay tareas cuya decisión no se pudo atar automáticamente, y
  // conviene que eso sea una lista y no una sospecha.
  if (flags["sin-evidencia"]) {
    l = l.filter((t) => !Object.values(t.evidencia ?? {}).some((v) => v?.length));
  }

  if (salidaJSON) { console.log(JSON.stringify(l, null, 2)); return; }
  if (flags.contar) {
    console.log(l.length + " tarea(s)");
    for (const e of ESTADOS) {
      const n = l.filter((t) => t.estado === e).length;
      console.log("  " + String(n).padStart(4) + "  " + e);
    }
    console.log("");
    for (const h of HECHO) {
      const n = l.filter((t) => t.lo_hizo_claude === h).length;
      console.log("  " + String(n).padStart(4) + "  lo hizo Claude: " + h);
    }
    console.log("");
    for (const v of VERIFICACION) {
      const n = l.filter((t) => (t.verificacion?.estado ?? VERIFICACION[0]) === v).length;
      console.log("  " + String(n).padStart(4) + "  " + v);
    }
    return;
  }
  for (const t of l) console.log(pintaFila(t));
  console.log("");
  console.log(l.length + " tarea(s). `--contar` para el desglose, `show <id>` para una.");
}

// ---------------------------------------------------------------- despachar

/**
 * El informe entero en un fichero que se abre con doble clic.
 *
 * El dueño: *«I believe un HTML estaría bien»*. Esto es para que no dependa de que alguien tenga
 * el servidor levantado: se guarda, se manda por correo y se abre en cualquier equipo.
 *
 * Sale por la salida estándar a propósito —`> tracker/informe.html`— para que quien lo genera
 * decida dónde cae, y para que el programa no escriba nunca un fichero que nadie le pidió.
 */
async function cmd_html() {
  const { tareas, origen, aviso } = await leeTodas();
  avisaDelOrigen(origen, aviso);
  process.stdout.write(informeHTML({ editable: false, tareas }));
}

/**
 * La pagina en vivo: entra con el usuario del RTG y cierra una tarea de un clic.
 *
 * Lleva dentro la URL y la ANON key, que son publicas por diseno; sin sesion no abren nada,
 * porque la RLS de la 144 solo deja leer al admin. **Nunca la de service-role**, y por eso se
 * lee de `NEXT_PUBLIC_SUPABASE_ANON_KEY` y no de la otra variable: coger la equivocada aqui
 * seria publicar la llave que lo abre todo.
 */
function cmd_vivo() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    muere("para generar la página en vivo hacen falta NEXT_PUBLIC_SUPABASE_URL y"
      + " NEXT_PUBLIC_SUPABASE_ANON_KEY (las dos son públicas)."
      + "  En un worktree no están a propósito: esto se hace desde el checkout principal.");
  }
  process.stdout.write(paginaEnVivoHTML({ url, anonKey: anon }));
}

const ORDENES = { add: cmd_add, update: cmd_update, search: cmd_search, show: cmd_show, list: cmd_list, html: cmd_html, vivo: cmd_vivo };

if (!orden || flags.help || orden === "help") {
  console.log([
    "El tracker de lo que pide el dueño.",
    "",
    "  add     --resumen \"...\" [--texto \"...\"|--texto-de f] [--fecha YYYY-MM-DD] [--hizo Si|Parcial|No]",
    "          [--estado \"...\"] [--padre T-0003] [--commit x] [--pr 12] [--fichero p] [--decision D-1]",
    "          [--link u] [--fuente s] [--nota \"...\"]",
    "  update  T-0001 [las mismas banderas; la evidencia y las notas SUMAN]",
    "  search  \"texto\" [--limite 5]        parecidos por palabras, sin salir de esta máquina",
    "  show    T-0001",
    "  html                                el informe entero, para guardar: `node tracker/cli.mjs html > tracker/informe.html`",
    "  vivo                                la pagina que entra con tu usuario y cierra de un clic: `... vivo > tracker/en-vivo.html`",
    "  list    [--estado ...] [--hizo ...] [--desde ...] [--hasta ...] [--padre T-3] [--sueltas]",
    "          [--sin-evidencia] [--verificacion ...] [--contar]",
    "  update  ... [--verificacion verificado --prueba \"quién lo midió, cuándo y cómo\"]",
    "",
    "Todas aceptan --json.",
    "",
    "Estados: " + ESTADOS.join(" | "),
    "«" + ESTADO_FINAL + "» solo lo pone el dueño: hace falta --confirmado-por-el-dueno y una --nota.",
  ].join("\n"));
  process.exit(orden && orden !== "help" ? 2 : 0);
}
if (!ORDENES[orden]) muere("no conozco la orden «" + orden + "». Prueba: " + Object.keys(ORDENES).join(", "));
// El despacho es asincrono porque leer y escribir la base lo son. Un fallo sale por el mensaje,
// no por una traza: quien corre esto quiere saber que hacer, no donde reventó.
try {
  await ORDENES[orden]();
} catch (e) {
  muere(String(e?.message ?? e));
}
void hayBase; void porQueNoHayBase;
