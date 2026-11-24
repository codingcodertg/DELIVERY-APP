// Ubica los permisos del CONDADO antes de importarlos al STXP Pool de Leads (D-1151).
//
// El reporte semanal de permisos trae, en «City or County», la ciudad de la obra. Hasta el del 20 de noviembre de 2026
// siempre fue una ciudad, y el importador saca de ahí la tienda (`poolDeCiudad`). Ese reporte trajo 220 de 267 filas con
// «Hidalgo County»: obras fuera de los límites de una ciudad, con la dirección como cruce de caminos («Mile 13 N & FM 493»)
// y sin ciudad. Importadas tal cual caían en «No store», que los vendedores no ven.
// El dueño, 2026-11-24: «investiga y si le hace falta algo agrégaselo».
//
// Este guion le agrega a cada fila de condado lo que le falta, y deja las demás como están:
//   _ciudad  la ciudad más próxima: la localidad que da el buscador de direcciones o, si no da ninguna (lo normal fuera de
//            los límites de una ciudad), la ciudad de su código postal;
//   _pool    la tienda RTG MÁS CERCANA al punto, en línea recta;
//   _nota    una línea que dice que es un permiso del condado y cómo se ubicó (va a `scope_of_work`, que la tarjeta enseña).
// Cuando el buscador no encuentra el cruce, o lo pone donde no puede ser, se usa la ZONA del permiso: el número de permiso
// del condado empieza con su precinto («1-13039», «3-8610»), y cada precinto cae en una parte del condado.
//
// Uso (desde la raíz del repo; GOOGLE_MAPS_API_KEY y SUPABASE_DB_URL en .env.local):
//   node --env-file=.env.local scripts/leads/ubica-condado.mjs C:/ruta/report.json            # escribe report.ubicado.json
//   node --env-file=.env.local scripts/leads/importa-leads-privado.mjs C:/ruta/report.ubicado.json [--escribe]
// Solo LEE de la base (las tiendas, de `settings.stores`). Lo que el buscador ya contestó se guarda junto al JSON
// (`report.geocache.json`) para no pagarlo dos veces.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

/** «Hidalgo County», «Cameron County»… */
export const esCondado = (ciudad) => /\bcounty\s*$/i.test(String(ciudad ?? "").trim());

/** El precinto del condado con el que empieza el permiso («1-13039» → 1). `null` si no lo lleva. */
export function zonaDelPermiso(permiso) {
  const m = /^\s*([1-4])-\d+/.exec(String(permiso ?? ""));
  return m ? Number(m[1]) : null;
}

/**
 * La tienda de cada precinto de Hidalgo County, cuando no hay punto: 1 es el este (Weslaco, Mercedes, Donna, Edcouch-Elsa),
 * 2 el centro-sur (Pharr, San Juan, Alamo), 3 el oeste (Mission, Alton, Palmview, La Joya) y 4 el norte (Edinburg).
 * Comprobado con el reporte del 20 nov: los contratistas del 1 son sobre todo de Weslaco y Donna; los del 3, de Mission.
 */
export const TIENDA_DE_LA_ZONA = { 1: "RDZ Weslaco", 2: "RDZ Pharr", 3: "RDZ Mission", 4: "RDZ Edinburg" };

/** La ciudad de correo de cada código postal de Hidalgo County: el nombre con el que la gente ubica una obra rural. */
export const CIUDAD_DEL_CP = {
  78501: "McAllen", 78503: "McAllen", 78504: "McAllen", 78516: "Alamo", 78537: "Donna", 78538: "Edcouch", 78539: "Edinburg", 78540: "Edinburg",
  78541: "Edinburg", 78542: "Edinburg", 78543: "Elsa", 78549: "Hargill", 78557: "Hidalgo", 78558: "La Blanca", 78560: "La Joya", 78562: "La Villa",
  78563: "Linn", 78565: "Los Ebanos", 78570: "Mercedes", 78572: "Mission", 78573: "Mission", 78574: "Mission", 78576: "Penitas", 78577: "Pharr",
  78579: "Progreso", 78589: "San Juan", 78595: "Sullivan City", 78596: "Weslaco", 78599: "Weslaco",
};
/** La ciudad de correo de una dirección ya resuelta («…, Texas 78573, USA» → Mission), o `null`. */
export const ciudadDelTexto = (texto) => { const m = /\b(78\d{3})\b/.exec(String(texto ?? "")); return m ? CIUDAD_DEL_CP[m[1]] ?? null : null; };

/** Dónde puede caer un punto de cada precinto (longitud oeste). Fuera de eso, el buscador se equivocó de cruce. */
const FRANJA_DE_LA_ZONA = { 1: [-98.2, -97.85], 2: [-98.32, -98.0], 3: [-98.6, -98.2], 4: [-98.45, -97.95] };
/** Hidalgo County, con algo de margen. */
const CONDADO = { latMin: 26.03, latMax: 26.8, lngMin: -98.6, lngMax: -97.85 };

export function puntoCreible(zona, p) {
  if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return false;
  if (p.lat < CONDADO.latMin || p.lat > CONDADO.latMax || p.lng < CONDADO.lngMin || p.lng > CONDADO.lngMax) return false;
  const franja = zona ? FRANJA_DE_LA_ZONA[zona] : null;
  return !franja || (p.lng >= franja[0] && p.lng <= franja[1]);
}

/** Millas en línea recta. */
export function millas(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

/** La tienda RTG más cercana al punto (solo las «RDZ …» con coordenadas: una bodega no vende). */
export function tiendaMasCercana(p, tiendas) {
  let mejor = null;
  for (const t of tiendas) {
    if (!/^RDZ /.test(t.name ?? "") || !Number.isFinite(t.lat) || !Number.isFinite(t.lng)) continue;
    const d = millas(p, t);
    if (!mejor || d < mejor.millas) mejor = { tienda: t.name, millas: d };
  }
  return mejor;
}

/**
 * Lo que se le agrega a UNA fila de condado. `geo`: lo que contestó el buscador para su cruce
 * (`{ lat, lng, ciudad, texto }`) o `null`. Devuelve `null` si la fila no es de condado (no se toca).
 */
export function ubicaFila(fila, geo, tiendas) {
  if (!esCondado(fila["City or County"])) return null;
  const condado = String(fila["City or County"]).trim();
  const zona = zonaDelPermiso(fila["Permit #"]);
  if (geo && puntoCreible(zona, geo)) {
    const cerca = tiendaMasCercana(geo, tiendas);
    const ciudad = geo.ciudad ?? ciudadDelTexto(geo.texto);
    if (cerca) {
      return {
        _ciudad: ciudad, _pool: cerca.tienda, _como: "direccion",
        _nota: `${condado} permit, outside city limits. Located on the map by its jobsite streets${ciudad ? `: near ${ciudad}` : ""}, ${cerca.millas.toFixed(1)} mi from ${cerca.tienda}.`,
      };
    }
  }
  if (zona && TIENDA_DE_LA_ZONA[zona]) {
    return {
      _ciudad: null, _pool: TIENDA_DE_LA_ZONA[zona], _como: "zona",
      _nota: `${condado} permit, outside city limits. Cross streets not found on the map: assigned by county precinct ${zona}.`,
    };
  }
  return { _ciudad: null, _pool: "No store", _como: "nada", _nota: `${condado} permit, outside city limits. Location not found.` };
}

/** La pregunta al buscador: el cruce de la obra y el condado. */
export const consultaDe = (fila) => `${String(fila["Jobsite Address"] ?? "").trim()}, ${String(fila["City or County"]).trim()}, TX`;

async function geocodifica(q, llave) {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", q);
  url.searchParams.set("bounds", `${CONDADO.latMin},${CONDADO.lngMin}|${CONDADO.latMax},${CONDADO.lngMax}`);
  url.searchParams.set("components", "administrative_area:TX|country:US");
  url.searchParams.set("key", llave);
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const j = await r.json();
  if (j.status !== "OK" || !j.results?.length) return { estado: j.status ?? `HTTP ${r.status}` };
  const x = j.results[0];
  const parte = (tipo) => x.address_components?.find((c) => c.types?.includes(tipo))?.long_name ?? null;
  // Un resultado que es solo «el condado» o «Texas» no ubica nada.
  const vago = (x.types ?? []).some((t) => ["administrative_area_level_1", "administrative_area_level_2", "country"].includes(t));
  if (vago) return { estado: "VAGO" };
  return {
    estado: "OK", lat: x.geometry.location.lat, lng: x.geometry.location.lng,
    ciudad: parte("locality") ?? parte("sublocality") ?? parte("neighborhood"),
    exacto: !x.partial_match, tipo: (x.types ?? []).join(","), texto: x.formatted_address,
  };
}

const esPrincipal = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (esPrincipal) {
  const ruta = process.argv[2];
  if (!ruta) { console.error("uso: ubica-condado.mjs <report.json> [salida.json]"); process.exit(1); }
  const salida = process.argv[3] ?? ruta.replace(/\.json$/i, "") + ".ubicado.json";
  const rutaCache = ruta.replace(/\.json$/i, "") + ".geocache.json";
  const llave = process.env.GOOGLE_MAPS_API_KEY;
  if (!llave) { console.error("falta GOOGLE_MAPS_API_KEY (node --env-file=.env.local …)"); process.exit(1); }
  if (!process.env.SUPABASE_DB_URL) { console.error("falta SUPABASE_DB_URL (node --env-file=.env.local …)"); process.exit(1); }

  const require = createRequire(import.meta.url);
  const { Client } = require("pg");
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await c.connect();
  await c.query("set default_transaction_read_only = on");
  const { rows } = await c.query("select stores from public.settings where id = 1");
  await c.end();
  const tiendas = (rows[0]?.stores ?? []).map((s) => ({ name: s.name, lat: Number(s.lat), lng: Number(s.lng) }));

  const doc = JSON.parse(readFileSync(ruta, "utf8"));
  const cache = existsSync(rutaCache) ? JSON.parse(readFileSync(rutaCache, "utf8")) : {};
  const deCondado = doc.filas.filter((f) => esCondado(f["City or County"]));
  const consultas = [...new Set(deCondado.map(consultaDe))].filter((q) => !(q in cache));
  console.log(`Filas: ${doc.filas.length} · de condado: ${deCondado.length} · cruces distintos: ${new Set(deCondado.map(consultaDe)).size} · por preguntar: ${consultas.length}`);
  for (let i = 0; i < consultas.length; i += 5) {
    const tanda = consultas.slice(i, i + 5);
    const res = await Promise.all(tanda.map((q) => geocodifica(q, llave).catch((e) => ({ estado: "ERROR " + String(e?.message ?? e).slice(0, 60) }))));
    tanda.forEach((q, k) => { cache[q] = res[k]; });
    writeFileSync(rutaCache, JSON.stringify(cache, null, 1));
  }

  const cuenta = { direccion: 0, zona: 0, nada: 0 };
  const porPool = new Map(), descartados = [];
  for (const f of doc.filas) {
    if (!esCondado(f["City or County"])) continue;
    const g = cache[consultaDe(f)];
    const geo = g?.estado === "OK" ? g : null;
    const u = ubicaFila(f, geo, tiendas);
    Object.assign(f, u);
    cuenta[u._como]++;
    porPool.set(u._pool, (porPool.get(u._pool) ?? 0) + 1);
    if (geo && u._como !== "direccion") descartados.push(`${f["Permit #"]}: «${f["Jobsite Address"]}» → ${g.texto} (${g.lat.toFixed(3)}, ${g.lng.toFixed(3)}) no cuadra con el precinto ${zonaDelPermiso(f["Permit #"])}`);
  }
  writeFileSync(salida, JSON.stringify(doc, null, 0));
  console.log(`Ubicados por su dirección: ${cuenta.direccion} · por la zona del permiso: ${cuenta.zona} · sin ubicar: ${cuenta.nada}`);
  console.log("Por tienda (solo los de condado):", [...porPool].sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p} ${n}`).join(" · "));
  if (descartados.length) console.log(`Puntos descartados (${descartados.length}), hasta 12:\n  ` + descartados.slice(0, 12).join("\n  "));
  console.log("->", salida);
}
