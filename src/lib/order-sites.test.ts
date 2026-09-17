import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { conflictosDeSitio } from "./required";
import { eligeDestino, eligeOrigen, opcionesDeDestino, opcionesDeOrigen, tiendaDestinoMostrada } from "./order-endpoints";
import { aplicaTipo, borradorDeReentrega, borradorInicial, escrituraQueNoVaANingunSitio, type ContextoDelUsuario } from "./order-sites";
import type { Delivery, NamedLocation, OrderTypeRule } from "./types";

/**
 * Intertienda: el destino no puede ser la tienda «Vendido desde», por ningún camino (D-276).
 *
 * Cada prueba arma el borrador **con los mismos manejadores que usa el modal**, en el orden en que los
 * pulsa una persona: el valor por defecto de una orden nueva, cambiar el tipo, elegir «Vendido desde»,
 * elegir el destino, escribir una dirección. Y pregunta a la regla de verdad. Nombres de tienda neutros.
 */

// Las reglas de producción, medidas por el orquestador en `settings.order_type_rules` (D-267).
const REGLAS: Record<string, OrderTypeRule> = {
  Intertienda: { docRef: "po", storeToStore: true, homeIsDestination: true },
  Transfer: { docRef: "estimate", storeToStore: true },
  Customer: { docRef: "invoice", storeToStore: false },
};
const TIPOS = ["Customer", "Intertienda", "Transfer"];
const TIENDAS: NamedLocation[] = [
  { name: "Tienda Norte", address: "100 Norte Ave, Ciudad TX" },
  { name: "Tienda Sur", address: "200 Sur Blvd, Ciudad TX" },
  { name: "Tienda Este", address: "300 Este Rd, Ciudad TX" },
];
const [NORTE, SUR] = TIENDAS;

const quien = (rol: string, miTienda: string | null): ContextoDelUsuario => ({ rol, miTienda, tipos: TIPOS, tiendas: TIENDAS, reglas: REGLAS });
const ADMIN = quien("admin", null);
const GERENTE = quien("manager", NORTE.name);
const VENDEDOR = quien("sales", NORTE.name);

const choques = (d: Partial<Delivery>) => conflictosDeSitio(d, REGLAS, TIENDAS).map((m) => m.key).sort();
const guarda = (antes: Delivery | undefined, cambio: Partial<Delivery>) =>
  escrituraQueNoVaANingunSitio(antes, cambio, REGLAS, TIENDAS).map((m) => m.key).sort();

/** Una Intertienda de Norte a Norte, como la que ya hay en la base desde antes de D-267. */
const MALA = {
  id: "a", order_type: "Intertienda", store: NORTE.name, pickup_name: NORTE.name, pickup_address: NORTE.address,
  delivery_name: NORTE.name, delivery_address: NORTE.address, contact: NORTE.name,
} as Delivery;
const BUENA = { ...MALA, delivery_name: SUR.name, delivery_address: SUR.address, contact: SUR.name } as Delivery;

describe("la orden nueva, tal como la abre cada rol", () => {
  it("el gerente abre una Intertienda con su tienda de destino y el origen por elegir, no de su tienda a su tienda", () => {
    const d = borradorInicial({}, GERENTE);
    expect(d.order_type).toBe("Intertienda");
    expect(d.delivery_name).toBe(NORTE.name);
    expect(d.store || "").toBe("");
    expect(choques(d)).toEqual([]);
  });

  it("el vendedor abre una entrega a cliente desde su tienda, como siempre", () => {
    const d = borradorInicial({}, VENDEDOR);
    expect(d.order_type).toBe("Customer");
    expect(d.store).toBe(NORTE.name);
  });

  it("el vendedor que pasa su orden a Intertienda no queda de su tienda a su tienda", () => {
    const d = aplicaTipo(borradorInicial({}, VENDEDOR), "Intertienda", VENDEDOR);
    expect(d.delivery_name).toBe(NORTE.name);
    expect(choques(d)).toEqual([]);
  });
});

describe("elegir en cualquier orden: el desplegable nunca ofrece la otra punta", () => {
  // Todos los caminos que una persona puede recorrer tocando SOLO lo que los desplegables ofrecen,
  // en los dos órdenes, para cada rol. Si alguno llega a un choque, el desplegable lo ofreció.
  for (const [nombre, c] of [["admin sin tienda", ADMIN], ["gerente con tienda", GERENTE], ["vendedor con tienda", VENDEDOR]] as const) {
    for (const tipo of ["Intertienda", "Transfer"]) {
      it(`${nombre}, ${tipo}: origen y luego destino, y destino y luego origen`, () => {
        const inicio = aplicaTipo(borradorInicial({}, c), tipo, c);
        const recorridos: string[] = [];
        let pasos = 0;
        for (const o of opcionesDeOrigen(inicio, TIENDAS, true)) {
          const d1 = eligeOrigen(inicio, o, TIENDAS);
          for (const x of opcionesDeDestino(d1, TIENDAS)) {
            const d2 = eligeDestino(d1, x, TIENDAS);
            pasos++;
            if (choques(d2).length) recorridos.push(`origen ${o} → destino ${x}: ${choques(d2)}`);
          }
        }
        for (const x of opcionesDeDestino(inicio, TIENDAS)) {
          const d1 = eligeDestino(inicio, x, TIENDAS);
          for (const o of opcionesDeOrigen(d1, TIENDAS, true)) {
            const d2 = eligeOrigen(d1, o, TIENDAS);
            pasos++;
            if (choques(d2).length) recorridos.push(`destino ${x} → origen ${o}: ${choques(d2)}`);
          }
        }
        expect(recorridos).toEqual([]);
        // Control: se recorrió algo. Con tres tiendas y la otra punta fuera, son 6 por orden, o menos
        // si el tipo ya dejó una punta puesta.
        expect(pasos).toBeGreaterThanOrEqual(4);
      });
    }
  }
});

describe("cambiar el tipo con las dos puntas ya puestas", () => {
  it("una entrega a cliente con la dirección de su propia tienda, pasada a Intertienda, se queda sin origen", () => {
    const cliente = eligeOrigen(aplicaTipo({}, "Customer", ADMIN), SUR.name, TIENDAS);
    const conDestino = { ...cliente, delivery_name: "Obra", delivery_address: SUR.address };
    const d = aplicaTipo(conDestino, "Intertienda", ADMIN);
    expect(choques(d)).toEqual([]);
    // En un tipo que recibe, el origen es lo que se elige: se vacía ese, y el destino se queda.
    expect(d.store).toBe("");
    expect(tiendaDestinoMostrada(d, TIENDAS)).toBe(SUR.name);
  });

  it("a Transfer, donde el origen es el que se queda, se vacía el destino", () => {
    const cliente = aplicaTipo(borradorInicial({}, VENDEDOR), "Customer", VENDEDOR);
    const conDestino = { ...cliente, delivery_name: "Obra", delivery_address: NORTE.address };
    const d = aplicaTipo(conDestino, "Transfer", VENDEDOR);
    expect(d.store).toBe(NORTE.name);
    expect(d.delivery_address).toBe("");
    expect(choques(d)).toEqual([]);
  });
});

describe("el destino que se ve es el que cuenta", () => {
  it("con el destino deducido de la dirección y sin nombre, «Vendido desde» no ofrece esa tienda", () => {
    const d = { ...aplicaTipo({}, "Intertienda", ADMIN), delivery_address: SUR.address, delivery_name: "" };
    expect(tiendaDestinoMostrada(d, TIENDAS)).toBe(SUR.name);
    expect(opcionesDeOrigen(d, TIENDAS, true)).not.toContain(SUR.name);
  });

  it("el origen es el destino aunque se cambie la recogida: la regla mira la dirección de la tienda de origen", () => {
    const d: Partial<Delivery> = {
      order_type: "Intertienda", store: SUR.name, pickup_name: "Patio", pickup_address: "9 Patio Ln, Ciudad TX",
      delivery_name: "", delivery_address: SUR.address,
    };
    expect(choques(d)).toEqual(["store"]);
  });

  it("el destino no ofrece la tienda que está en la dirección de recogida", () => {
    const d: Partial<Delivery> = { order_type: "Intertienda", store: NORTE.name, pickup_name: SUR.name, pickup_address: SUR.address };
    expect(opcionesDeDestino(d, TIENDAS)).toEqual(["Tienda Este"]);
  });

  it("en una orden vieja que ya lo tiene, el destino conserva la tienda que enseña", () => {
    expect(opcionesDeDestino(MALA, TIENDAS)).toContain(NORTE.name);
  });
});

describe("la escritura: ninguna orden entra en envío o aprobación yendo a su propio sitio", () => {
  it("un borrador que va a su propio sitio no se envía ni se aprueba desde ninguna pantalla", () => {
    expect(guarda({ ...MALA, stage: "draft" }, { stage: "pending" })).toEqual(["delivery_address", "store"]);
    expect(guarda({ ...MALA, stage: "pending" }, { stage: "approved" })).toEqual(["delivery_address", "store"]);
  });

  it("crearla ya enviada o ya aprobada, tampoco; como borrador, sí", () => {
    expect(guarda(undefined, { ...MALA, stage: "pending" })).toEqual(["delivery_address", "store"]);
    expect(guarda(undefined, { ...MALA, stage: "approved" })).toEqual(["delivery_address", "store"]);
    expect(guarda(undefined, { ...MALA, stage: "draft" })).toEqual([]);
  });

  it("el resto de una carga dividida, que el modal crea «ready» a mitad de la recogida, no se para", () => {
    const { id: _id, ...src } = { ...MALA, stage: "picked_up" } as Delivery;
    expect(guarda(undefined, { ...src, order_suffix: "b", est_pallets: 2, actual_pallets: 2, stage: "ready", assigned_driver: null })).toEqual([]);
  });

  it("editar una orden viva para dejarla en su propio sitio, no", () => {
    expect(guarda({ ...BUENA, stage: "approved" }, { delivery_name: NORTE.name, delivery_address: NORTE.address })).toEqual(["delivery_address", "store"]);
  });

  it("una orden vieja que ya lo tiene sigue su camino: el chofer la recoge, y se edita sin que la edición lo empeore", () => {
    const vieja = { ...MALA, stage: "approved" } as Delivery;
    expect(guarda(vieja, { stage: "picked_up" })).toEqual([]);
    expect(guarda(vieja, { delivery_date: "2026-09-20" })).toEqual([]);
    expect(guarda(vieja, { pickup_address: "9 Patio Ln, Ciudad TX" })).toEqual([]);
  });

  it("una orden buena pasa", () => {
    expect(guarda({ ...BUENA, stage: "draft" }, { stage: "pending" })).toEqual([]);
    expect(guarda(undefined, { ...BUENA, stage: "approved" })).toEqual([]);
  });

  it("la re-entrega, que nace aprobada y sin nombre de destino: de una orden mala no se crea, de una buena sí", () => {
    const copia = borradorDeReentrega({ ...MALA, stage: "delivered" }, { cargo: "", motivo: " Rota " });
    expect(copia.stage).toBe("approved");
    expect(copia.delivery_name).toBeUndefined();
    expect(guarda(undefined, copia)).toEqual(["delivery_address", "store"]);
    expect(guarda(undefined, borradorDeReentrega({ ...BUENA, stage: "delivered" }, { cargo: "25", motivo: "Rota" }))).toEqual([]);
  });
});

describe("el modal y los dos proveedores usan esto", () => {
  const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
  const modal = leer("src/components/OrderModal.tsx");

  it("el modal abre, cambia de tipo, elige las dos puntas y registra la re-entrega con estas funciones", () => {
    expect(modal).toContain("setD((p) => borradorInicial(p, contextoDelUsuario));");
    expect(modal).toContain("const withTypeDefaults = (p: Draft, newType: string): Draft => aplicaTipo(p, newType, contextoDelUsuario);");
    // Los dos selectores de tipo y la cuenta que trae su tipo pasan por ahí.
    expect(modal.split("withTypeDefaults(").length - 1).toBe(3);
    // Envuelto en `conContactoDeOrigen` desde D-282, que en Intertienda deja el contacto en la
    // tienda que envía; para el resto de tipos no cambia nada.
    expect(modal).toContain("on={(v) => setD((p) => conContactoDeOrigen(eligeOrigen(p, v, settings.stores), settings.order_type_rules))}");
    expect(modal).toContain("setD((p) => conContactoDeOrigen(eligeOrigen(p, v, settings.stores), settings.order_type_rules));");
    expect(modal).toContain("on={(v) => setD((p) => conContactoDeOrigen(eligeDestino(p, v, settings.stores), settings.order_type_rules))}");
    expect(modal).toContain("const deliveryStore = tiendaDestinoMostrada(d, settings.stores);");
    expect(modal).toContain("const payload: Draft = borradorDeReentrega(src, { cargo: redeliverCharge, motivo: redeliverReason });");
    expect(modal).toContain("const origenIgualDestino = origenEsDestino(d, storeToStore, settings.stores);");
    // Y no queda ningún manejador de tienda escrito a mano.
    expect(modal).not.toContain("settings.stores.find((s) => s.name === v)");
  });

  for (const f of ["src/lib/data-provider.tsx", "src/lib/local-data-provider.tsx"]) {
    it(`${f.replace("src/lib/", "")}: crear, editar y mover pasan por la guarda antes de escribir nada`, () => {
      const src = leer(f);
      const tramo = (nombre: string) => {
        const ini = src.indexOf(`useCallback<DataState["${nombre}"]>`);
        const fin = src.indexOf("useCallback<DataState[", ini + 10);
        expect(ini, nombre).toBeGreaterThan(0);
        return src.slice(ini, fin);
      };
      for (const nombre of ["addDelivery", "updateDelivery", "setStage"]) {
        const cuerpo = tramo(nombre);
        const guardaEn = cuerpo.indexOf("escrituraQueNoVaANingunSitio(");
        expect(guardaEn, nombre).toBeGreaterThan(0);
        // Antes de la primera escritura: el modo enseñanza, la base o el almacén local.
        for (const escritura of ["if (teaching)", "supabase.from(\"deliveries\")", "persist("]) {
          const en = cuerpo.indexOf(escritura);
          if (en >= 0) expect(guardaEn, `${nombre}: ${escritura}`).toBeLessThan(en);
        }
      }
    });
  }
});
