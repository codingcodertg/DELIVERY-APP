import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ROLE_ORDER } from "./constants";
import { borradorInicial, type ContextoDelUsuario } from "./order-sites";
import { isStoreToStore } from "./required";
import { DEMO_USERS, demoSettings } from "./demo-data";
import { eligeVendedorAlCrear, ofrecePasarACliente, pideVendedor, tipoDeCliente, vendedoresParaLaOrden } from "./sales-reps";
import type { UserRole } from "./types";

/**
 * Office no encontraba «Vendedor» al crear una orden (D-439).
 *
 * El dueño: «ADD VENDEDOR LIKE ADMIN, ADD THAT TO ALL OFFICE PEOPLE SO THEY CAN CREATE AN ORDER AND
 * ATTACHED A VENDEDOR»; preguntado qué faltaba: «No le sale el campo».
 *
 * La causa no era un permiso: office (`accounting`) abre la orden nueva en Intertienda (D-084), y una
 * Intertienda no lleva vendedor. Aquí se fija que el hueco del campo ofrece el atajo a una orden de
 * cliente, que con él el vendedor sale, y que la pantalla usa estas funciones y no una copia.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const modal = leer("src/components/OrderModal.tsx");

const settings = demoSettings();
const REGLAS = settings.order_type_rules;
const ctx = (rol: UserRole, miTienda: string | null): ContextoDelUsuario => ({
  rol, miTienda, tipos: settings.order_types, reglas: REGLAS, tiendas: settings.stores,
} as ContextoDelUsuario);

describe("quién elige el vendedor al crear", () => {
  it("office, gerente, admin y chofer sí; ventas, almacén y logística no", () => {
    const si = ROLE_ORDER.filter((r) => eligeVendedorAlCrear(r)).sort();
    expect(si).toEqual(["accounting", "admin", "driver", "manager"]);
  });
});

describe("el hueco de «Vendedor» en una orden nueva de office", () => {
  it("office abre en Intertienda (D-084) y ahí no se pide vendedor, pero se ofrece el atajo", () => {
    const d = borradorInicial({}, ctx("accounting", "McAllen"));
    expect(d.order_type).toBe("Intertienda");
    const tat = isStoreToStore(d.order_type, REGLAS);
    expect(pideVendedor("accounting", true, tat)).toBe(false);
    expect(ofrecePasarACliente("accounting", true, tat)).toBe(true);
  });

  it("office sin tienda, igual: abre en Intertienda y tiene el atajo", () => {
    const d = borradorInicial({}, ctx("accounting", null));
    expect(d.order_type).toBe("Intertienda");
    expect(ofrecePasarACliente("accounting", true, isStoreToStore(d.order_type, REGLAS))).toBe(true);
  });

  it("en una orden a cliente office tiene «Vendedor» obligatorio, igual que el admin, y ya no el atajo", () => {
    for (const rol of ["accounting", "admin"] as const) {
      expect(pideVendedor(rol, true, false)).toBe(true);
      expect(ofrecePasarACliente(rol, true, false)).toBe(false);
    }
  });

  it("una orden ya guardada no pide vendedor ni ofrece el atajo", () => {
    expect(pideVendedor("accounting", false, false)).toBe(false);
    expect(ofrecePasarACliente("accounting", false, true)).toBe(false);
  });

  it("ventas no: su orden es suya, ni campo ni atajo", () => {
    expect(pideVendedor("sales", true, false)).toBe(false);
    expect(ofrecePasarACliente("sales", true, true)).toBe(false);
  });
});

describe("a qué tipo lleva el atajo", () => {
  it("Customer, si está y es de cliente, aunque otro de cliente vaya antes en la lista", () => {
    // «Obra» delante a propósito: con Customer primero, «el primero de cliente» también daría Customer.
    expect(tipoDeCliente(["Intertienda", "Obra", "Customer"], REGLAS)).toBe("Customer");
  });
  it("sin Customer, el primer tipo que no sea tienda-a-tienda", () => {
    expect(tipoDeCliente(["Intertienda", "Transfer", "Obra", "Otro"], REGLAS)).toBe("Obra");
  });
  it("si todos son tienda-a-tienda, ninguno", () => {
    expect(tipoDeCliente(["Intertienda", "Transfer"], REGLAS)).toBeNull();
  });
});

describe("la lista del demo no sale vacía", () => {
  it("con una orden de McAllen se ofrecen los vendedores del demo (la tienda no tiene: salen todos)", () => {
    const lista = vendedoresParaLaOrden(DEMO_USERS, "McAllen", null, settings.stores).map((u) => u.id);
    expect(lista.length).toBeGreaterThan(0);
    expect(lista).toContain("u-sales");
  });
});

describe("la ficha usa estas reglas", () => {
  it("needsSalesRep sale de pideVendedor", () => {
    expect(modal).toContain("const needsSalesRep = pideVendedor(me.role, isNew, isStoreToStore(d.order_type, settings.order_type_rules));");
  });
  it("el atajo sale de ofrecePasarACliente y de tipoDeCliente", () => {
    expect(modal).toContain("const tipoCliente = tipoDeCliente(settings.order_types, settings.order_type_rules);");
    expect(modal).toContain("const atajoACliente = !!tipoCliente && ofrecePasarACliente(me.role, isNew, isStoreToStore(d.order_type, settings.order_type_rules));");
  });
  it("el atajo se pinta en el hueco de «Vendedor» y cambia el tipo por el mismo camino que el selector, sin volver al paso 1", () => {
    const i = modal.indexOf(") : atajoACliente && tipoCliente ? (");
    expect(i).toBeGreaterThan(0);
    const bloque = modal.slice(i, i + 1400);
    expect(bloque).toContain("data-atajo-cliente");
    expect(bloque).toContain("setD((p) => withTypeDefaults(p, tipoCliente)); setShowFullForm(true);");
    // Va justo después del select de «Vendedor», en su mismo hueco.
    const vendedor = modal.indexOf('<option value="">{t("Select sales rep…", "Seleccione vendedor…")}</option>');
    expect(vendedor).toBeGreaterThan(0);
    expect(vendedor).toBeLessThan(i);
  });
});
