import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  avisoDireccionIncompleta,
  avisoFueraDeLaRegion,
  direccionCompleta,
  direccionesARevisar,
  puntoDentroDeLaRegion,
} from "./direccion-completa";

// El dueño, 2026-10-18: «delivery address always need to be completed because right now a half saved delivery was 1500
// miles away s make that rule so that doesnt happens anymore». La #1071, «4408 QUEEN PALM», acabó en Florida a 1.788 km.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");

// Las tiendas como las de producción el 2026-10-18 (mediana en Pharr, 26.204 / −98.169).
const TIENDAS = [
  { name: "McAllen", lat: 26.2034, lng: -98.23 },
  { name: "Pharr", lat: 26.204, lng: -98.169 },
  { name: "Brownsville", lat: 25.929, lng: -97.489 },
];
const FLORIDA = { lat: 26.182, lng: -80.234 };
const MCALLEN = { lat: 26.2, lng: -98.23 };

describe("direccionCompleta — calle con número, ciudad y estado o código postal", () => {
  it("«4408 QUEEN PALM» (la #1071) está incompleta: le faltan la ciudad y el estado, no el número", () => {
    const c = direccionCompleta("4408 QUEEN PALM");
    expect(c.ok).toBe(false);
    expect(c.falta).toEqual(["ciudad", "estado"]);
    expect(c.soloCiudad).toBe(false);
  });
  it("«4408 Queen Palm Dr, McAllen, TX 78504» está completa", () => {
    expect(direccionCompleta("4408 Queen Palm Dr, McAllen, TX 78504")).toEqual({ ok: true, falta: [], soloCiudad: false });
  });
  it("el formato del buscador, con país («…, TX, USA»), y el de Nominatim con condado y código postal, valen", () => {
    expect(direccionCompleta("4408 Queen Palm Dr, McAllen, TX 78504, USA").ok).toBe(true);
    expect(direccionCompleta("123 Main St, Pharr, Hidalgo County, Texas, 78577, United States").ok).toBe(true);
    expect(direccionCompleta("123 Main St, McAllen, TX").ok).toBe(true);
    expect(direccionCompleta("123 Main St, McAllen 78501").ok).toBe(true);
  });
  it("la calle sin número falta «numero»; la ciudad sin estado ni código postal falta «estado»", () => {
    expect(direccionCompleta("Main St, Mission, TX").falta).toEqual(["numero"]);
    expect(direccionCompleta("123 Main St, Mission").falta).toEqual(["estado"]);
    expect(direccionCompleta("123 Main St, Mission").ok).toBe(false);
  });
  it("solo la ciudad («Mission, TX, USA») sigue valiendo (D-454), y se dice que es solo ciudad", () => {
    expect(direccionCompleta("Mission, TX, USA")).toEqual({ ok: true, falta: [], soloCiudad: true });
  });
  it("vacía o solo espacios: le falta todo", () => {
    expect(direccionCompleta("")).toEqual({ ok: false, falta: ["numero", "ciudad", "estado"], soloCiudad: false });
    expect(direccionCompleta("   ").ok).toBe(false);
    expect(direccionCompleta(null).ok).toBe(false);
  });
  it("el lote o el apartamento no cuentan como el número de la calle: «LOTE #24 9 W Robles, Edinburg, TX» vale y «LOTE #24, Edinburg, TX» no", () => {
    expect(direccionCompleta("LOTE #24 9 W Robles, Edinburg, TX").ok).toBe(true);
    expect(direccionCompleta("LOTE #24, Edinburg, TX").falta).toEqual(["numero"]);
  });
  it("tecleada sin comas: con una ciudad conocida que la cierre vale; sin ninguna, falta la ciudad (no se adivina, D-423)", () => {
    expect(direccionCompleta("4408 Queen Palm Dr McAllen TX 78504", ["McAllen"]).ok).toBe(true);
    expect(direccionCompleta("4408 Queen Palm Dr McAllen TX 78504").falta).toEqual(["ciudad"]);
  });
});

describe("puntoDentroDeLaRegion — el mismo radio de 300 km de D-580", () => {
  it("Florida (la #1071) cae fuera; McAllen cae dentro", () => {
    expect(puntoDentroDeLaRegion(FLORIDA.lat, FLORIDA.lng, TIENDAS)).toBe(false);
    expect(puntoDentroDeLaRegion(MCALLEN.lat, MCALLEN.lng, TIENDAS)).toBe(true);
  });
  it("sin punto, con NaN o en 0,0 no se decide: null (0,0 es «sin punto» desde D-219)", () => {
    expect(puntoDentroDeLaRegion(null, null, TIENDAS)).toBeNull();
    expect(puntoDentroDeLaRegion(26.2, undefined, TIENDAS)).toBeNull();
    expect(puntoDentroDeLaRegion(NaN, -98, TIENDAS)).toBeNull();
    expect(puntoDentroDeLaRegion(0, 0, TIENDAS)).toBeNull();
  });
  it("el radio es el de D-580: ~2,6° al norte (≈290 km) dentro, ~2,8° (≈311 km) fuera", () => {
    expect(puntoDentroDeLaRegion(26.204 + 2.6, -98.169, TIENDAS)).toBe(true);
    expect(puntoDentroDeLaRegion(26.204 + 2.8, -98.169, TIENDAS)).toBe(false);
  });
  it("sin tiendas con punto, el centro es el de la zona local: McAllen dentro, Florida fuera", () => {
    expect(puntoDentroDeLaRegion(MCALLEN.lat, MCALLEN.lng, [])).toBe(true);
    expect(puntoDentroDeLaRegion(FLORIDA.lat, FLORIDA.lng, [])).toBe(false);
  });
});

describe("direccionesARevisar — qué tecleó una persona y qué punto vale", () => {
  const reglas = { Intertienda: { storeToStore: true }, Entrega: {} } as never;
  const base = { order_type: "Entrega", store: "McAllen", pickup_name: "McAllen", pickup_address: "1 Store Rd, McAllen, TX" };
  const DIR = "4408 Queen Palm Dr, McAllen, TX 78504";

  it("entrega a cliente sin punto: se revisa y hay que geocodificarla; la recogida en tienda no sale", () => {
    const r = direccionesARevisar({ ...base, delivery_address: DIR }, null, TIENDAS, reglas);
    expect(r).toEqual([{ que: "entrega", texto: DIR, punto: null, geocodificar: true }]);
  });
  it("con punto geocodificado y la MISMA dirección de antes, vale ese punto y no se busca otra vez", () => {
    const fila = { ...base, delivery_address: DIR, delivery_lat: 26.2, delivery_lng: -98.23, delivery_pin_source: "geocoded" as const };
    const r = direccionesARevisar(fila, { ...fila }, TIENDAS, reglas);
    expect(r[0]).toMatchObject({ punto: { lat: 26.2, lng: -98.23 }, geocodificar: false });
  });
  it("con punto geocodificado pero la dirección CAMBIÓ, el punto viejo no vale: se geocodifica de nuevo", () => {
    const fila = { ...base, delivery_address: DIR, delivery_lat: 26.2, delivery_lng: -98.23, delivery_pin_source: "geocoded" as const };
    const r = direccionesARevisar(fila, { ...fila, delivery_address: "1 Other St, Pharr, TX" }, TIENDAS, reglas);
    expect(r[0]).toMatchObject({ punto: null, geocodificar: true });
  });
  it("el pin puesto a mano vale aunque la dirección cambie (lo puso una persona, D-221)", () => {
    const fila = { ...base, delivery_address: DIR, delivery_lat: 26.2, delivery_lng: -98.23, delivery_pin_source: "manual" as const };
    const r = direccionesARevisar(fila, { ...fila, delivery_address: "1 Other St, Pharr, TX" }, TIENDAS, reglas);
    expect(r[0]).toMatchObject({ punto: { lat: 26.2, lng: -98.23 }, geocodificar: false });
  });
  it("un punto en 0,0 no vale como punto", () => {
    const fila = { ...base, delivery_address: DIR, delivery_lat: 0, delivery_lng: 0, delivery_pin_source: "geocoded" as const };
    expect(direccionesARevisar(fila, { ...fila }, TIENDAS, reglas)[0]).toMatchObject({ punto: null, geocodificar: true });
  });
  it("intertienda: la dirección de entrega la pone Ajustes y no se revisa", () => {
    const r = direccionesARevisar({ ...base, order_type: "Intertienda", delivery_address: "3000 Central Blvd" }, null, TIENDAS, reglas);
    expect(r).toEqual([]);
  });
  it("sin dirección de entrega no sale nada: la vacía la cubre missingFields y el borrador puede no tenerla", () => {
    expect(direccionesARevisar({ ...base, delivery_address: "  " }, null, TIENDAS, reglas)).toEqual([]);
  });
  it("recogida que NO es tienda: se revisa y se geocodifica si es nueva o cambió; igual que antes, no se vuelve a buscar", () => {
    const fila = { ...base, pickup_name: "Bodega Reynosa", pickup_address: "500 Industrial, Pharr, TX", delivery_address: DIR };
    const nueva = direccionesARevisar(fila, null, TIENDAS, reglas);
    expect(nueva.map((x) => x.que)).toEqual(["entrega", "recogida"]);
    expect(nueva[1]).toEqual({ que: "recogida", texto: "500 Industrial, Pharr, TX", punto: null, geocodificar: true });
    const igual = direccionesARevisar(fila, { ...fila }, TIENDAS, reglas);
    expect(igual[1].geocodificar).toBe(false);
  });
});

describe("los avisos dicen qué falta, en los dos idiomas", () => {
  it("incompleta: nombra la dirección y lo que falta", () => {
    const es = avisoDireccionIncompleta("entrega", ["ciudad", "estado"], "es");
    expect(es).toContain("dirección de entrega");
    expect(es).toContain("ciudad, estado o código postal");
    const en = avisoDireccionIncompleta("recogida", ["numero"], "en");
    expect(en).toContain("pickup address");
    expect(en).toContain("street with number");
  });
  it("fuera de la región: dice que cayó fuera y que no se guardó", () => {
    expect(avisoFueraDeLaRegion("entrega", "es")).toMatch(/fuera de la región.*No se guardó/);
    expect(avisoFueraDeLaRegion("recogida", "en")).toMatch(/outside the region.*Not saved/);
  });
});

describe("la ficha y el proveedor pasan por la regla (lectura del fuente)", () => {
  const modal = leer("src/components/OrderModal.tsx");
  const proveedor = leer("src/lib/data-provider.tsx");

  it("el guardado de la ficha revisa las direcciones ANTES de escribir, y el Enviar de un borrador también", () => {
    const guardar = modal.indexOf("const save = async () => {");
    const addDel = modal.indexOf("const row = await addDelivery(payload);");
    const revision = modal.indexOf("await direccionesValidas(payload", guardar);
    expect(guardar).toBeGreaterThan(0);
    expect(revision).toBeGreaterThan(guardar);
    expect(revision).toBeLessThan(addDel);
    // Y si no pasan, NO se escribe: el corte está entre la revisión y la escritura.
    const corte = modal.indexOf("if (!direcciones.ok) return;", revision);
    expect(corte).toBeGreaterThan(revision);
    expect(corte).toBeLessThan(addDel);
    const move = modal.indexOf("const move = async (to: Stage");
    const setStage = modal.indexOf("await setStage(existing.id, to, note, extra)", move);
    const puerta = modal.indexOf("direccionesCompletasDe(existing)", move);
    expect(puerta).toBeGreaterThan(move);
    expect(puerta).toBeLessThan(setStage);
  });
  it("la ficha bloquea por incompleta y por fuera de la región, con los avisos de este módulo", () => {
    // DOS puertas (guardar y Enviar), y las dos CORTAN tras avisar: un «avisa pero sigue» en una sola no pasa.
    const incompleta = modal.match(/if \(!c\.ok\) \{ notify\(avisoDireccionIncompleta\(r\.que, c\.falta, lang\)\); return (?:false|\{ ok: false \}); \}/g) ?? [];
    expect(incompleta).toHaveLength(2);
    const fuera = modal.match(/puntoDentroDeLaRegion\([^)]*\) === false\) \{ notify\(avisoFueraDeLaRegion\(r\.que, lang\)\); return (?:false|\{ ok: false \}); \}/g) ?? [];
    expect(fuera).toHaveLength(2);
  });
  it("el proveedor NO escribe un punto geocodificado que caiga fuera de la región (respaldo para el CSV y cualquier otra escritura)", () => {
    const ubicar = proveedor.indexOf("const ubicarSiHaceFalta = useCallback(");
    const escribe = proveedor.indexOf("parcheDeUbicacion(resultado)", ubicar);
    const filtro = proveedor.indexOf("puntoDentroDeLaRegion(resultado.lat, resultado.lng, settings.stores) === false", ubicar);
    expect(filtro).toBeGreaterThan(ubicar);
    expect(filtro).toBeLessThan(escribe);
    expect(proveedor.slice(filtro, escribe)).toContain("EVENTO_FUERA_DE_REGION");
  });
});
