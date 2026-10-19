// Traspaso ERP §5.4: crear los proveedores nuevos de verdad, anotar los alias en erp.vendors.aliases (para que
// el próximo apply_master_import los resuelva) y, con un CSV `sku,vendor_name` de BH, poner vendor_id DONDE FALTE.
//
//   node --env-file=.env.local scripts/erp-handoff/aplica-proveedores.mjs [--csv=ruta.csv] [--ensayo|--escribe]
//
// proveedores.json: crudo -> «NUEVO» (insert en erp.vendors con ese nombre), «<id>:<name>» (existente; el crudo
// se añade a aliases), o el nombre de otra entrada (Texrite -> TEXRITE: alias del que aquella resuelva).
// Sin CSV no toca productos. Idempotente: un vendor que ya existe por nombre (sin distinguir mayúsculas) no se
// duplica; un alias ya presente no se repite; un vendor_id ya puesto no se pisa.
// Firma la sesión como admin para que audit_products (174) registre el actor; vendors no lleva auditoría.
import { readFileSync } from "node:fs";
import { conecta, actuaComo, adminActor, flags } from "./_db.mjs";

const argv = process.argv.slice(2);
const f = flags(argv);
const ensayo = argv.includes("--ensayo");
const escribeAlgo = f.escribe || ensayo;
const csv = (argv.find((a) => a.startsWith("--csv=")) || "").slice(6);
const mapa = JSON.parse(readFileSync(new URL("./proveedores.json", import.meta.url), "utf8"));
delete mapa._nota;

const limpia = (s) => s.trim().replace(/^"|"$/g, "");

const c = await conecta();
try {
  await c.query("begin");
  const actor = await adminActor(c, f.actor);
  await actuaComo(c, actor.id);
  const modo = f.escribe ? "ESCRIBE" : ensayo ? "ENSAYO (rollback)" : "EN SECO";
  const resuelto = {}; // crudo -> vendor id (o -1 en seco para uno que se crearía)
  let creados = 0, aliasNuevos = 0;

  const anotaAlias = async (id, crudo) => {
    if (id < 0) { aliasNuevos++; return; }
    const { rows: [row] } = await c.query("select name, coalesce(aliases,'{}') aliases from erp.vendors where id = $1", [id]);
    if (!row || row.name === crudo || row.aliases.includes(crudo)) return;
    aliasNuevos++;
    if (escribeAlgo) await c.query("update erp.vendors set aliases = array_append(coalesce(aliases,'{}'), $1) where id = $2", [crudo, id]);
  };

  const resolver = async (crudo, visto = new Set()) => {
    if (resuelto[crudo] !== undefined) return resuelto[crudo];
    if (visto.has(crudo)) throw new Error(`proveedores.json: ciclo en «${crudo}»`);
    visto.add(crudo);
    const v = mapa[crudo];
    if (!v) return null;
    let id;
    if (/^\d+:/.test(v)) {
      id = Number(v.split(":")[0]);
      const { rows: [row] } = await c.query("select name from erp.vendors where id = $1", [id]);
      if (!row || row.name !== v.slice(v.indexOf(":") + 1)) throw new Error(`«${crudo}» → ${v}: no cuadra con erp.vendors`);
      await anotaAlias(id, crudo);
    } else if (v === "NUEVO") {
      const { rows: [ex] } = await c.query("select id from erp.vendors where lower(name) = lower($1)", [crudo]);
      if (ex) id = ex.id;
      else {
        creados++;
        id = escribeAlgo ? (await c.query("insert into erp.vendors (name) values ($1) returning id", [crudo])).rows[0].id : -1;
      }
    } else {
      id = await resolver(v, visto);
      if (id === null) throw new Error(`«${crudo}» → «${v}»: esa entrada no existe en proveedores.json`);
      await anotaAlias(id, crudo);
    }
    return (resuelto[crudo] = id);
  };

  for (const crudo of Object.keys(mapa)) await resolver(crudo);
  console.log(`[${modo}] actor ${actor.full_name} · proveedores a crear: ${creados} · alias a anotar: ${aliasNuevos}`);
  console.log(JSON.stringify(resuelto));

  if (csv) {
    let puestos = 0, sinMapa = 0, yaTenia = 0, skuDesconocido = 0;
    const lineas = readFileSync(csv, "utf8").split(/\r?\n/).filter(Boolean).slice(1);
    for (const l of lineas) {
      const [sku, ...rest] = l.split(",");
      const id = await resolver(limpia(rest.join(",")));
      if (id === null) { sinMapa++; continue; }
      const { rows: [p] } = await c.query("select id, vendor_id from erp.products where sku = $1", [limpia(sku)]);
      if (!p) { skuDesconocido++; continue; }
      if (p.vendor_id !== null) { yaTenia++; continue; }
      puestos++;
      if (escribeAlgo) await c.query("update erp.products set vendor_id = $1, updated_at = now() where id = $2 and vendor_id is null", [id, p.id]);
    }
    console.log(`CSV ${csv}: vendor_id puestos ${puestos} · sin mapa ${sinMapa} · ya tenían ${yaTenia} · sku desconocido ${skuDesconocido}`);
  } else {
    console.log("Sin --csv: no se toca ningún producto (los nombres crudos por SKU los tiene BH).");
  }
  await c.query(f.escribe ? "commit" : "rollback");
  console.log(f.escribe ? "COMMIT" : "ROLLBACK");
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error("ERROR, nada escrito:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
