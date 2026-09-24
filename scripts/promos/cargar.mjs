// ===========================================================================
// RTG PROMOS · cargar una ronda desde un Excel
// ===========================================================================
// Lee el README de al lado antes de usarlo. Lo corto:
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/promos/cargar.mjs "<libro.xlsx>"
//
// Eso SOLO LEE y enseña lo que cargaría. Para escribir de verdad hace falta la bandera
// `--escribir`, la llave de servicio y el fichero de entorno:
//
//   node --env-file=.env.local --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
//        scripts/promos/cargar.mjs "<libro.xlsx>" --etiqueta="9.25.26 Promo" --escribir
//
// POR QUE ESTE FICHERO ES .mjs Y NO .ts: para poder comprobar la version de Node ANTES de que
// nada se parsee. Un `.ts` en un Node viejo revienta con un error de sintaxis que no dice cual es
// el problema; aqui se dice. Los modulos de verdad —el lector del libro y las funciones puras— si
// son los `.ts` de `src/lib/promos`, importados tal cual: **no se reescribe el lector**, que es la
// unica forma de que el script y la app no se separen.
//
// Y POR QUE NO HACE FALTA `tsx` NI NINGUNA DEPENDENCIA NUEVA: Node 22.6+ quita los tipos el solo
// («type stripping»), y los tres modulos que hacen falta no tienen NI UN import de runtime con el
// alias `@/` — los suyos son relativos o de tipo, y los de tipo se borran. Medido, no supuesto.
// ===========================================================================

import { readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";

// ---------------------------------------------------------------------------
// 0. La version de Node, antes de importar nada con tipos.
// ---------------------------------------------------------------------------
const [mayor, menor] = process.versions.node.split(".").map(Number);
if (mayor < 22 || (mayor === 22 && menor < 6)) {
  console.error(
    `Node ${process.versions.node} no sabe leer TypeScript. Hace falta 22.6 o mas nuevo\n` +
    "(en 22.6-23.5, con --experimental-strip-types; desde 23.6 va solo).",
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const bandera = (nombre) => args.includes(`--${nombre}`);
const valor = (nombre) => {
  const p = args.find((a) => a.startsWith(`--${nombre}=`));
  return p ? p.slice(nombre.length + 3) : null;
};
const ruta = args.find((a) => !a.startsWith("--"));

if (!ruta || bandera("ayuda") || bandera("help")) {
  console.log(readFileSync(new URL("./README.md", import.meta.url), "utf8"));
  process.exit(ruta ? 0 : 1);
}

const ESCRIBE = bandera("escribir");
const URL_BASE = valor("url") ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const LLAVE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const gruposAMano = (valor("grupos") ?? "").split(",").map((g) => g.trim()).filter(Boolean);


// ---------------------------------------------------------------------------
// 1. Los modulos de la app. Los MISMOS que usa la pantalla; aqui no se decide nada nuevo.
// ---------------------------------------------------------------------------
const { leePromo, huellaDeLectura, disposicionDe } = await import("../../src/lib/promos/excel.ts");
const { leeLibro } = await import("../../src/lib/promos/libro.ts");
const { etiquetaDeRonda, filasParaGuardar, gruposDeAjustes, problemaDeLoLeido, problemaDelFichero } =
  await import("../../src/lib/promos/subida.ts");

const raya = (t) => console.log(`\n── ${t} ${"─".repeat(Math.max(0, 68 - t.length))}`);
const muere = (m) => { console.error(`\n✗ ${m}`); process.exit(1); };

// ---------------------------------------------------------------------------
// 2. El fichero
// ---------------------------------------------------------------------------
const absoluta = resolve(ruta);
let tam;
try { tam = statSync(absoluta).size; } catch { muere(`no se pudo abrir «${absoluta}»`); }
const malFichero = problemaDelFichero(basename(absoluta), tam);
if (malFichero) muere(`${malFichero.codigo}: ${malFichero.detalle}`);

// ---------------------------------------------------------------------------
// 3. Los grupos de Ajustes. SIN LLAVE TAMBIEN SE PUEDE LEER EL LIBRO: comprobar un Excel no
//    deberia exigir la llave que escribe. Lo que no se puede sin ella es cruzar los grupos, y eso
//    se dice en vez de callarlo — y antes de escribir es obligatorio.
// ---------------------------------------------------------------------------
if (ESCRIBE && gruposAMano.length) {
  muere("--grupos no vale con --escribir: al escribir, los grupos salen de Ajustes y de ningun otro sitio.");
}

let base = null;
if (URL_BASE && LLAVE) {
  const { createClient } = await import("@supabase/supabase-js");
  base = createClient(URL_BASE, LLAVE, { auth: { autoRefreshToken: false, persistSession: false } });
}
if (ESCRIBE && !base) {
  muere(
    "para escribir hacen falta NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.\n" +
    "  Normalmente: node --env-file=.env.local … (ese fichero NO esta en los worktrees, a proposito).",
  );
}

let gruposConocidos = [];
let origenDeLosGrupos = "ninguno";
if (base) {
  const { data, error } = await base.from("settings").select("stores").eq("id", 1).maybeSingle();
  if (error) muere(`no se pudieron leer los ajustes: ${error.message}`);
  gruposConocidos = gruposDeAjustes(data?.stores ?? []);
  origenDeLosGrupos = "Ajustes";
} else if (gruposAMano.length) {
  // `--grupos=` es SOLO para mirar un libro sin llave. Nunca manda al escribir: lo que decide
  // quien decide es Ajustes, y escribir con una lista escrita a mano metería sugerencias de
  // grupos que en la base no existen.
  gruposConocidos = gruposAMano;
  origenDeLosGrupos = "--grupos (a mano, solo para mirar)";
}

// ---------------------------------------------------------------------------
// 4. Leer el libro
// ---------------------------------------------------------------------------
let leido;
let hojas = [];
try {
  // `buf.buffer` NO vale: Node saca los Buffer pequeños de un fondo comun, asi que su ArrayBuffer
  // es el fondo entero y no el fichero. Con un libro pequeño se leeria basura de otro sitio. Se
  // recorta al tramo que es de verdad este fichero.
  const buf = readFileSync(absoluta);
  const datos = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  hojas = await leeLibro(datos);
  leido = leePromo(hojas, gruposConocidos);
} catch (e) {
  muere(`ese fichero no se pudo leer como un .xlsx: ${e?.message ?? e}`);
}
const etiqueta = etiquetaDeRonda(valor("etiqueta"), basename(absoluta));
const malLeido = problemaDeLoLeido(leido, etiqueta);

raya("Lo que trae el libro");
console.log(`  fichero      ${basename(absoluta)} (${tam} bytes)`);
console.log(`  ronda        «${etiqueta}»`);
console.log(`  productos    ${leido.productos.length}`);
console.log(`  huella       ${huellaDeLectura(leido)}`);

const porGrupo = new Map();
for (const s of leido.sugerencias) porGrupo.set(s.groupCode, (porGrupo.get(s.groupCode) ?? 0) + 1);
console.log(`  sugerencias  ${leido.sugerencias.length}${porGrupo.size ? ` → ${[...porGrupo].map(([g, n]) => `${g}:${n}`).join(", ")}` : ""}`);

// Las claves de existencias por tienda. NO se pueden cruzar con Ajustes —una tienda de Ajustes
// guarda su GRUPO, no el codigo de columna del libro— asi que se enseñan para que quien carga las
// mire, y se dice que no hay contra que compararlas en vez de fingir una comprobacion.
const tiendas = [...new Set(leido.productos.flatMap((p) => Object.keys(p.qohByStore)))];
console.log(`  existencias  ${tiendas.length} columnas de tienda: ${tiendas.join(", ")}`);
console.log("               (no hay con que cruzarlas: Ajustes guarda el GRUPO de cada tienda, no");
console.log("                el codigo de columna del libro. Miralas tu antes de escribir.)");

raya(`Avisos (${leido.avisos.length}) — lo que NO se va a guardar, y por que`);
if (!leido.avisos.length) console.log("  ninguno: todas las filas del libro se pudieron leer.");
// AGRUPADOS POR TIPO, con unos pocos ejemplos. Sin esto, un libro leido sin conocer los grupos
// escupe un aviso por cada fila de cada hoja de tienda —en el libro real, ciento diez— y parece
// que trae ciento diez problemas cuando trae uno: que no se sabe de quien es cada hoja.
const porTipo = new Map();
for (const a of leido.avisos) { if (!porTipo.has(a.tipo)) porTipo.set(a.tipo, []); porTipo.get(a.tipo).push(a); }
for (const [tipo, lista] of porTipo) {
  console.log(`  ${tipo} — ${lista.length}`);
  for (const a of lista.slice(0, 5)) console.log(`      ${a.hoja}${a.fila != null ? `:${a.fila}` : ""} — ${a.detalle}`);
  if (lista.length > 5) console.log(`      … y ${lista.length - 5} mas`);
}
if (!gruposConocidos.length && porTipo.has("codigo-repetido")) {
  console.log("");
  console.log("  OJO: sin grupos conocidos, las hojas de tienda se leen como catalogo, asi que cada");
  console.log("  producto que ya estaba en la hoja general sale como repetido. NO es un problema del");
  console.log("  libro: es que no se sabe de quien es cada hoja. Corre con --env-file (o --grupos=…)");
  console.log("  y estos avisos desaparecen.");
}

raya("Grupos");
if (!base && !gruposConocidos.length) {
  console.log("  SIN COMPROBAR: no hay llave, asi que no se pudo leer Ajustes. El libro entero entra");
  console.log("  como catalogo y no hay sugerencias por tienda. Para cruzarlos, corre con --env-file,");
  console.log("  o pasa --grupos=UNO,DOS,… si solo quieres mirar.");
} else {
  const delLibro = [...porGrupo.keys()];
  const faltanEnElLibro = gruposConocidos.filter((g) => !delLibro.includes(g));
  // Las hojas de PRODUCTOS que no son ningun grupo conocido: entraron como catalogo. Casi siempre
  // son las dos que deben —la general y la de los sueltos— pero es tambien donde aparecera la
  // hoja de una tienda NUEVA cuyo grupo nadie ha puesto todavia en Ajustes. Es el aviso que se
  // pidio, y sale del dato: las hojas de las que salio cada producto, menos los grupos conocidos.
  // De las HOJAS del libro, no de los productos: una hoja de tienda cuyo grupo falte en Ajustes se
  // lee como catalogo y sus productos chocan con los de la hoja general, asi que NINGUNO se queda
  // con su nombre — y mirar los productos la escondia justo en el caso que esto viene a cazar.
  // Medido: quitando un grupo de la lista, la derivacion por producto dejaba de verlo.
  const igual = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const hojasDeCatalogo = hojas
    .filter((h) => disposicionDe(h.filas))
    .map((h) => h.nombre)
    .filter((n) => !gruposConocidos.some((g) => igual(g, n)));
  console.log(`  conocidos:   ${gruposConocidos.length ? gruposConocidos.join(", ") : "NINGUNO — nadie podra decidir nada"} (de ${origenDeLosGrupos})`);
  console.log(`  con hoja:    ${delLibro.length ? delLibro.join(", ") : "ninguno"}`);
  if (faltanEnElLibro.length) console.log(`  ⚠ sin hoja:  ${faltanEnElLibro.join(", ")} (el libro no trae hoja para ellos)`);
  console.log(`  a catalogo:  ${hojasDeCatalogo.join(", ") || "ninguna"}`);
  console.log("               (si alguna de esas deberia ser la hoja de una tienda, es que a esa");
  console.log("                tienda le falta su grupo de promociones en Datos → Tiendas)");
}

if (malLeido) muere(`${malLeido.codigo}: ${malLeido.detalle}`);

if (!ESCRIBE) {
  raya("No se ha escrito nada");
  console.log("  Esto ha sido solo una lectura. Para cargarla de verdad, repite con --escribir.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 5. Escribir. NO HAY TRANSACCION: supabase-js no la ofrece. Lo que hay en su lugar:
//
//    · la ronda NACE CERRADA (`closed_at`), que en la 140 significa «esta ronda no se decide»:
//      el disparador rechaza toda escritura de decision mientras lo este. Asi que si el proceso
//      muere a mitad —red caida, Ctrl-C— lo que queda es una ronda CERRADA con el catalogo a
//      medias, sobre la que nadie puede decidir, en vez de una ronda abierta con la mitad de los
//      productos y gente aprobando lo que hay;
//    · al final se CUENTAN las filas escritas y solo si cuadran se abre. O sea que «ronda abierta»
//      quiere decir «el script conto sus filas y salieron»;
//    · y si falla un paso, se borra la ronda: productos y sugerencias cuelgan de ella con
//      `on delete cascade`.
//
//    No hace falta migracion para esto: `closed_at` ya existe y se usa con su significado. Si
//    algun dia se quiere distinguir «cerrada por el admin» de «carga a medias», eso SI seria una
//    columna nueva, y no se ha inventado aqui.
// ---------------------------------------------------------------------------
raya("Escribiendo");
const ahora = new Date().toISOString();
const { data: ronda, error: errorRonda } = await base
  .from("promo_rounds")
  .insert({ label: etiqueta, source_name: basename(absoluta), closed_at: ahora })
  .select("id")
  .single();
if (errorRonda || !ronda?.id) muere(`no se pudo crear la ronda: ${errorRonda?.message ?? "sin id"}`);
const id = ronda.id;
console.log(`  ronda creada y CERRADA: ${id}`);

const borraYMuere = async (m) => {
  await base.from("promo_rounds").delete().eq("id", id);
  muere(`${m}\n  La ronda ${id} se ha borrado (la cascada se lleva productos y sugerencias).`);
};

const { productos, sugerencias } = filasParaGuardar(id, leido);

// Por tandas: un `insert` de miles de filas en una sola llamada se queda sin aire.
const TANDA = 500;
for (let i = 0; i < productos.length; i += TANDA) {
  const { error } = await base.from("promo_products").insert(productos.slice(i, i + TANDA));
  if (error) await borraYMuere(`fallaron los productos (tanda ${i / TANDA + 1}): ${error.message}`);
}
console.log(`  productos escritos:   ${productos.length}`);

for (let i = 0; i < sugerencias.length; i += TANDA) {
  const { error } = await base.from("promo_suggestions").insert(sugerencias.slice(i, i + TANDA));
  if (error) await borraYMuere(`fallaron las sugerencias (tanda ${i / TANDA + 1}): ${error.message}`);
}
console.log(`  sugerencias escritas: ${sugerencias.length}`);

// El recuento. Es lo que convierte «abierta» en un recibo y no en una suposicion.
const cuenta = async (tabla) => {
  const { count, error } = await base.from(tabla).select("code", { count: "exact", head: true }).eq("round_id", id);
  if (error) await borraYMuere(`no se pudieron contar las filas de ${tabla}: ${error.message}`);
  return count ?? 0;
};
const [nProductos, nSugerencias] = [await cuenta("promo_products"), await cuenta("promo_suggestions")];
if (nProductos !== productos.length || nSugerencias !== sugerencias.length) {
  await borraYMuere(
    `la base no tiene lo que se le mando: ${nProductos}/${productos.length} productos, ` +
    `${nSugerencias}/${sugerencias.length} sugerencias.`,
  );
}
console.log(`  recuento en la base:  ${nProductos} productos, ${nSugerencias} sugerencias — cuadra`);

const { error: errorAbrir } = await base.from("promo_rounds").update({ closed_at: null }).eq("id", id);
if (errorAbrir) {
  console.error(`\n⚠ Las filas estan bien pero la ronda SIGUE CERRADA: ${errorAbrir.message}`);
  console.error(`  No se borra nada: el catalogo es correcto. Abrela a mano cuando puedas:`);
  console.error(`  update public.promo_rounds set closed_at = null where id = '${id}';`);
  process.exit(1);
}

// La linea del registro de seguridad, la misma que dejaba la ruta que esto sustituye.
const { error: errorLog } = await base.from("security_events").insert({
  actor_id: null,
  target_id: null,
  target_name: etiqueta,
  kind: "promo_round_uploaded",
  detail: `${productos.length} products, ${sugerencias.length} suggestions, ${leido.avisos.length} notices, ` +
          `from ${basename(absoluta)} (round ${id}) — cargada con scripts/promos/cargar.mjs`,
});
// Una linea que falta es un problema mas pequeño que una ronda a medio cargar: se avisa y ya.
if (errorLog) console.error(`⚠ la ronda quedo bien, pero no se pudo escribir el registro: ${errorLog.message}`);

raya("Hecha");
console.log(`  ronda ${id} abierta, «${etiqueta}».`);
console.log(`  Para deshacerla:  delete from public.promo_rounds where id = '${id}';`);
