// El modelo del tracker: leer, escribir y buscar tareas. Node puro, sin dependencias.
//
// **Un fichero por tarea**, `tracker/tareas/T-0001.json`, y no un JSON grande con todo dentro.
// La razon es la misma por la que `DECISIONS.md` da guerra al fusionar: dos sesiones que escriben
// a la vez en el mismo fichero chocan siempre, y el conflicto hay que resolverlo a mano. Con un
// fichero por tarea, dos sesiones que crean tareas distintas no se tocan, y git las fusiona solo.
// SQLite quedo descartado por lo mismo: es binario, no se fusiona y no se lee en un diff.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ = dirname(fileURLToPath(import.meta.url));

/**
 * Donde viven las tareas. `TRACKER_TAREAS` la mueve, y existe **por las pruebas**: la primera
 * version de `tracker.test.mjs` llamaba al CLI de verdad y dejo dos tareas de mentira —«de prueba»,
 * T-0006 y T-0007— dentro del repo, una por cada vez que corrio la suite. Una prueba que escribe
 * donde escribe el programa llena de basura justo lo que venia a vigilar.
 */
export const DIR_TAREAS = process.env.TRACKER_TAREAS
  ? (process.env.TRACKER_TAREAS.startsWith("/") || /^[A-Za-z]:/.test(process.env.TRACKER_TAREAS)
      ? process.env.TRACKER_TAREAS
      : join(process.cwd(), process.env.TRACKER_TAREAS))
  : join(RAIZ, "tareas");

// Los diacriticos que `normalize("NFD")` separa, para comparar «revision» con «revisión». El
// rango se construye con `fromCharCode` a proposito: un `\u0300` escrito a mano dentro de una
// cadena se ha convertido en el caracter de verdad mas de una vez al generar ficheros.
const ACENTOS = new RegExp("[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]", "g");

/**
 * Los cuatro estados, **tal como los dijo el dueno**: con sus acentos y con el guion largo. Se
 * guardan asi porque es lo que se lee en pantalla, y cambiarlos «para que sea mas comodo teclear»
 * es cambiar sus palabras por las mias.
 *
 * Para teclearlos, `normalizaEstado` acepta la version sin acentos y con guion corto: se guarda
 * fiel y se acepta flojo, que es lo contrario de lo comodo para el programa.
 */
export const ESTADOS = [
  "En revision - desplegado".replace("revision", "revisi" + String.fromCharCode(0xf3) + "n").replace(" - ", " " + String.fromCharCode(0x2013) + " "),
  "En revision - no desplegado".replace("revision", "revisi" + String.fromCharCode(0xf3) + "n").replace(" - ", " " + String.fromCharCode(0x2013) + " "),
  "Ocupa revision".replace("revision", "revisi" + String.fromCharCode(0xf3) + "n"),
  "Completado",
];

/** Un estado tecleado de cualquier forma — sin acentos, con guion corto, en minusculas — al oficial. */
export function normalizaEstado(s) {
  const llano = (t) => (t ?? "")
    .normalize("NFD").replace(ACENTOS, "")
    .toLowerCase()
    .replace(new RegExp("[" + String.fromCharCode(0x2013) + String.fromCharCode(0x2014) + "]", "g"), "-")
    .replace(/\s+/g, " ")
    .trim();
  return ESTADOS.find((e) => llano(e) === llano(s)) ?? null;
}

/** Si lo hizo Claude o no. «Parcial» es la respuesta honesta mas veces de lo que parece. */
export const HECHO = ["Si", "Parcial", "No"];

/**
 * El dia, en la zona del negocio.
 *
 * **NO `toISOString().slice(0,10)`**, que es UTC: a las 7 de la tarde en Texas, UTC ya esta en
 * manana, y una peticion de esta tarde se guardaria con la fecha de manana. Se vio en la primera
 * captura de la app: una nota escrita hoy salia fechada el dia siguiente.
 *
 * Es el mismo error que la app ya tiene resuelto en `src/lib/utils.ts` (`localISO`, `BUSINESS_TZ`),
 * y el tracker lo repitio por copiar la forma facil. Aqui se escribe otra vez porque `tracker/` no
 * depende de `src/`: es una carpeta aparte que corre con Node a secas.
 */
export const ZONA_NEGOCIO = "America/Chicago";
export function diaLocal(cuando = new Date()) {
  const d = typeof cuando === "string" ? new Date(cuando) : cuando;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA_NEGOCIO, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

/**
 * El instante, **con el desfase de Texas escrito dentro**: `2026-09-23T21:11:38-05:00`.
 *
 * No es lo mismo que guardar en `Z`. Los dos apuntan al mismo momento, pero el JSON se lee a ojo
 * —con `show`, en un diff, en una revision— y `2026-09-24T02:11:38Z` se lee como «el 24». Una nota
 * escrita a las nueve de la noche aparecia fechada al dia siguiente para quien mirase el fichero,
 * aunque la pagina la pintara bien. Con el desfase, el dia correcto esta delante sin convertir nada.
 */
export function ahoraLocal(cuando = new Date()) {
  const d = typeof cuando === "string" ? new Date(cuando) : cuando;
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA_NEGOCIO, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    timeZoneName: "longOffset",
  }).formatToParts(d);
  const p = (t) => partes.find((x) => x.type === t)?.value ?? "";
  // `longOffset` da «GMT-05:00»; el desfase se queda tal cual, y «GMT» (sin numero) es UTC.
  const bruto = p("timeZoneName").replace("GMT", "");
  const desfase = bruto === "" ? "+00:00" : bruto;
  // La hora 24 existe en este formato para la medianoche; ISO quiere 00.
  const hora = p("hour") === "24" ? "00" : p("hour");
  return p("year") + "-" + p("month") + "-" + p("day") + "T" + hora + ":" + p("minute") + ":" + p("second") + desfase;
}

/**
 * «Completado» no se pone solo.
 *
 * Lo pidio el dueno y es la regla que sostiene todo lo demas: una tarea la cierra EL, no quien la
 * hizo. Un tracker que se autoaprueba no es un control, es un boletin. Por eso el CLI exige
 * `--confirmado-por-el-dueno` para escribir este estado, y la app de pantalla no lo ofrece sin
 * pedir la nota de quien lo confirma.
 */
export const ESTADO_FINAL = "Completado";

/** Donde nace una tarea: pendiente de que el dueno la mire. */
export const ESTADO_INICIAL = ESTADOS[2];

// ---------------------------------------------------------------- forma de una tarea

/** Una tarea nueva, con todos los campos puestos aunque esten vacios: un campo que falta se lee
 *  como «no lo se» y un campo vacio se lee como «no hay», y no son lo mismo. */
export function tareaNueva(campos = {}) {
  const ahora = ahoraLocal();
  return {
    id: campos.id ?? null,
    fecha: campos.fecha ?? diaLocal(),
    resumen: campos.resumen ?? "",
    texto_original: campos.texto_original ?? "",
    lo_hizo_claude: campos.lo_hizo_claude ?? "No",
    estado: campos.estado ?? ESTADO_INICIAL,
    padre: campos.padre ?? null,
    evidencia: {
      commits: campos.evidencia?.commits ?? [],
      prs: campos.evidencia?.prs ?? [],
      ficheros: campos.evidencia?.ficheros ?? [],
      decisiones: campos.evidencia?.decisiones ?? [],
      links: campos.evidencia?.links ?? [],
    },
    notas: campos.notas ?? [],
    // De donde salio esta fila. En la reconstruccion del historial es lo que separa «lo dijo el
    // dueno» de «lo deduje de un commit», y sin eso el tracker no se puede auditar.
    fuentes: campos.fuentes ?? [],
    creado: campos.creado ?? ahora,
    modificado: ahora,
  };
}

export function valida(t) {
  const problemas = [];
  if (!/^T-\d{4,}$/.test(t.id ?? "")) problemas.push("el id no tiene la forma T-0001");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.fecha ?? "")) problemas.push("la fecha no es YYYY-MM-DD");
  if (!t.resumen?.trim()) problemas.push("sin resumen");
  if (!ESTADOS.includes(t.estado)) problemas.push("estado desconocido: " + t.estado);
  if (!HECHO.includes(t.lo_hizo_claude)) problemas.push("lo_hizo_claude desconocido: " + t.lo_hizo_claude);
  if (t.padre && t.padre === t.id) problemas.push("una tarea no puede ser su propia madre");
  return problemas;
}

// ---------------------------------------------------------------- leer y escribir

export function rutaDe(id) {
  return join(DIR_TAREAS, id + ".json");
}

export function lee(id) {
  const r = rutaDe(id);
  if (!existsSync(r)) return null;
  return JSON.parse(readFileSync(r, "utf8"));
}

export function todas() {
  if (!existsSync(DIR_TAREAS)) return [];
  return readdirSync(DIR_TAREAS)
    .filter((f) => /^T-\d+\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(join(DIR_TAREAS, f), "utf8")))
    .sort((a, b) => (a.fecha === b.fecha ? a.id.localeCompare(b.id) : a.fecha.localeCompare(b.fecha)));
}

/** Escribe por fichero temporal y rename: si el proceso muere a medias, la tarea de antes sigue
 *  entera en vez de quedarse un JSON cortado que ya no se puede leer. */
export function guarda(t) {
  mkdirSync(DIR_TAREAS, { recursive: true });
  const problemas = valida(t);
  if (problemas.length) throw new Error("tarea invalida (" + t.id + "): " + problemas.join("; "));
  t.modificado = ahoraLocal();
  const destino = rutaDe(t.id);
  const tmp = destino + ".tmp";
  writeFileSync(tmp, JSON.stringify(t, null, 2) + "\n");
  renameSync(tmp, destino);
  return destino;
}

/**
 * El siguiente id libre.
 *
 * Es `max + 1` **comprobando que el fichero no exista**, y no un contador guardado aparte: un
 * contador en un fichero es otra cosa que dos sesiones pueden pisarse, y aqui el propio nombre del
 * fichero es el candado. Si dos crean a la vez, la segunda ve el fichero puesto y sigue al
 * siguiente numero, en vez de sobrescribir.
 */
export function siguienteId() {
  const usados = todas().map((t) => Number(t.id.slice(2)));
  let n = usados.length ? Math.max(...usados) + 1 : 1;
  while (existsSync(rutaDe("T-" + String(n).padStart(4, "0")))) n++;
  return "T-" + String(n).padStart(4, "0");
}

// ---------------------------------------------------------------- buscar por palabras


/** Palabras vacias: las que salen en casi todo y por tanto no distinguen nada. */
const VACIAS = new Set((
  "el la los las un una unos unas de del a al y o que en por para con sin sobre como mas pero si no " +
  "se su sus lo le les me mi mis te tu tus es son era ser estar esta este esto estos estas hay ha han " +
  "the a an of to in for on and or that this these with is are be was were it its i you we they " +
  "quiero quiere puedes puede hacer hace haz favor porfa ok gracias"
).split(" "));

export function palabras(texto) {
  return (texto ?? "")
    .normalize("NFD").replace(ACENTOS, "")
    .toLowerCase()
    .split(/[^a-z0-9#-]+/)
    .filter((p) => p.length > 2 && !VACIAS.has(p));
}

/**
 * Parecido entre un texto y una tarea, **sin llamar a ninguna API**: nada del dueno sale de esta
 * maquina. Es cuenta de palabras compartidas, pesadas por lo raras que son en el conjunto (idf):
 * que dos tareas compartan «orden» no dice nada, que compartan «intertienda» dice mucho.
 */
export function busca(consulta, tareas = todas(), { limite = 5, minimo = 0.08 } = {}) {
  const q = palabras(consulta);
  if (!q.length) return [];
  const docs = tareas.map((t) => ({
    t,
    bolsa: new Set(palabras([t.resumen, t.texto_original, (t.notas ?? []).map((n) => n.texto).join(" ")].join(" "))),
  }));
  const idf = (p) => {
    const n = docs.filter((d) => d.bolsa.has(p)).length;
    return Math.log((docs.length + 1) / (n + 1)) + 1;
  };
  const pesos = new Map(q.map((p) => [p, idf(p)]));
  const total = [...pesos.values()].reduce((a, b) => a + b, 0) || 1;
  return docs
    .map(({ t, bolsa }) => {
      const comunes = q.filter((p) => bolsa.has(p));
      const puntos = comunes.reduce((a, p) => a + (pesos.get(p) ?? 0), 0) / total;
      return { tarea: t, puntos, comunes: [...new Set(comunes)] };
    })
    .filter((r) => r.puntos >= minimo)
    .sort((a, b) => b.puntos - a.puntos)
    .slice(0, limite);
}

// ---------------------------------------------------------------- secretos

/**
 * Lo que NO puede acabar escrito en el repo. El tracker guarda texto del dueno tal cual, y ese
 * texto ha llevado tokens mas de una vez: el de Notion se pega en el chat para que el script de
 * sincronizacion corra.
 *
 * Se tapa en vez de tirar la tarea entera: el mensaje sigue contando que pidio, y el secreto se
 * queda fuera. Lo que se tapa se dice, para que nadie crea que el texto esta completo.
 */
export const PATRONES_SECRETOS = [
  [/\bntn_[A-Za-z0-9]{20,}/g, "[token-notion-tapado]"],
  [/\bey[JI][A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[jwt-tapado]"],
  [/\bsb[pd]_[A-Za-z0-9]{20,}/g, "[llave-supabase-tapada]"],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, "[llave-api-tapada]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "[token-github-tapado]"],
  [/\bAIza[A-Za-z0-9_-]{30,}/g, "[llave-google-tapada]"],
  [/postgres(?:ql)?:\/\/[^\s"']+/gi, "[cadena-de-conexion-tapada]"],
  // TODOS los correos, incluido el del dueno. Una excepcion «el dominio de casa no» habria que
  // explicarla, y ese dominio tambien lo llevan sus empleados. En una peticion el correo casi nunca
  // es lo que se pide, asi que taparlo no pierde nada.
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[correo-tapado]"],
  [/\b(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/g, "[telefono-tapado]"],
];

export function tapaSecretos(texto) {
  let t = texto ?? "";
  const tapados = [];
  for (const [re, con] of PATRONES_SECRETOS) {
    t = t.replace(re, () => { tapados.push(con); return con; });
  }
  return { texto: t, tapados: [...new Set(tapados)] };
}
