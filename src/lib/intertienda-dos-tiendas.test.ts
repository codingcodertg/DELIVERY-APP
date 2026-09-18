import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { tiendaDeLaOrdenEsMia, tiendasDeLaOrden } from "./order-endpoints";
import { almacenDeLaTienda, codigoDeTienda, esDeAlmacen } from "./almacen-de-tienda";
import { ventasVeLaOrden } from "./visibilidad-ventas";
import { missingFields } from "./required";
import type { NamedLocation } from "./types";
import type { PersonaDirectorio } from "./phone-book";

/**
 * Intertienda: las dos tiendas la ven, sin cliente, con destino obligatorio y con a quién llamar
 * (D-NEXT). Cuatro cosas que pidió el dueño el 2026-09-18, medidas aquí por separado.
 *
 * Nada de esto toca la base ni llama a nadie: `phone_book` se dobla con filas de mentira y los
 * teléfonos son inventados.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const tablero = leer("src/app/(app)/page.tsx");
const almacen = leer("src/app/(app)/warehouse/page.tsx");
const cuentas = leer("src/app/(app)/accounts/page.tsx");
const modal = leer("src/components/OrderModal.tsx");

const TIENDAS: NamedLocation[] = [
  { name: "Tienda Norte", address: "100 Norte Ave", directory_code: "NOR" },
  { name: "Tienda Sur", address: "200 Sur Blvd", directory_code: "SUR" },
  { name: "Tienda Este", address: "300 Este Rd", directory_code: "SUR" },   // comparte código con Sur
  { name: "Tienda Oeste", address: "400 Oeste Ln" },                        // sin código
];
// Tiendas con grupo, para el caso de D-293: McAllen y Mission trabajan juntas.
const TIENDAS_RGV: NamedLocation[] = [
  { name: "Pharr", address: "1 Pharr Rd" },
  { name: "McAllen", address: "2 McAllen Ave", group: "OESTE" },
  { name: "Mission", address: "3 Mission Blvd", group: "OESTE" },
];
const A_TIENDA = { storeToStore: true } as const;
const A_CLIENTE = { storeToStore: false } as const;

describe("las tiendas a las que les importa la orden", () => {
  it("en una Intertienda de hoy son dos: la que vende y recibe, y la que envía", () => {
    // Desde D-302 `store` y `delivery_name` son la misma —la del usuario— y `pickup_name` la que manda.
    const d = { store: "Tienda Norte", pickup_name: "Tienda Sur", delivery_name: "Tienda Norte" };
    expect(tiendasDeLaOrden(d, A_TIENDA)).toEqual(["Tienda Norte", "Tienda Sur"]);
  });

  it("y en una de antes de D-302, con la otra forma, también salen las dos", () => {
    // Las viejas siguen vivas: `store` era el origen y el destino era la otra tienda.
    const d = { store: "Tienda Norte", pickup_name: "Tienda Norte", delivery_name: "Tienda Sur" };
    expect(tiendasDeLaOrden(d, A_TIENDA)).toEqual(["Tienda Norte", "Tienda Sur"]);
  });

  it("en una orden de cliente la tienda es una: la que vende", () => {
    const d = { store: "Tienda Norte", pickup_name: "Un patio", delivery_name: "Casa del cliente" };
    expect(tiendasDeLaOrden(d, A_CLIENTE)).toEqual(["Tienda Norte"]);
  });

  it("los huecos no cuentan y los nombres salen como se guardaron", () => {
    const d = { store: "  Tienda Norte  ", pickup_name: "", delivery_name: null };
    expect(tiendasDeLaOrden(d, A_TIENDA)).toEqual(["Tienda Norte"]);
    expect(tiendasDeLaOrden({ store: null, pickup_name: "  ", delivery_name: "" }, A_TIENDA)).toEqual([]);
  });

  it("la misma tienda escrita de dos formas es una sola", () => {
    const d = { store: "Tienda Norte", pickup_name: "tienda norte ", delivery_name: "TIENDA NORTE" };
    expect(tiendasDeLaOrden(d, A_TIENDA)).toEqual(["Tienda Norte"]);
  });
});

describe("¿es mía alguna de las tiendas de la orden?", () => {
  const intertienda = { store: "Tienda Norte", pickup_name: "Tienda Sur", delivery_name: "Tienda Norte" };

  it("sí para la tienda que recibe", () => {
    expect(tiendaDeLaOrdenEsMia(intertienda, A_TIENDA, "Tienda Norte", TIENDAS)).toBe(true);
  });

  it("y sí para la que envía, que es lo que pidió el dueño", () => {
    expect(tiendaDeLaOrdenEsMia(intertienda, A_TIENDA, "Tienda Sur", TIENDAS)).toBe(true);
  });

  it("no para una tienda que no está en la orden", () => {
    expect(tiendaDeLaOrdenEsMia(intertienda, A_TIENDA, "Tienda Oeste", TIENDAS)).toBe(false);
  });

  it("y tampoco para quien no tiene tienda: por aquí no se gana visibilidad", () => {
    expect(tiendaDeLaOrdenEsMia(intertienda, A_TIENDA, null, TIENDAS)).toBe(false);
    expect(tiendaDeLaOrdenEsMia(intertienda, A_TIENDA, "   ", TIENDAS)).toBe(false);
  });

  it("cuenta también el grupo de tiendas que trabajan juntas (D-293)", () => {
    const juntas: NamedLocation[] = [
      { name: "Tienda Sur", address: "200 Sur Blvd", group: "SUR" },
      { name: "Tienda Este", address: "300 Este Rd", group: "SUR" },
    ];
    // La orden la envía Sur; quien está en Este, que trabaja con ella, también la ve.
    expect(tiendaDeLaOrdenEsMia(intertienda, A_TIENDA, "Tienda Este", juntas)).toBe(true);
  });

  it("en una orden de cliente solo cuenta la que vende — y eso NO basta para que ventas la vea", () => {
    const cliente = { store: "Tienda Norte", pickup_name: "Tienda Sur", delivery_name: "Casa" };
    expect(tiendaDeLaOrdenEsMia(cliente, A_CLIENTE, "Tienda Sur", TIENDAS)).toBe(false);
    // **Ojo con leer esto como la decisión de ventas.** Es `true`, y aun así un vendedor NO ve la
    // orden de cliente de su compañero de tienda: quien decide eso es `ventasVeLaOrden`, que exige
    // además que el tipo sea tienda-a-tienda. Probar esta pieza y dar por hecha la decisión fue
    // exactamente el defecto que se coló en la primera versión de esta rama.
    expect(tiendaDeLaOrdenEsMia(cliente, A_CLIENTE, "Tienda Norte", TIENDAS)).toBe(true);
  });
});

describe("qué órdenes le tocan a un vendedor", () => {
  // La decisión ENTERA, con datos. La primera versión de esta rama probaba la pieza
  // (`tiendaDeLaOrdenEsMia`) y daba por hecho el resto, y por ahí se coló que un vendedor viera las
  // órdenes de CLIENTE de sus compañeros de tienda: la pieza devuelve `[store]` en un tipo de
  // cliente, que es lo correcto para la cola de almacén y lo contrario de lo que quiere ventas.
  const YO = { miId: "vendedor-1", miTienda: "Pharr", tiendas: TIENDAS_RGV };
  const deOtro = { created_by: "vendedor-2", assigned_sales_rep: null, stage: "approved" as const };

  it("una orden de CLIENTE de su tienda, escrita por otro: NO la ve", () => {
    const orden = { ...deOtro, store: "Pharr", pickup_name: "Pharr", delivery_name: "Casa de un cliente" };
    expect(ventasVeLaOrden({ ...YO, orden, regla: A_CLIENTE })).toBe(false);
  });

  it("la misma orden, pero de tienda a tienda: sí la ve", () => {
    const orden = { ...deOtro, store: "Pharr", pickup_name: "McAllen", delivery_name: "Pharr" };
    expect(ventasVeLaOrden({ ...YO, orden, regla: A_TIENDA })).toBe(true);
  });

  it("una Intertienda donde su tienda solo ENVÍA: también la ve", () => {
    const orden = { ...deOtro, store: "McAllen", pickup_name: "Pharr", delivery_name: "McAllen" };
    expect(ventasVeLaOrden({ ...YO, orden, regla: A_TIENDA })).toBe(true);
  });

  it("una Intertienda entre dos tiendas ajenas: no la ve", () => {
    const orden = { ...deOtro, store: "McAllen", pickup_name: "Mission", delivery_name: "McAllen" };
    expect(ventasVeLaOrden({ ...YO, orden, regla: A_TIENDA })).toBe(false);
  });

  it("y el grupo cuenta: quien está en Mission ve una Intertienda de McAllen (D-293)", () => {
    const orden = { ...deOtro, store: "McAllen", pickup_name: "Pharr", delivery_name: "McAllen" };
    expect(ventasVeLaOrden({ ...YO, miTienda: "Mission", orden, regla: A_TIENDA })).toBe(true);
  });

  it("la suya la ve siempre, sea del tipo que sea", () => {
    const suya = { created_by: "vendedor-1", assigned_sales_rep: null, stage: "approved" as const, store: "McAllen", pickup_name: "McAllen", delivery_name: "Casa" };
    expect(ventasVeLaOrden({ ...YO, orden: suya, regla: A_CLIENTE })).toBe(true);
  });

  it("y la que le asignó oficina también, porque `orderOwner` manda sobre quién la escribió", () => {
    const asignada = { created_by: "oficina-1", assigned_sales_rep: "vendedor-1", stage: "approved" as const, store: "McAllen", pickup_name: "McAllen", delivery_name: "Casa" };
    expect(ventasVeLaOrden({ ...YO, orden: asignada, regla: A_CLIENTE })).toBe(true);
  });

  it("el tablero llama a esa función y no a la pieza suelta", () => {
    expect(tablero).toContain('if (me?.role === "sales" && !ventasVeLaOrden({');
    expect(tablero).not.toContain("tiendaDeLaOrdenEsMia(d,");
  });

  it("la cola de almacén pregunta lo mismo, con la misma función", () => {
    expect(almacen).toContain("tiendasDeLaOrden(d, orderTypeRule(d.order_type, settings.order_type_rules))");
    // Y la dirección de recogida se sigue mirando: un punto guardado sin nombre entra por ahí.
    expect(almacen).toContain('if (direccionesDeLaCola.includes((d.pickup_address || "").trim())) return true;');
  });

  it("Cuentas deja fuera las de tienda a tienda SIN cuenta, y solo esas", () => {
    expect(cuentas).toContain('if (!(d.account || "").trim() && isStoreToStore(d.order_type, settings.order_type_rules)) continue;');
  });
});

describe("sin cliente en un movimiento entre tiendas", () => {
  it("el formulario no enseña cuenta, contacto ni teléfono", () => {
    const i = modal.indexOf("{/* ---- Customer / contact ---- */}");
    expect(i).toBeGreaterThan(-1);
    const tramo = modal.slice(i, modal.indexOf("{/* ---- Order type · fee · pallets ---- */}"));
    expect(tramo).toContain("{!storeToStore && (");
    // Y los tres campos siguen existiendo dentro, para las órdenes de cliente.
    expect(tramo).toContain("<AccountCombo");
    expect(tramo).toContain('{t("Contact name", "Nombre de Contacto")}');
    expect(tramo).toContain('{t("Phone number", "Número de teléfono")}');
  });
});

describe("la tienda destino es obligatoria en un movimiento entre tiendas", () => {
  const REGLAS = { Intertienda: { storeToStore: true, docRef: "po" as const }, Customer: { storeToStore: false, docRef: "invoice" as const } };
  const base = {
    order_type: "Intertienda", store: "Tienda Norte", pickup_name: "Tienda Sur", pickup_address: "200 Sur Blvd",
    delivery_address: "100 Norte Ave", delivery_date: "2026-09-20", delivery_windows: "AM", est_pallets: 2, po2: "PO-1",
  };

  it("falta cuando no está, y sale con el nombre que se lee en pantalla", () => {
    const falta = missingFields({ ...base, delivery_name: "" }, REGLAS);
    expect(falta.map((f) => f.key)).toContain("delivery_name");
    expect(falta.find((f) => f.key === "delivery_name")?.es).toBe("Tienda destino");
  });

  it("y no falta cuando está", () => {
    const falta = missingFields({ ...base, delivery_name: "Tienda Norte" }, REGLAS);
    expect(falta.map((f) => f.key)).not.toContain("delivery_name");
  });

  it("en una orden de cliente sigue siendo opcional: una obra puede no tener nombre", () => {
    const cliente = { ...base, order_type: "Customer", delivery_name: "", invoice_num: "F-1", contact: "Quien recibe", delivery_phone: "5550001111" };
    expect(missingFields(cliente, REGLAS).map((f) => f.key)).not.toContain("delivery_name");
  });

  it("y el desplegable del destino se pinta en rojo cuando falta", () => {
    expect(modal).toContain('invalid={missingSet.has("delivery_name") || missingSet.has("delivery_address")}');
  });
});

// ---- A quién llama el chofer -------------------------------------------------------------------

const persona = (extra: Partial<PersonaDirectorio> = {}): PersonaDirectorio => ({
  full_name: "Quien sea", title: null, store: "NOR", store_rank: 1, department: "Almacén",
  phone: "5550000000", ringcentral_ext: "100", email: null, directory_group: null, store_ext: "100", ...extra,
});

describe("quién es de almacén", () => {
  it("da igual el acento, las mayúsculas y los espacios", () => {
    for (const d of ["Almacén", "almacen", "ALMACEN", "  Almacen  "]) expect(esDeAlmacen(d), d).toBe(true);
  });

  it("y no cuela ningún otro departamento", () => {
    for (const d of ["Ventas", "Oficina", "Choferes", "", null, undefined]) expect(esDeAlmacen(d), String(d)).toBe(false);
  });
});

describe("con qué código busca el chofer", () => {
  it("el de Ajustes cuando lo hay", () => {
    expect(codigoDeTienda("Tienda Norte", TIENDAS)).toBe("NOR");
  });

  it("y el nombre cuando la tienda no tiene código, que es lo que hace la 117", () => {
    expect(codigoDeTienda("Tienda Oeste", TIENDAS)).toBe("Tienda Oeste");
  });

  it("null si ese sitio no es una tienda nuestra", () => {
    expect(codigoDeTienda("Casa del cliente", TIENDAS)).toBeNull();
    expect(codigoDeTienda("", TIENDAS)).toBeNull();
  });
});

describe("a quién puede llamar en esa tienda", () => {
  const filas = [
    persona({ full_name: "Zoe Almacén", store: "NOR", department: "Almacén", phone: "5550000001" }),
    persona({ full_name: "Ana Almacén", store: "NOR", department: "almacen ", phone: "5550000002" }),
    persona({ full_name: "Luis Ventas", store: "NOR", department: "Ventas", phone: "5550000003" }),
    persona({ full_name: "Sin Tel", store: "NOR", department: "Almacén", phone: "  " }),
    persona({ full_name: "Otra Tienda", store: "SUR", department: "Almacén", phone: "5550000004" }),
  ];

  it("los de almacén de esa tienda, con teléfono, en orden", () => {
    const gente = almacenDeLaTienda(filas, "Tienda Norte", TIENDAS);
    expect(gente?.map((p) => p.full_name)).toEqual(["Ana Almacén", "Zoe Almacén"]);
  });

  it("ni ventas, ni quien no tiene teléfono: un contacto al que no se puede llamar no es un contacto", () => {
    const gente = almacenDeLaTienda(filas, "Tienda Norte", TIENDAS) ?? [];
    expect(gente.map((p) => p.full_name)).not.toContain("Luis Ventas");
    expect(gente.map((p) => p.full_name)).not.toContain("Sin Tel");
  });

  it("las tiendas que comparten código van juntas, porque el directorio las agrupa así", () => {
    // Sur y Este comparten «SUR»: quien pregunte por cualquiera de las dos ve a la misma gente.
    expect(almacenDeLaTienda(filas, "Tienda Sur", TIENDAS)?.map((p) => p.full_name)).toEqual(["Otra Tienda"]);
    expect(almacenDeLaTienda(filas, "Tienda Este", TIENDAS)?.map((p) => p.full_name)).toEqual(["Otra Tienda"]);
  });

  it("**null** si el sitio no es una tienda, y **lista vacía** si lo es pero no hay nadie", () => {
    // No es lo mismo y la pantalla lo dice distinto: en el primer caso no pinta nada, en el segundo
    // avisa de que no hay a quién llamar.
    expect(almacenDeLaTienda(filas, "Casa del cliente", TIENDAS)).toBeNull();
    expect(almacenDeLaTienda(filas, "Tienda Oeste", TIENDAS)).toEqual([]);
  });
});

describe("la pantalla del chofer", () => {
  it("pregunta al directorio AL TOCAR, no al abrir la parada", () => {
    // Se abre en cada parada del día y casi ninguna necesita llamar a un almacén.
    const i = modal.indexOf("const abrir = () => {");
    expect(i).toBeGreaterThan(-1);
    expect(modal.slice(i, modal.indexOf("};", i))).toContain('createClient().rpc("phone_book")');
    // Y una vez preguntado no se vuelve a pedir.
    expect(modal.slice(i, modal.indexOf("};", i))).toContain("if (filas || cargando) return;");
  });

  it("sale en las dos paradas: donde recoge y donde entrega", () => {
    expect(modal).toContain("<AlmacenDeLaParada nombre={pickupPlace} tiendas={settings.stores} t={t} />");
    expect(modal).toContain("<AlmacenDeLaParada nombre={order.delivery_name} tiendas={settings.stores} t={t} />");
  });

  it("y dice cuándo no hay nadie, en vez de callarse", () => {
    expect(modal).toContain("Nadie de almacén con teléfono en esta tienda.");
  });
});
