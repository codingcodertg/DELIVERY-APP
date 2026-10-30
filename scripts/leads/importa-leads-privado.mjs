// Importa el Excel de permisos municipales (fuente privada) al «Pool privado» de Leads (D-760, migración 218) y cruza cada
// lead con Clientes (erp.customers) por teléfono y por nombre.
//
// Uso (desde la raíz del repo, con SUPABASE_DB_URL en .env.local):
//   python scripts/leads/xls-a-json.py "C:/ruta/Report.xls" C:/ruta/report.json
//   node --env-file=.env.local scripts/leads/importa-leads-privado.mjs C:/ruta/report.json            # ensayo (ROLLBACK)
//   node --env-file=.env.local scripts/leads/importa-leads-privado.mjs C:/ruta/report.json --escribe  # de verdad
//
// Qué hace con cada fila del Excel (un permiso):
//   - tabs_project = «PRIV <Permit #>» (la clave única de siempre; un permiso repetido lleva «-2», «-3»…).
//   - source = 'privado'; pool = la tienda RTG por la ciudad de la obra (`poolDeCiudad`); 'No store' si no se conoce.
//   - El CONTRATISTA va en owner_* (es a quien se le vende) y el PROPIETARIO en tenant_*; la pantalla los rotula así en
//     los leads privados. Tipo (RNew, RAdd…) → project_type legible; Structure → project_name; Subdivision/Lot/Block →
//     facility_name; Value → estimated_cost; Total Sq Ft → square_footage; Issued Date → registered_date.
//   - category: «Sirve – usa piso» para obra nueva, ampliación y remodelación; «Might be useful» para lo demás
//     (re-techos, no estructural), para que el filtro de entrada («Sirve + podría servir») los enseñe.
//   - Cruce con Clientes: mismo teléfono (10 dígitos) que un cliente o uno de sus contactos → coincide; si no, mismo nombre
//     normalizado (empresa o persona, sin «LLC/Inc/Co», sin puntuación) que la cuenta, la cuenta unificada o el contacto.
//     Se guarda customer_match_id / customer_match_note / customer_matched_at. Un lead ya importado se actualiza (datos del
//     Excel y cruce), sin tocar estado, dueño ni historial, como `leads_import_rows`.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require("pg");
const ruta = process.argv[2];
const escribe = process.argv.includes("--escribe");

const TIPOS = { RNew: "Residential · new", RAdd: "Residential · addition", RNon: "Residential · non-structural", CNew: "Commercial · new", CAdd: "Commercial · addition", CNon: "Commercial · non-structural" };
const USA_PISO = new Set(["RNew", "RAdd", "CNew", "CAdd"]);
const POOL_POR_CIUDAD = {
  "mission": "RDZ Mission", "palmhurst": "RDZ Mission", "alton": "RDZ Mission", "palmview": "RDZ Mission", "la joya": "RDZ Mission", "sullivan city": "RDZ Mission", "penitas": "RDZ Mission",
  "mcallen": "RDZ McAllen", "hidalgo": "RDZ McAllen", "granjeno": "RDZ McAllen",
  "pharr": "RDZ Pharr", "san juan": "RDZ Pharr", "alamo": "RDZ Pharr", "donna": "RDZ Pharr",
  "edinburg": "RDZ Edinburg", "elsa": "RDZ Edinburg", "edcouch": "RDZ Edinburg", "san carlos": "RDZ Edinburg",
  "weslaco": "RDZ Weslaco", "mercedes": "RDZ Weslaco", "la feria": "RDZ Weslaco", "progreso": "RDZ Weslaco", "santa rosa": "RDZ Weslaco",
  "brownsville": "RDZ Brownsville", "los fresnos": "RDZ Brownsville", "laguna vista": "RDZ Brownsville", "port isabel": "RDZ Brownsville", "south padre island": "RDZ Brownsville", "san benito": "RDZ Brownsville", "harlingen": "RDZ Brownsville", "rancho viejo": "RDZ Brownsville", "olmito": "RDZ Brownsville",
};

const limpio = (v) => { const s = v === null || v === undefined ? "" : String(v).trim(); return !s || /^unk\.?$/i.test(s) || s === "-" ? null : s; };
const numero = (v) => { const s = limpio(v); if (s === null) return null; const n = Number(String(s).replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : null; };
const digitos = (v) => { const s = limpio(v); if (!s) return null; let d = String(s).replace(/\D/g, ""); if (d.length === 11 && d.startsWith("1")) d = d.slice(1); return d.length === 10 ? d : null; };
const telBonito = (d) => (d ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : null);
export const poolDeCiudad = (ciudad) => POOL_POR_CIUDAD[(limpio(ciudad) ?? "").toLowerCase()] ?? "No store";
/** Un nombre comparable: minúsculas, sin acentos, sin «llc/inc/co/corp/ltd», sin puntuación, sin «the», espacios de uno. */
export const nombreClave = (v) => {
  const s = (limpio(v) ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[.,'"&()/-]/g, " ").replace(/\b(llc|l l c|inc|incorporated|co|corp|corporation|ltd|the|company)\b/g, " ").replace(/\s+/g, " ").trim();
  return s.length >= 4 ? s : "";
};
/** «Apellido, Nombre» y «Nombre Apellido» son la misma persona. */
const variantes = (nombre) => { const k = nombreClave(nombre); if (!k) return []; const coma = (limpio(nombre) ?? "").indexOf(","); if (coma > 0) { const [a, b] = (limpio(nombre) ?? "").split(",", 2); return [k, nombreClave(`${b} ${a}`)].filter(Boolean); } return [k]; };

export function leadDeFila(f, sufijo) {
  const permiso = limpio(f["Permit #"]);
  const tipo = limpio(f["Type"]);
  const ciudad = limpio(f["City or County"]);
  const subdivision = [limpio(f["Subdivision"]), limpio(f["Lot"]) && `Lot ${limpio(f["Lot"])}`, limpio(f["Block"]) && `Block ${limpio(f["Block"])}`].filter(Boolean).join(" · ");
  const telC = digitos(f["Contractor Phone"]) ?? digitos(f["Contractor Phone II"]);
  const telO = digitos(f["Owner Phone"]) ?? digitos(f["Owner Phone II "] ?? f["Owner Phone II"]);
  return {
    tabs_project: `PRIV ${permiso ?? "SIN-PERMISO"}${sufijo ? `-${sufijo}` : ""}`.toUpperCase(),
    pool: poolDeCiudad(ciudad),
    source: "privado",
    category: tipo && USA_PISO.has(tipo) ? "Sirve – usa piso" : "Might be useful",
    project_type: tipo ? (TIPOS[tipo] ?? tipo) : null,
    reason: permiso ? `Permit ${permiso}` : null,
    county: ciudad,
    registered_date: limpio(f["Issued Date"]),
    project_name: limpio(f["Structure"]),
    facility_name: subdivision || null,
    type_of_work: tipo,
    scope_of_work: null,
    square_footage: numero(f["Total Sq Ft"]),
    estimated_cost: numero(f["Value"]),
    permit_status: "Issued",
    site_address: limpio(f["Jobsite Address"]),
    site_city: ciudad,
    site_zip: null,
    owner_name: limpio(f["Contractor Company Name"]),
    owner_phone: telBonito(telC) ?? limpio(f["Contractor Phone"]),
    owner_contact: null,
    owner_mailing_address: limpio(f["Contractor Address"]),
    owner_city_state_zip: [limpio(f["Contractor City"]), limpio(f["St"]), limpio(f["Zip"])].filter(Boolean).join(", ") || null,
    tenant_name: limpio(f["Owner Name"]),
    tenant_phone: telBonito(telO) ?? limpio(f["Owner Phone"]),
    _tels: [telC, telO].filter(Boolean),
    _nombres: [...variantes(f["Contractor Company Name"]), ...variantes(f["Owner Name"])],
  };
}

/** El índice de clientes: por teléfono (10 dígitos) y por nombre clave. */
export function indiceDeClientes(clientes) {
  const porTel = new Map(), porNombre = new Map();
  const pon = (m, k, c) => { if (!k) return; if (!m.has(k)) m.set(k, c); };
  for (const c of clientes) {
    if (c.archived_at) continue;
    pon(porTel, digitos(c.phone), c);
    for (const ct of Array.isArray(c.contacts) ? c.contacts : []) for (const p of Array.isArray(ct?.phones) ? ct.phones : []) pon(porTel, digitos(p), c);
    for (const n of [c.account, c.unified_account, c.contact_name]) for (const k of variantes(n)) pon(porNombre, k, c);
    for (const ct of Array.isArray(c.contacts) ? c.contacts : []) for (const k of variantes(ct?.name)) pon(porNombre, k, c);
  }
  return { porTel, porNombre };
}

export function cruza(lead, idx) {
  for (const t of lead._tels) { const c = idx.porTel.get(t); if (c) return { id: c.id, nota: `Teléfono ${telBonito(t)} = ${c.account} (${c.store})` }; }
  for (const n of lead._nombres) { const c = idx.porNombre.get(n); if (c) return { id: c.id, nota: `Nombre «${n}» = ${c.account} (${c.store})` }; }
  return null;
}

const esPrincipal = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (esPrincipal) {
  if (!ruta) { console.error("uso: importa-leads-privado.mjs <report.json> [--escribe]"); process.exit(1); }
  if (!process.env.SUPABASE_DB_URL) { console.error("falta SUPABASE_DB_URL (node --env-file=.env.local …)"); process.exit(1); }
  const { filas } = JSON.parse(readFileSync(ruta, "utf8"));
  const vistos = new Map();
  const leads = filas.map((f) => {
    const p = limpio(f["Permit #"]) ?? "SIN-PERMISO";
    const n = (vistos.get(p) ?? 0) + 1; vistos.set(p, n);
    return leadDeFila(f, n > 1 ? n : 0);
  });
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await c.connect();
  await c.query("begin");
  await importaEnTransaccion(c, leads);
  await c.query(escribe ? "commit" : "rollback");
  console.log(escribe ? "COMMIT: hecho." : "ROLLBACK: ensayo; nada cambió. Con --escribe se aplica.");
  await c.end();
}

/** Lo que escribe, dentro de la transacción de quien llama (sin begin/commit): para ensayarlo junto a la 218. */
export async function importaEnTransaccion(c, leads) {
  const { rows: clientes } = await c.query("select id, store, account, unified_account, phone, contact_name, contacts, archived_at from erp.customers");
  const idx = indiceDeClientes(clientes);
  let nuevos = 0, actualizados = 0, coinciden = 0;
  const porPool = new Map(), ejemplos = [];
  for (const l of leads) {
    const m = cruza(l, idx);
    if (m) { coinciden++; if (ejemplos.length < 12) ejemplos.push(`${l.tabs_project}: ${l.owner_name ?? l.tenant_name} → ${m.nota}`); }
    porPool.set(l.pool, (porPool.get(l.pool) ?? 0) + 1);
    const r = await c.query(
      `insert into public.leads as l (tabs_project, pool, source, category, project_type, reason, county, registered_date, project_name, facility_name,
         type_of_work, scope_of_work, square_footage, estimated_cost, permit_status, site_address, site_city, site_zip, owner_name, owner_phone,
         owner_contact, owner_mailing_address, owner_city_state_zip, tenant_name, tenant_phone, customer_match_id, customer_match_note, customer_matched_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27, case when $26::bigint is null then null else now() end)
       on conflict (tabs_project) do update set pool = excluded.pool, source = excluded.source, category = excluded.category, project_type = excluded.project_type,
         reason = excluded.reason, county = excluded.county, registered_date = excluded.registered_date, project_name = excluded.project_name,
         facility_name = excluded.facility_name, type_of_work = excluded.type_of_work, square_footage = excluded.square_footage,
         estimated_cost = excluded.estimated_cost, permit_status = excluded.permit_status, site_address = excluded.site_address, site_city = excluded.site_city,
         owner_name = excluded.owner_name, owner_phone = excluded.owner_phone, owner_mailing_address = excluded.owner_mailing_address,
         owner_city_state_zip = excluded.owner_city_state_zip, tenant_name = excluded.tenant_name, tenant_phone = excluded.tenant_phone,
         customer_match_id = excluded.customer_match_id, customer_match_note = excluded.customer_match_note, customer_matched_at = excluded.customer_matched_at, updated_at = now()
       returning id, (xmax = 0) as nuevo`,
      [l.tabs_project, l.pool, l.source, l.category, l.project_type, l.reason, l.county, l.registered_date, l.project_name, l.facility_name,
        l.type_of_work, l.scope_of_work, l.square_footage, l.estimated_cost, l.permit_status, l.site_address, l.site_city, l.site_zip, l.owner_name, l.owner_phone,
        l.owner_contact, l.owner_mailing_address, l.owner_city_state_zip, l.tenant_name, l.tenant_phone, m?.id ?? null, m?.nota ?? null],
    );
    if (r.rows[0].nuevo) { nuevos++; await c.query("insert into public.lead_events (lead_id, kind, actor, actor_name) values ($1, 'imported', null, 'import script (privado)')", [r.rows[0].id]); }
    else actualizados++;
  }
  console.log(`Filas: ${leads.length} · nuevos: ${nuevos} · actualizados: ${actualizados} · coinciden con Clientes: ${coinciden}`);
  console.log("Por pool:", [...porPool].map(([p, n]) => `${p} ${n}`).join(" · "));
  console.log("Coincidencias (hasta 12):\n  " + (ejemplos.join("\n  ") || "ninguna"));
  const tot = await c.query("select source, count(*) n from public.leads group by 1 order by 1");
  console.log("Leads en la base:", tot.rows.map((x) => `${x.source} ${x.n}`).join(" · "));
  return { nuevos, actualizados, coinciden };
}
