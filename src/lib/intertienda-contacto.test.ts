import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { eligeDestino, eligeOrigen, opcionesDeOrigen } from "./order-endpoints";
import {
  aplicaTipo, borradorDeReentrega, borradorInicial, conContactoDeOrigen, contactoEsLaTiendaDeOrigen,
  escrituraConContactoDeOrigen, type ContextoDelUsuario,
} from "./order-sites";
import type { Delivery, NamedLocation, OrderTypeRule } from "./types";

/**
 * En Intertienda el contacto es la tienda que envía (D-282).
 *
 * Los borradores se arman con los manejadores del modal, compuestos como los compone él. Las reglas son
 * las de producción; los nombres de tienda, neutros.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");

const REGLAS: Record<string, OrderTypeRule> = {
  Intertienda: { docRef: "po", storeToStore: true, homeIsDestination: true },
  Transfer: { docRef: "estimate", storeToStore: true },
  Customer: { docRef: "invoice", storeToStore: false },
};
const TIENDAS: NamedLocation[] = [
  { name: "Tienda Norte", address: "100 Norte Ave, Ciudad TX" },
  { name: "Tienda Sur", address: "200 Sur Blvd, Ciudad TX" },
  { name: "Tienda Este", address: "300 Este Rd, Ciudad TX" },
];
const [NORTE, SUR, ESTE] = TIENDAS;
const GERENTE: ContextoDelUsuario = { rol: "manager", miTienda: NORTE.name, tipos: ["Customer", "Intertienda", "Transfer"], tiendas: TIENDAS, reglas: REGLAS };

/** Los dos manejadores, compuestos como los compone el modal. */
const eligeContacto = (p: Partial<Delivery>, v: string) => conContactoDeOrigen(eligeOrigen(p, v, TIENDAS), REGLAS);
const eligeDestinoEnModal = (p: Partial<Delivery>, v: string) => conContactoDeOrigen(eligeDestino(p, v, TIENDAS), REGLAS);

describe("qué tipos tienen el contacto en la tienda de origen", () => {
  it("el que es tienda-a-tienda y recibe: Intertienda sí, Transfer no, Customer no", () => {
    expect(contactoEsLaTiendaDeOrigen("Intertienda", REGLAS)).toBe(true);
    expect(contactoEsLaTiendaDeOrigen("Transfer", REGLAS)).toBe(false);
    expect(contactoEsLaTiendaDeOrigen("Customer", REGLAS)).toBe(false);
    expect(contactoEsLaTiendaDeOrigen(null, REGLAS)).toBe(false);
  });
});

describe("el borrador, con los manejadores del modal", () => {
  it("elegir el contacto elige la tienda de origen, con su recogida", () => {
    const abierto = borradorInicial({}, GERENTE); // gerente: Intertienda, destino su tienda, origen por elegir
    const d = eligeContacto(abierto, SUR.name);
    expect(d.store).toBe(SUR.name);
    expect(d.contact).toBe(SUR.name);
    expect(d.pickup_name).toBe(SUR.name);
    expect(d.pickup_address).toBe(SUR.address);
  });

  it("elegir el destino ya no pisa el contacto: sigue siendo la tienda que envía", () => {
    const d = eligeDestinoEnModal(eligeContacto(borradorInicial({}, GERENTE), SUR.name), ESTE.name);
    expect(d.delivery_name).toBe(ESTE.name);
    expect(d.contact).toBe(SUR.name);
  });

  it("en Transfer, el destino sigue poniendo el contacto, como siempre", () => {
    const base = aplicaTipo({}, "Transfer", { ...GERENTE, miTienda: SUR.name });
    const d = eligeDestinoEnModal(base, ESTE.name);
    expect(d.contact).toBe(ESTE.name);
  });

  it("pasar una orden a Intertienda deja el contacto en su tienda de origen", () => {
    const cliente = { order_type: "Customer", store: SUR.name, contact: "Quien recibe", delivery_name: "Obra", delivery_address: "9 Obra Ln" };
    const d = aplicaTipo(cliente, "Intertienda", { ...GERENTE, miTienda: NORTE.name });
    expect(d.store).toBe(SUR.name);
    expect(d.contact).toBe(SUR.name);
  });

  it("el filtro del contacto es el de «Vendido desde»: no ofrece la tienda de destino (D-267, D-276)", () => {
    const d = eligeDestinoEnModal(borradorInicial({}, GERENTE), ESTE.name);
    expect(opcionesDeOrigen(d, TIENDAS, true)).not.toContain(ESTE.name);
  });
});

describe("al escribir en la base", () => {
  // Como están las 67 de producción, medidas por el orquestador: el contacto es la tienda de DESTINO.
  const vieja = {
    id: "a", order_type: "Intertienda", stage: "approved", store: SUR.name, pickup_name: SUR.name, pickup_address: SUR.address,
    delivery_name: ESTE.name, delivery_address: ESTE.address, contact: ESTE.name,
  } as Delivery;
  const escribe = <T extends Partial<Delivery>>(antes: Delivery | undefined, cambio: T) => escrituraConContactoDeOrigen(antes, cambio, REGLAS);

  it("guardar una orden vieja la corrige: el contacto pasa a ser la tienda de origen", () => {
    // Lo que manda el modal al guardar: el borrador entero.
    const guardada = escribe(vieja, { ...vieja, contact: ESTE.name });
    expect(guardada.contact).toBe(SUR.name);
  });

  it("una escritura que no toca tipo, tienda ni contacto pasa sin cambios", () => {
    expect(escribe(vieja, { stage: "picked_up" })).toEqual({ stage: "picked_up" });
    expect(escribe(vieja, { delivery_date: "2026-09-20" })).toEqual({ delivery_date: "2026-09-20" });
  });

  it("crear una Intertienda escribe el contacto aunque el borrador traiga otro", () => {
    expect(escribe(undefined, { order_type: "Intertienda", store: SUR.name, contact: ESTE.name }).contact).toBe(SUR.name);
    // Sin tienda de origen, contacto vacío: no se inventa nada.
    expect(escribe(undefined, { order_type: "Intertienda" } as Partial<Delivery>).contact).toBe("");
  });

  it("la re-entrega de una Intertienda vieja nace ya corregida", () => {
    const copia = escribe(undefined, borradorDeReentrega(vieja, { cargo: "", motivo: "Rota" }));
    expect(copia.contact).toBe(SUR.name);
  });

  it("Transfer y Customer no se tocan", () => {
    const transfer = { order_type: "Transfer", store: SUR.name, contact: ESTE.name };
    expect(escribe(undefined, transfer)).toEqual(transfer);
    const cliente = { order_type: "Customer", store: SUR.name, contact: "Quien recibe" };
    expect(escribe(undefined, cliente)).toEqual(cliente);
  });
});

describe("el formulario y los proveedores", () => {
  const modal = leer("src/components/OrderModal.tsx");

  it("en Intertienda, el contacto es el desplegable de tiendas, con el filtro y el manejador de siempre", () => {
    const contacto = modal.slice(modal.indexOf("{contactoEsOrigen ? ("), modal.indexOf('label={t("Phone number"'));
    expect(contacto).toContain("val={d.store}");
    expect(contacto).toContain("opts={opcionesDeOrigen(d, settings.stores, storeToStore)}");
    expect(contacto).toContain("on={(v) => setD((p) => conContactoDeOrigen(eligeOrigen(p, v, settings.stores), settings.order_type_rules))}");
    expect(contacto).toContain('invalid={missingSet.has("store")}');
  });

  it("la fila de «Vendido desde» y la dirección de tienda solo salen fuera de Intertienda", () => {
    expect(modal).toContain("{!contactoEsOrigen && (\n            <div className=\"grid g2\">");
    const fila = modal.slice(modal.indexOf("{!contactoEsOrigen && ("), modal.indexOf("{/* ---- Pickup ---- */}"));
    expect(fila).toContain('<label>{t("Store address", "Dirección de tienda")}</label>');
  });

  it("elegir el destino no pisa el contacto", () => {
    expect(modal).toContain("on={(v) => setD((p) => conContactoDeOrigen(eligeDestino(p, v, settings.stores), settings.order_type_rules))}");
  });

  it("y en el primer paso, la misma elección con la etiqueta del contacto", () => {
    expect(modal).toContain('label={contactoEsOrigen ? t("Contact name (sending store)", "Nombre de contacto (tienda que envía)") : t("Store (Sold From)", "Tienda (Vendido Desde)")}');
  });

  for (const f of ["src/lib/data-provider.tsx", "src/lib/local-data-provider.tsx"]) {
    it(`${f.replace("src/lib/", "")}: crear y editar recalculan el contacto antes de escribir`, () => {
      const src = leer(f);
      const tramo = (nombre: string) => {
        const ini = src.indexOf(`useCallback<DataState["${nombre}"]>`);
        return src.slice(ini, src.indexOf("useCallback<DataState[", ini + 10));
      };
      for (const nombre of ["addDelivery", "updateDelivery"]) {
        const cuerpo = tramo(nombre);
        const en = cuerpo.indexOf("escrituraConContactoDeOrigen(");
        expect(en, nombre).toBeGreaterThan(0);
        for (const escritura of ["if (teaching)", "supabase.from(\"deliveries\")", "persist("]) {
          const donde = cuerpo.indexOf(escritura);
          if (donde >= 0) expect(en, `${nombre}: ${escritura}`).toBeLessThan(donde);
        }
      }
    });
  }
});
