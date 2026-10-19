// Traspaso ERP §5.2: poner category_id según mapeo-categorias.json DONDE FALTE (category_id is null).
//
//   node --env-file=.env.local scripts/erp-handoff/aplica-mapeo.mjs [--csv=ruta.csv] [--ensayo|--escribe]
//
// Fuente de la etiqueta por producto, en este orden:
//   1. --csv=<ruta>  con cabecera `sku,label` (la hoja LINK no está en esta máquina: pedir a BH los
//      3.310 códigos con su etiqueta).
//   2. erp.products.raw_category (medido 2026-10-18: TODOS los que tienen raw_category ya tienen
//      category_id, así que sin CSV este script no cambia nada; lo dice).
// Las entradas del mapeo que empiezan por «?» se saltan y se cuentan.
// UPDATE directo a erp.products (no hay RPC para categoría); el trigger audit_products de la 174 deja el
// antes/después con el actor, por eso la sesión se firma como admin igual que aprueba-borradores.
import { readFileSync } from "node:fs";
import { conecta, actuaComo, adminActor, flags } from "./_db.mjs";

const argv = process.argv.slice(2);
const f = flags(argv);
const ensayo = argv.includes("--ensayo");
const csv = (argv.find((a) => a.startsWith("--csv=")) || "").slice(6);
const mapeo = JSON.parse(readFileSync(new URL("./mapeo-categorias.json", import.meta.url), "utf8"));
delete mapeo._nota;

const limpia = (s) => s.trim().replace(/^"|"$/g, "");
const leeCsv = (ruta) =>
  readFileSync(ruta, "utf8").split(/\r?\n/).filter(Boolean).slice(1).map((l) => {
    const [sku, ...rest] = l.split(",");
    return { sku: limpia(sku), label: limpia(rest.join(",")) };
  });

const c = await conecta();
try {
  await c.query("begin");
  const actor = await adminActor(c, f.actor);
  await actuaComo(c, actor.id);
  const { rows: cats } = await c.query("select id, path from erp.categories");
  const idPorPath = Object.fromEntries(cats.map((x) => [x.path, x.id]));
  for (const [k, v] of Object.entries(mapeo)) {
    if (!v.startsWith("?") && !idPorPath[v]) throw new Error(`Mapeo «${k}» → «${v}»: ese path no existe en erp.categories`);
  }

  const filas = csv
    ? leeCsv(csv)
    : (await c.query("select sku, raw_category label from erp.products where raw_category is not null and category_id is null")).rows;
  const cuentas = { total: filas.length, dudosas: 0, sinMapeo: 0, skuDesconocido: 0, yaTenia: 0, porPoner: 0 };
  const porEtiqueta = {};
  const cambios = [];
  for (const { sku, label } of filas) {
    const v = mapeo[label.toUpperCase()];
    if (v === undefined) { cuentas.sinMapeo++; continue; }
    if (v.startsWith("?")) { cuentas.dudosas++; continue; }
    const { rows: [p] } = await c.query("select id, category_id from erp.products where sku = $1", [sku]);
    if (!p) { cuentas.skuDesconocido++; continue; }
    if (p.category_id !== null) { cuentas.yaTenia++; continue; }
    cambios.push({ id: p.id, sku, cat: idPorPath[v], path: v });
    porEtiqueta[label] = (porEtiqueta[label] || 0) + 1;
  }
  cuentas.porPoner = cambios.length;
  console.log(`[${f.escribe ? "ESCRIBE" : ensayo ? "ENSAYO (rollback)" : "EN SECO"}] fuente: ${csv || "erp.products.raw_category"} · actor ${actor.full_name}`);
  console.log(JSON.stringify(cuentas), JSON.stringify(porEtiqueta));
  if (!f.escribe && !ensayo) { await c.query("rollback"); process.exit(0); }

  let n = 0;
  for (const ch of cambios) {
    const r = await c.query(
      "update erp.products set category_id = $1, updated_at = now() where id = $2 and category_id is null returning id",
      [ch.cat, ch.id],
    );
    n += r.rowCount;
  }
  console.log(`actualizados: ${n}`);
  await c.query(f.escribe ? "commit" : "rollback");
  console.log(f.escribe ? "COMMIT" : "ROLLBACK");
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error("ERROR, nada escrito:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
