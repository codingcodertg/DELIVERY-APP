"use client";

import { useState } from "react";
import { AddressInput } from "@/components/AddressInput";
import { MapView } from "@/components/MapView";
import { FeeBreakdownDetails } from "@/components/FeeBreakdown";
import { CampoDecimal } from "@/components/CampoDecimal";
import { LOCAL_ZONE_LATLNG } from "@/lib/delivery-zone";
import { useStoreMarkers } from "@/lib/useStoreMarkers";
import { tiendasParaElMapa } from "@/lib/store-pins";
import { fmtMoney } from "@/lib/utils";
import type { Delivery } from "@/lib/estimator/modelo";
import {
  alternarCargo, bajoElDescuento, conDireccion, conTienda, origenDeLasMillas, pedirMillas, tarifaDeLaCotizacion,
  type AjustesDeEntrega,
} from "@/lib/estimator/entrega";

type T = (en: string, es: string) => string;

/**
 * La entrega de la cotización (D-NEXT): la búsqueda de dirección, el pin del mapa y la calculadora de tarifa **de la
 * ficha de Entregas**, con sus piezas — `AddressInput`, `MapView` con la zona verde (`LOCAL_ZONE_LATLNG`) y las tiendas
 * (`useStoreMarkers` + `tiendasParaElMapa`), `/api/reverse-geocode` al soltar el pin, `/api/distance` con el botón, y
 * `suggestDeliveryFee` (vía `tarifaDeLaCotizacion`) para la lista, el descuento, la zona y el aviso de aprobación.
 *
 * **Todo esto es solo para el vendedor.** No está dentro de `.hoja-cliente`, así que al imprimir lo esconde el
 * `@media print` de `estimator.css`, y `hojaDelCliente` no lee nada de aquí salvo el modo (D-413).
 */
export function EntregaCotizacion({ entrega, onEntrega, ajustes, admin, t }: {
  entrega: Delivery;
  onEntrega: (d: Delivery) => void;
  ajustes: AjustesDeEntrega;
  /** La fórmula («¿Cómo se calculó?») solo la ve un admin, como en la ficha (D-244, T-0049). */
  admin: boolean;
  t: T;
}) {
  const [mapaAbierto, setMapaAbierto] = useState(false);
  /** El pin que había al abrir el mapa: «Cancelar» lo devuelve. */
  const [pinAlAbrir, setPinAlAbrir] = useState<Pick<Delivery, "lat" | "lng" | "pin_source"> | null>(null);
  const [buscandoDireccion, setBuscandoDireccion] = useState(false);
  const [calculando, setCalculando] = useState(false);
  const [errorRuta, setErrorRuta] = useState("");

  const tiendas = useStoreMarkers(ajustes.stores);
  const tiendasConPapel = tiendasParaElMapa(tiendas, entrega.store);
  const tarifa = tarifaDeLaCotizacion(entrega, ajustes);
  const pin: [number, number] | null = entrega.lat != null && entrega.lng != null ? [entrega.lat, entrega.lng] : null;

  // De dónde sale la zona, como en la ficha: un «No local» sin motivo no distingue «sin pin» de «lejos de verdad».
  const porQue = tarifa.zoneSource === "pin"
    ? t("from the map pin", "por el pin del mapa")
    : tarifa.zoneSource === "city"
      ? t(`from the address city (${tarifa.city || "not recognized"}) — no pin`, `por la ciudad de la dirección (${tarifa.city || "no reconocida"}) — sin pin`)
      : "";

  /** Soltar el pin (clic derecho) lo pone y rellena la dirección con la del punto, como `dropPin` de la ficha. */
  const soltarPin = async (lat: number, lng: number) => {
    const conPin: Delivery = { ...entrega, lat, lng, pin_source: "manual" };
    onEntrega(conPin);
    setBuscandoDireccion(true);
    try {
      const res = await fetch("/api/reverse-geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lng }),
      });
      if (res.ok) {
        const body = await res.json();
        if (typeof body.address === "string" && body.address) onEntrega(conDireccion(conPin, body.address));
      }
    } catch { /* lo mejor posible: el pin ya está puesto */ }
    setBuscandoDireccion(false);
  };

  const calcular = async () => {
    setErrorRuta("");
    const origen = origenDeLasMillas(entrega.store, ajustes.stores);
    if (!origen) { setErrorRuta(t("Pick the store the truck leaves from first.", "Elige primero la tienda de la que sale el camión.")); return; }
    if (!entrega.address.trim()) { setErrorRuta(t("Add a delivery address first.", "Agrega primero una dirección de entrega.")); return; }
    setCalculando(true);
    const r = await pedirMillas(origen, entrega.address);
    setCalculando(false);
    if (r.ok) onEntrega({ ...entrega, miles: r.miles });
    else setErrorRuta(r.error === "red" ? t("Network error — is the machine online?", "Error de red — ¿la máquina está en línea?") : t("Could not calculate route.", "No se pudo calcular la ruta."));
  };

  const hayPrecio = tarifa.list != null || tarifa.discount != null;

  return (
    <div data-entrega-cotizacion>
      <div className="grid g3">
        <div style={{ gridColumn: "1 / -1" }} data-direccion-entrega>
          <AddressInput
            label={t("Delivery address", "Dirección de entrega")}
            value={entrega.address}
            onChange={(v) => onEntrega(conDireccion(entrega, v))}
            placeholder={t("Search the address…", "Buscar la dirección…")}
            invalid={!entrega.address.trim()}
          />
        </div>
        <div className="field">
          <label htmlFor="est-tienda">{t("Truck leaves from (store)", "Sale de la tienda")}</label>
          <select id="est-tienda" data-tienda-salida value={entrega.store} onChange={(e) => onEntrega(conTienda(entrega, e.target.value))}>
            <option value="">{t("Select store", "Seleccione tienda")}</option>
            {ajustes.stores.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </div>
      </div>

      <div className="est-acciones" style={{ marginTop: 4, marginBottom: mapaAbierto ? 8 : 0 }}>
        <button className="btn btn-ghost btn-sm" data-abrir-mapa onClick={() => {
          if (!mapaAbierto) setPinAlAbrir({ lat: entrega.lat, lng: entrega.lng, pin_source: entrega.pin_source });
          setMapaAbierto((v) => !v);
        }}>
          📍 {t("Set exact location on map", "Marcar ubicación exacta en el mapa")}
        </button>
        {buscandoDireccion ? <span className="hint">{t("Looking up the address…", "Buscando la dirección…")}</span>
          : pin && <span className="hint" data-pin-puesto>{t("Pin set.", "Pin marcado.")}</span>}
      </div>
      {mapaAbierto && (
        <div className="card" style={{ marginBottom: 12 }} data-mapa-entrega>
          <div className="hint" style={{ marginBottom: 8 }}>
            {t("Move the mouse to preview the spot, then right-click to drop the pin.", "Mueva el mouse para previsualizar el punto y haga clic derecho para marcarlo.")}
          </div>
          <MapView
            pickable
            zone={LOCAL_ZONE_LATLNG}
            stores={tiendasConPapel}
            pickedPoint={pin}
            center={pin ?? undefined}
            onPick={(lat, lng) => void soltarPin(lat, lng)}
            height={280}
          />
          <div className="est-acciones" style={{ marginTop: 10 }}>
            <button className="btn btn-primary btn-sm" data-pin-listo onClick={() => setMapaAbierto(false)}>{t("Save pin", "Guardar pin")}</button>
            {pin && (
              <button className="btn btn-ghost btn-sm" onClick={() => { onEntrega({ ...entrega, lat: null, lng: null, pin_source: null }); setMapaAbierto(false); }}>
                {t("Clear pin", "Quitar pin")}
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => { if (pinAlAbrir) onEntrega({ ...entrega, ...pinAlAbrir }); setMapaAbierto(false); }}>
              {t("Cancel", "Cancelar")}
            </button>
          </div>
        </div>
      )}

      {/* La calculadora: a pedido, con el botón. `/api/distance` llama a Google Routes y gasta cuota. */}
      <div className="card" style={{ marginTop: 8, padding: 10 }} data-calculadora>
        <div className="est-acciones">
          <button className="btn btn-ghost" data-calcular onClick={() => void calcular()} disabled={calculando}>
            {calculando ? t("Calculating…", "Calculando…") : t("🚚 Calculate distance & fee", "🚚 Calcular distancia y tarifa")}
          </button>
          <span className="hint" style={{ margin: 0 }}>{t("Route Miles", "Millas")}: <b data-millas>{entrega.miles != null ? `${entrega.miles} mi` : "—"}</b></span>
        </div>
        {errorRuta && <div className="hint" style={{ color: "var(--red)" }} data-error-ruta>{errorRuta}</div>}
        {entrega.address.trim() && (
          <div className="est-acciones" style={{ marginTop: 8 }} data-zona={tarifa.zone}>
            <span className="sema" style={{ background: tarifa.zone === "local" ? "var(--green)" : "var(--red)", color: "#fff" }}>
              {tarifa.zone === "local" ? t("LOCAL", "LOCAL") : t("NOT LOCAL", "NO LOCAL")}
            </span>
            {porQue && <span className="hint" style={{ margin: 0, opacity: 0.85 }}>{porQue}</span>}
          </div>
        )}
        {hayPrecio ? (
          <div className="est-acciones" style={{ marginTop: 8 }} data-tarifa-sugerida>
            <span className="hint" style={{ margin: 0 }}>{t("Suggested fee:", "Tarifa sugerida:")}</span>
            {tarifa.list != null && (
              <button type="button" data-tarifa-lista className={"btn btn-sm " + (entrega.charge === tarifa.list ? "btn-primary" : "btn-ghost")}
                onClick={() => onEntrega(alternarCargo(entrega, tarifa.list!))}>
                {entrega.charge === tarifa.list ? "✓ " : ""}{t("List", "Lista")} {fmtMoney(tarifa.list)}
              </button>
            )}
            {tarifa.discount != null && (
              <button type="button" data-tarifa-descuento className={"btn btn-sm " + (entrega.charge === tarifa.discount ? "btn-primary" : "btn-ghost")}
                onClick={() => onEntrega(alternarCargo(entrega, tarifa.discount!))}>
                {entrega.charge === tarifa.discount ? "✓ " : ""}{t("Discount", "Descuento")} {fmtMoney(tarifa.discount)}
              </button>
            )}
          </div>
        ) : entrega.address.trim() ? (
          <div className="hint" style={{ marginTop: 6 }}>{t("Calculate the route to price this delivery by miles.", "Calcula la ruta para cotizar esta entrega por millas.")}</div>
        ) : null}
        {admin && tarifa.breakdown && <FeeBreakdownDetails desglose={tarifa.breakdown} />}
        {tarifa.needsApproval && entrega.address.trim() && (
          <div className="hint" style={{ color: "var(--amber)", fontWeight: 600, marginTop: 6 }} data-no-local>
            ⚠ {t("Not local — requires manager approval.", "No local — requiere aprobación del gerente.")}
          </div>
        )}
        {tarifa.sameDay && (
          <div className="hint" style={{ color: "var(--amber)", fontWeight: 600, marginTop: 6 }}>
            ⚡ {t(`Same-day delivery — includes ${fmtMoney(tarifa.sameDaySurcharge)} surcharge.`, `Entrega mismo día — incluye recargo de ${fmtMoney(tarifa.sameDaySurcharge)}.`)}
          </div>
        )}
        {bajoElDescuento(entrega.charge, tarifa) && (
          <div className="hint" style={{ color: "var(--amber)", fontWeight: 600, marginTop: 6 }} data-bajo-descuento>
            ⚠ {t("Price match (below discount) — requires approval.", "Igualar precio (menor al descuento) — requiere aprobación.")}
          </div>
        )}
        <div className="field" style={{ marginTop: 10, maxWidth: 260 }}>
          <label>{t("Delivery charge (internal)", "Cargo de entrega (interno)")}</label>
          <CampoDecimal value={entrega.charge} data-cargo onValor={(n) => onEntrega({ ...entrega, charge: n })} />
        </div>
      </div>
      <p className="hint" style={{ margin: "6px 0 0" }}>
        {t("Only you see the address, the pin, the miles and the fees. The address is not printed and the charge is NOT added to the total. The customer reads: “Delivery: Available upon request…”.",
          "Solo tú ves la dirección, el pin, las millas y las tarifas. La dirección no se imprime y el cargo NO se suma al total. El cliente lee: «Delivery: Available upon request…».")}
      </p>
    </div>
  );
}
