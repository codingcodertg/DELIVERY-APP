#!/usr/bin/env node
// SOLO LECTURA (GET por PostgREST, service-role). Inventario de lo que podía estirar el encuadre del mapa (D-580,
// «Map defaults to a zoomed out view instead of viewing the region», 2026-10-18):
//   1. tiendas de Ajustes con punto, y su centro (mediana);
//   2. órdenes con fecha de entrega de hoy ±7 días cuyo punto es 0,0, no numérico o cae a >300 km del centro;
//   3. la última posición de cada chofer, con su distancia al centro y su antigüedad.
// Uso: node scripts/_inv-encuadre-del-mapa.mjs   (lee .env.local desde la raíz; no escribe nada)
import { cargaEntorno } from "./db/ledger.mjs";

cargaEntorno();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY"); process.exit(2); }

async function get(path) {
  const r = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}
const km = (a, b) => {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)));
};
const mediana = (xs) => { const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mala = (lat, lng) => lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0);

const [settings] = await get("settings?select=stores&limit=1");
const tiendas = (settings?.stores ?? []).filter((s) => !mala(s.lat, s.lng));
console.log(`Tiendas en Ajustes: ${(settings?.stores ?? []).length}, con punto: ${tiendas.length}`);
for (const s of settings?.stores ?? []) console.log(`  ${s.name}: ${s.lat ?? "—"}, ${s.lng ?? "—"}`);
const centro = tiendas.length
  ? { lat: mediana(tiendas.map((s) => s.lat)), lng: mediana(tiendas.map((s) => s.lng)) }
  : { lat: 26.16, lng: -97.82 };
console.log(`Centro (mediana): ${centro.lat}, ${centro.lng}${tiendas.length ? "" : " (sin tiendas: el de la zona local)"}`);
for (const s of tiendas) { const d = km(centro, s); if (d > 300) console.log(`  !! tienda a ${d} km del centro: ${s.name}`); }

const hoy = new Date(); const d0 = new Date(hoy); d0.setDate(d0.getDate() - 7); const d1 = new Date(hoy); d1.setDate(d1.getDate() + 7);
const iso = (d) => d.toISOString().slice(0, 10);
const ordenes = await get(`deliveries?select=id,order_no,delivery_date,delivery_lat,delivery_lng,delivery_address,assigned_driver,stage&delivery_date=gte.${iso(d0)}&delivery_date=lte.${iso(d1)}&delivery_lat=not.is.null&limit=5000`);
let ceros = 0, lejos = 0;
for (const o of ordenes) {
  const { delivery_lat: lat, delivery_lng: lng } = o;
  if (mala(lat, lng)) { ceros++; console.log(`  0,0/NaN: #${o.order_no} ${o.delivery_date} ${o.stage} ${o.assigned_driver ?? "—"} «${o.delivery_address ?? ""}»`); continue; }
  const d = km(centro, { lat, lng });
  if (d > 300) { lejos++; console.log(`  ${d} km: #${o.order_no} ${o.delivery_date} ${o.stage} ${o.assigned_driver ?? "—"} (${lat}, ${lng}) «${o.delivery_address ?? ""}»`); }
}
console.log(`Órdenes ${iso(d0)}..${iso(d1)} con punto: ${ordenes.length}; en 0,0/NaN: ${ceros}; a >300 km del centro: ${lejos}`);

const pos = await get("driver_locations?select=driver_id,lat,lng,accuracy_m,recorded_at&order=recorded_at.desc&limit=2000");
const ultima = new Map();
for (const p of pos) if (!ultima.has(p.driver_id)) ultima.set(p.driver_id, p);
console.log(`Choferes con posición (últimas ${pos.length} filas): ${ultima.size}`);
for (const [id, p] of ultima) {
  const min = Math.round((Date.now() - new Date(p.recorded_at).getTime()) / 60000);
  const d = mala(p.lat, p.lng) ? "0,0" : `${km(centro, p)} km`;
  console.log(`  ${id.slice(0, 8)}: ${d} del centro, hace ${min} min, ±${p.accuracy_m ?? "?"} m`);
}
