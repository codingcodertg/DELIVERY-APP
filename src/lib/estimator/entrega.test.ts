import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { suggestDeliveryFee } from "@/lib/pricing";
import { demoSettings } from "@/lib/demo-data";
import {
  alternarCargo, bajoElDescuento, conDireccion, conTienda, origenDeLasMillas, pedirMillas, tarifaDeLaCotizacion, tiendaDePartida,
} from "./entrega";
import { entregaVacia, type Delivery } from "./modelo";

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const ajustes = demoSettings();
const entrega = (patch: Partial<Delivery> = {}): Delivery => ({
  ...entregaVacia(), mode: "delivery", address: "2400 N 10th St, McAllen, TX 78501", store: "Pharr", ...patch,
});

describe("la tarifa de la cotización es la de la ficha de Entregas (suggestDeliveryFee), no una copia", () => {
  it("mismo resultado que una orden con esa dirección, esas millas y ese pin", () => {
    for (const d of [
      entrega({ miles: 8 }), entrega({ miles: 23.7 }), entrega({ miles: 64 }),
      entrega({ miles: 23.7, address: "1 Main St, Laredo, TX 78040" }),
      entrega({ miles: 23.7, lat: 26.2461, lng: -98.2297, pin_source: "manual" }),
    ]) {
      expect(tarifaDeLaCotizacion(d, ajustes)).toEqual(suggestDeliveryFee(
        { delivery_address: d.address, route_miles: d.miles, delivery_lat: d.lat, delivery_lng: d.lng, delivery_date: null }, ajustes,
      ));
    }
  });
  it("con millas da lista y descuento, y el descuento es más barato (D-317)", () => {
    const s = tarifaDeLaCotizacion(entrega({ miles: 23.7 }), ajustes);
    // Local, tramo del medio: lista round5(105 + 23.7·0.8) = 125; descuento round5(100 + 23.7·0.8) = 120.
    expect([s.zone, s.list, s.discount]).toEqual(["local", 125, 120]);
  });
  it("sin millas no hay precio todavía, pero sí zona", () => {
    const s = tarifaDeLaCotizacion(entrega(), ajustes);
    expect([s.list, s.discount, s.zone]).toEqual([null, null, "local"]);
  });
  it("fuera de zona pide aprobación del gerente, como en la ficha", () => {
    const s = tarifaDeLaCotizacion(entrega({ miles: 150, address: "1 Main St, Laredo, TX 78040" }), ajustes);
    expect([s.zone, s.needsApproval, s.list, s.discount]).toEqual(["nonlocal", true, 620, 520]);
  });
  it("el pin manda sobre la ciudad (D-219): un punto dentro de la zona verde es LOCAL aunque la dirección diga Laredo", () => {
    const s = tarifaDeLaCotizacion(entrega({ address: "1 Main St, Laredo, TX 78040", lat: 26.2461, lng: -98.2297 }), ajustes);
    expect([s.zone, s.zoneSource]).toEqual(["local", "pin"]);
  });
  it("sin fecha de entrega no hay recargo de mismo día, aunque Ajustes tenga uno", () => {
    const s = tarifaDeLaCotizacion(entrega({ miles: 23.7 }), { ...ajustes, same_day_surcharge: 40 });
    expect([s.sameDay, s.list]).toEqual([false, 125]);
  });
  it("recogiendo no hay tarifa", () => {
    const s = tarifaDeLaCotizacion(entrega({ mode: "pickup", miles: 23.7 }), ajustes);
    expect([s.list, s.discount, s.zone]).toEqual([null, null, "unknown"]);
  });
});

describe("los botones y el aviso de aprobación", () => {
  it("pulsar Descuento pone ese importe en el cargo; pulsarlo otra vez lo quita", () => {
    const d = alternarCargo(entrega({ miles: 23.7 }), 120);
    expect(d.charge).toBe(120);
    expect(alternarCargo(d, 120).charge).toBeNull();
    expect(alternarCargo(d, 125).charge).toBe(125);
  });
  it("por debajo del descuento pide aprobación; igual o por encima, no", () => {
    expect(bajoElDescuento(115, { discount: 120 })).toBe(true);
    expect(bajoElDescuento(120, { discount: 120 })).toBe(false);
    expect(bajoElDescuento(125, { discount: 120 })).toBe(false);
    expect(bajoElDescuento(null, { discount: 120 })).toBe(false);
    expect(bajoElDescuento(50, { discount: null })).toBe(false);
  });
});

describe("las millas: de la tienda a la dirección, y solo con el botón", () => {
  it("el origen es la dirección de la tienda, o su nombre si no tiene", () => {
    expect(origenDeLasMillas("Pharr", ajustes.stores)).toBe("1201 W US-83, Pharr TX");
    expect(origenDeLasMillas("Sin Direccion", [{ name: "Sin Direccion", address: "" }])).toBe("Sin Direccion");
    expect(origenDeLasMillas("", ajustes.stores)).toBe("");
  });
  it("cambiar la dirección o la tienda borra las millas (serían de otro viaje); escribir lo mismo no", () => {
    const d = entrega({ miles: 23.7 });
    expect(conDireccion(d, "1 Main St, Pharr, TX").miles).toBeNull();
    expect(conDireccion(d, d.address).miles).toBe(23.7);
    expect(conTienda(d, "McAllen").miles).toBeNull();
    expect(conTienda(d, "Pharr").miles).toBe(23.7);
  });
  it("la tienda de partida es la del perfil si existe en Ajustes; si no, ninguna", () => {
    expect(tiendaDePartida(" pharr ", ajustes.stores)).toBe("Pharr");
    expect(tiendaDePartida("Laredo", ajustes.stores)).toBe("");
    expect(tiendaDePartida(null, ajustes.stores)).toBe("");
  });
  it("pedirMillas hace UNA llamada a /api/distance con origen y destino", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ miles: 23.7 }), { status: 200 }));
    expect(await pedirMillas("1201 W US-83, Pharr TX", "2400 N 10th St, McAllen", f as unknown as typeof fetch)).toEqual({ ok: true, miles: 23.7 });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/distance");
    expect(JSON.parse(String(init.body))).toEqual({ origin: "1201 W US-83, Pharr TX", destination: "2400 N 10th St, McAllen" });
  });
  it("sin origen o sin destino no llama (no gasta cuota); un error se devuelve, no se inventan millas", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await pedirMillas("", "x", f as unknown as typeof fetch)).toEqual({ ok: false, error: "sin-origen" });
    expect(await pedirMillas("x", " ", f as unknown as typeof fetch)).toEqual({ ok: false, error: "sin-destino" });
    expect(f).not.toHaveBeenCalled();
    const mal = vi.fn(async () => new Response(JSON.stringify({ error: "No route" }), { status: 502 }));
    expect(await pedirMillas("a", "b", mal as unknown as typeof fetch)).toEqual({ ok: false, error: "No route" });
    const sinMillas = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    expect(await pedirMillas("a", "b", sinMillas as unknown as typeof fetch)).toEqual({ ok: false, error: "sin-millas" });
  });
});

describe("la pantalla usa estas piezas, las de la ficha de Entregas", () => {
  const pantalla = leer("src/app/estimator/Estimador.tsx");
  const entregaUi = leer("src/app/estimator/EntregaCotizacion.tsx");
  it("con Delivery, el Estimador pinta EntregaCotizacion, y ya no los cuatro campos de calle/ciudad/estado/zip", () => {
    expect(pantalla).toContain('{draft.delivery.mode === "delivery" && (\n          <EntregaCotizacion entrega={draft.delivery} onEntrega={ponEntrega} ajustes={ajustes} admin={me.admin} t={t} />');
    for (const viejo of ["data-calle", "data-ciudad", "data-estado", "data-zip"]) expect(pantalla).not.toContain(viejo);
  });
  it("la dirección se busca con AddressInput, y teclear pasa por conDireccion (borra las millas)", () => {
    expect(entregaUi).toContain('import { AddressInput } from "@/components/AddressInput";');
    expect(entregaUi).toContain("onChange={(v) => onEntrega(conDireccion(entrega, v))}");
  });
  it("el mapa es MapView con la zona verde y las tiendas, y el clic derecho suelta el pin", () => {
    expect(entregaUi).toMatch(/<MapView\s+pickable\s+zone=\{LOCAL_ZONE_LATLNG\}\s+stores=\{tiendasConPapel\}/);
    expect(entregaUi).toContain("onPick={(lat, lng) => void soltarPin(lat, lng)}");
    expect(entregaUi).toContain('fetch("/api/reverse-geocode"');
  });
  it("la tarifa sale de tarifaDeLaCotizacion y los botones pasan por alternarCargo", () => {
    expect(entregaUi).toContain("const tarifa = tarifaDeLaCotizacion(entrega, ajustes);");
    expect(entregaUi).toContain("onClick={() => onEntrega(alternarCargo(entrega, tarifa.list!))}");
    expect(entregaUi).toContain("onClick={() => onEntrega(alternarCargo(entrega, tarifa.discount!))}");
    expect(entregaUi).toContain("{bajoElDescuento(entrega.charge, tarifa) && (");
    expect(entregaUi).toContain("{tarifa.needsApproval && entrega.address.trim() && (");
  });
  it("las millas (Google) solo con el botón: pedirMillas está dentro de calcular y en ningún efecto", () => {
    expect(entregaUi).toContain("const r = await pedirMillas(origen, entrega.address);");
    expect(entregaUi.match(/pedirMillas\(/g) ?? []).toHaveLength(1);
    expect(entregaUi).not.toContain("useEffect");
    expect(entregaUi).toContain("data-calcular onClick={() => void calcular()}");
  });
  it("la fórmula solo para admin (D-244)", () => {
    expect(entregaUi).toContain("{admin && tarifa.breakdown && <FeeBreakdownDetails desglose={tarifa.breakdown} />}");
  });
});
