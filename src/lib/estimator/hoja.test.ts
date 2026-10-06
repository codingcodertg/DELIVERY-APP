import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HojaCliente } from "@/app/estimator/HojaCliente";
import {
  AVISO_JUNTO_AL_TOTAL, ENCABEZADO, SUBTITULO, TEXTO_DE_ENTREGA,
  cantidadParaElCliente, descripcionParaElCliente, hojaDelCliente, tiendaDeLaHoja,
} from "./hoja";
import {
  borradorVacio, lineaSfVacia, lineaUnidadVacia, resumenDeTotales, totalDeMateriales, type QuoteDraft, type SfLine, type UnitLine,
} from "./modelo";
import { tarifaDeLaCotizacion } from "./entrega";
import { loQueFalta } from "./validar";
import { demoSettings } from "@/lib/demo-data";

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");

// Un borrador con TODO lo interno relleno con valores reconocibles, para poder buscarlos en la salida.
const INTERNO = {
  nombre: "Mariela Zubizarreta",
  empresa: "Constructora Ficticia",
  telefono: "956-555-0199",
  direccion: "742 Calle Inventada",
  codigo: "ZZQ-9001",
  descripcion: "Marmol Interno Secreto 24x48",
  calle: "12 Camino Oculto",
  ciudad: "Pueblo Falso",
  zip: "78999",
  // La entrega buscada con el pin (D-442): dirección, tienda de salida y millas reconocibles.
  direccionEntrega: "4321 Calle Del Pin, McAllen, TX 78504",
  tienda: "Pharr",
  millas: 23.7,
};

function borrador(patch: Partial<QuoteDraft> = {}): QuoteDraft {
  const base = borradorVacio("2026-09-08");
  const linea: SfLine = {
    ...lineaSfVacia(), item_code: INTERNO.codigo, internal_description: INTERNO.descripcion,
    customer_category: "24x48 Tile", customer_note: "Main Floor",
    requested_sf: 1250, sf_per_box: 23.8, price_per_sf: 1.89,
  };
  return {
    ...base,
    estimate_num: "104582",
    sales_ext: "214",
    customer: {
      salutation: "Ms.", full_name: INTERNO.nombre,
      company: INTERNO.empresa, phone: INTERNO.telefono,
    },
    delivery: {
      mode: "delivery", address: INTERNO.direccionEntrega, lat: 26.2461, lng: -98.2297, pin_source: "manual",
      store: INTERNO.tienda, miles: INTERNO.millas, charge: 150,
    },
    lines: [
      linea,
      { ...lineaUnidadVacia(), item_code: "LOT-77", internal_description: "Thinset y lechada interno", customer_category: "Installation Materials", quantity: 1, unit: "Lot", unit_price: 385 },
    ],
    ...patch,
  };
}

/** Lo que NUNCA puede salir en la hoja del cliente. */
function prohibidos(q: QuoteDraft): string[] {
  return [
    INTERNO.nombre, "Mariela", INTERNO.empresa, INTERNO.telefono, INTERNO.direccion, INTERNO.codigo, INTERNO.descripcion,
    INTERNO.calle, INTERNO.ciudad, INTERNO.zip, "LOT-77", "Thinset y lechada interno",
    // El $/SF interno, en todas sus formas, y el SF real (con él y el total, sale el $/SF de una división).
    "1.89", "$1.89", "1,261.4", "1261.4",
    // El cargo de entrega.
    "150.00", "$150",
    q.customer.phone,
  ];
}

describe("la hoja del cliente NO lleva nada interno", () => {
  for (const nivel of ["basic", "standard", "detailed"] as const) {
    it(`${nivel}: ni teléfono, ni empresa, ni dirección, ni código, ni descripción interna, ni $/SF, ni el cargo`, () => {
      const q = borrador({ display_level: nivel });
      const hoja = JSON.stringify(hojaDelCliente(q));
      for (const p of prohibidos(q)) expect(hoja, p).not.toContain(p);
    });
    it(`${nivel}: y lo que se PINTA tampoco (la hoja renderizada)`, () => {
      const q = borrador({ display_level: nivel });
      const html = renderToStaticMarkup(createElement(HojaCliente, { hoja: hojaDelCliente(q) }));
      for (const p of prohibidos(q)) expect(html, p).not.toContain(p);
      // Y sí lo que debe estar.
      expect(html).toContain("Ms. Zubizarreta");
      expect(html).toContain("104582");
      expect(html).toContain("Ext. 214");
    });
  }

  it("el cliente se nombra solo como «Ms. Apellido»", () => {
    expect(hojaDelCliente(borrador()).preparadoPara).toBe("Ms. Zubizarreta");
  });

  it("sin campo de apellido (D-432): la hoja dice «Mr. <última palabra del nombre>»", () => {
    const q = borrador();
    q.customer = { ...q.customer, salutation: "Mr.", full_name: "  Juan  de la Garza " };
    expect(hojaDelCliente(q).preparadoPara).toBe("Mr. Garza");
    q.customer = { ...q.customer, full_name: "" };
    expect(hojaDelCliente(q).preparadoPara).toBe("");
  });

  it("las claves de la hoja son las de la plantilla: ninguna del borrador interno", () => {
    const claves = Object.keys(hojaDelCliente(borrador())).sort();
    expect(claves).toEqual([
      "avisoJuntoAlTotal", "encabezado", "entrega", "filas", "preparadoPara", "referencia", "representante",
      "resumen", "subtitulo", "textoAhorro", "textoImpuesto", "textoSubtotal", "textoTotal", "tienda", "total", "validezConspicua",
    ]);
    for (const f of hojaDelCliente(borrador()).filas) expect(Object.keys(f).sort()).toEqual(["cantidad", "descripcion", "importe", "precioConDescuento"]);
  });
});

describe("los tres niveles: Basic / Standard / Detailed", () => {
  const l: SfLine = { ...lineaSfVacia(), customer_category: "24x48 Tile", customer_note: "Main Floor", requested_sf: 1250, sf_per_box: 23.8, price_per_sf: 1.89 };

  it("Basic: total + Requested Area, sin cajas", () => {
    expect(cantidadParaElCliente(l, "basic")).toEqual(["Requested Area: 1,250 SF"]);
    expect(descripcionParaElCliente(l, "basic")).toBe("24x48 Tile — Main Floor");
  });
  it("Standard (el de por defecto): + «Quantity: 53 Boxes»", () => {
    expect(borradorVacio().display_level).toBe("standard");
    expect(cantidadParaElCliente(l, "standard")).toEqual(["Requested Area: 1,250 SF", "Quantity: 53 Boxes"]);
    expect(descripcionParaElCliente(l, "standard")).toBe("24x48 Tile — Main Floor");
  });
  it("Detailed: + la cobertura por caja en la descripción", () => {
    expect(cantidadParaElCliente(l, "detailed")).toEqual(["Requested Area: 1,250 SF", "Quantity: 53 Boxes"]);
    expect(descripcionParaElCliente(l, "detailed")).toBe("24x48 Tile — Main Floor · 23.80 SF/Box");
  });
  it("siempre «Requested Area», nunca «Square Feet»", () => {
    for (const nivel of ["basic", "standard", "detailed"] as const) {
      const hoja = JSON.stringify(hojaDelCliente(borrador({ display_level: nivel })));
      expect(hoja).toContain("Requested Area");
      expect(hoja.toLowerCase()).not.toContain("square feet");
    }
  });
  it("una caja sola se dice en singular", () => {
    expect(cantidadParaElCliente({ ...l, requested_sf: 10, sf_per_box: 23.8 }, "standard")).toEqual(["Requested Area: 10 SF", "Quantity: 1 Box"]);
  });
  it("la línea sin SF: «1 Lot»", () => {
    const lote = { ...lineaUnidadVacia(), customer_category: "Installation Materials", quantity: 1, unit: "Lot", unit_price: 385 };
    expect(cantidadParaElCliente(lote, "basic")).toEqual(["1 Lot"]);
    expect(descripcionParaElCliente(lote, "detailed")).toBe("Installation Materials");
  });
});

describe("la entrega no entra en el total", () => {
  it("con cargo de entrega, el total es el de las líneas (más su impuesto, D-442)", () => {
    const q = borrador();
    const hoja = hojaDelCliente(q);
    expect(totalDeMateriales(q.lines)).toBe(2769.05);
    // 2,769.05 × 8.25 % = 228.446… → 228.45; total 2,997.50. Sin el cargo de 150.
    expect(hoja.total).toBe(resumenDeTotales(q.lines).total);
    expect(hoja.total).toBe(2997.5);
    expect(hoja.textoTotal).toBe("Estimated Material Total: $2,997.50");
  });
  it("el mismo total sin cargo que con cargo de 999", () => {
    expect(hojaDelCliente(borrador()).total).toBe(hojaDelCliente(borrador({ delivery: { ...borrador().delivery, charge: 999 } })).total);
  });
  it("con entrega sale el texto de «Available upon request»; recogiendo, no", () => {
    expect(hojaDelCliente(borrador()).entrega).toBe(TEXTO_DE_ENTREGA);
    expect(hojaDelCliente(borrador({ delivery: { ...borrador().delivery, mode: "pickup" } })).entrega).toBeNull();
  });
});

describe("validez y descargos, literales del documento", () => {
  it("«QUOTE VALID THROUGH SEPTEMBER 8, 2026» junto al total, con el aviso de Final Sale", () => {
    const hoja = hojaDelCliente(borrador());
    expect(hoja.validezConspicua).toBe("QUOTE VALID THROUGH SEPTEMBER 8, 2026");
    expect(hoja.avisoJuntoAlTotal).toBe(AVISO_JUNTO_AL_TOTAL);
    expect(AVISO_JUNTO_AL_TOTAL).toContain("otherwise designated Final Sale");
  });
  it("el encabezado tecleado", () => {
    const html = renderToStaticMarkup(createElement(HojaCliente, { hoja: hojaDelCliente(borrador()) }));
    expect(html).toContain(ENCABEZADO);
    expect(html).toContain(SUBTITULO);
    expect(html).not.toContain("PROJECT SUMMARY"); // el resumen solo sale si se escribe
    const conResumen = renderToStaticMarkup(createElement(HojaCliente, { hoja: hojaDelCliente(borrador({ project_summary: "Main living areas" })) }));
    expect(conResumen).toContain("PROJECT SUMMARY");
    expect(conResumen).toContain("Main living areas");
  });
});

describe("la pantalla imprime ESTA hoja y nada más", () => {
  const pantalla = leer("src/app/estimator/Estimador.tsx");
  const componente = leer("src/app/estimator/HojaCliente.tsx");
  it("la hoja se construye con hojaDelCliente(draft) y es lo único que recibe HojaCliente", () => {
    expect(pantalla).toContain("const hoja = useMemo(() => hojaDelCliente(draft, tiendaHoja), [draft, tiendaHoja]);");
    expect(pantalla).toContain("<HojaCliente hoja={hoja} />");
    expect(pantalla.match(/<HojaCliente /g) ?? []).toHaveLength(1);
  });
  it("el componente impreso no toca el borrador: no conoce ni sus tipos ni sus campos", () => {
    // Sin `\.` detrás: `customer?.phone` también es pedírselo al borrador (lo cazó el mutante M11).
    expect(componente).not.toMatch(/QuoteDraft|customer|item_code|internal_description|price_per_sf|delivery|phone|company|address|store/);
    expect(componente).toMatch(/export function HojaCliente\(\{ hoja \}: \{ hoja: HojaDelCliente \}\)/);
  });
  it("al imprimir se esconde todo lo que no sea la hoja", () => {
    const css = leer("src/app/estimator/estimator.css");
    expect(css).toMatch(/@media print \{\s*body \* \{ visibility: hidden !important; \}\s*\.hoja-cliente, \.hoja-cliente \* \{ visibility: visible !important; \}/);
    expect(leer("src/app/estimator/layout.tsx")).toContain('import "./estimator.css";');
  });
});

describe("la entrega del vendedor (dirección, pin, millas, lista y descuento) NO sale en la hoja (D-442)", () => {
  // El dueño, 2026-09-28: «it should output the price and discount price for the sales rep but not for the customer in
  // the estimate».
  const q = borrador();
  const tarifa = tarifaDeLaCotizacion(q.delivery, demoSettings());
  it("con este borrador la calculadora sí da lista y descuento (si no, la prueba de abajo no probaría nada)", () => {
    expect(tarifa.list).not.toBeNull();
    expect(tarifa.discount).not.toBeNull();
    expect(tarifa.list).not.toBe(tarifa.discount);
    expect(tarifa.zone).toBe("local");
  });
  const prohibidosEntrega = () => [
    INTERNO.direccionEntrega, "Calle Del Pin", "78504", INTERNO.tienda, "23.7", "26.2461", "-98.2297",
    `$${tarifa.list!.toFixed(2)}`, `$${tarifa.discount!.toFixed(2)}`, "LOCAL", "Suggested fee", "List", "Discount", "miles", " mi",
  ];
  for (const nivel of ["basic", "standard", "detailed"] as const) {
    it(`${nivel}: ni en el objeto de la hoja ni en lo que se pinta`, () => {
      const qq = borrador({ display_level: nivel });
      const hoja = hojaDelCliente(qq);
      const html = renderToStaticMarkup(createElement(HojaCliente, { hoja }));
      for (const p of prohibidosEntrega()) {
        expect(JSON.stringify(hoja), p).not.toContain(p);
        expect(html, p).not.toContain(p);
      }
      // Lo que sí dice, igual que antes (D-413).
      expect(html).toContain(TEXTO_DE_ENTREGA);
    });
  }
  it("poner en el cargo la lista o el descuento no cambia la hoja: la hoja no lee el cargo", () => {
    const conLista = hojaDelCliente(borrador({ delivery: { ...q.delivery, charge: tarifa.list } }));
    const conDescuento = hojaDelCliente(borrador({ delivery: { ...q.delivery, charge: tarifa.discount } }));
    expect(conLista).toEqual(conDescuento);
    expect(conLista).toEqual(hojaDelCliente(borrador({ delivery: { ...q.delivery, charge: null } })));
  });
});

describe("el descuento en la hoja: importe regular, «Discount: N%», subtotal, ahorro, impuesto y total (D-442, D-451, D-475)", () => {
  // El dueño, 2026-09-28: «the estimate will show the line total with the regular price they input but then it will
  // show a % discount (not amount) if they provide a secondary lower price. Then at the bottom after the subtotal we will
  // show the amount of savings to then give the final total price with taxes».
  const conDescuento: SfLine = {
    ...lineaSfVacia(), item_code: "DESC-1", internal_description: "Interna con descuento", customer_category: "12x24 Tile",
    requested_sf: 100, sf_per_box: 10, price_per_sf: 10, lower_price_per_sf: 8,
  };
  const sinDescuento: UnitLine = {
    ...lineaUnidadVacia(), customer_category: "Installation Materials", quantity: 1, unit: "Lot", unit_price: 385,
  };
  const q = borrador({ lines: [conDescuento, sinDescuento] });
  const hoja = hojaDelCliente(q);
  const html = renderToStaticMarkup(createElement(HojaCliente, { hoja }));

  it("cada Amount es el total a precio REGULAR, y la línea con descuento lleva su PORCENTAJE, no el precio (D-475)", () => {
    // El dueño, 2026-10-06, con foto de la hoja: «Instead of discount price I want it to be discount %». ($10 − $8) / $10 = 20 %.
    expect(hoja.filas.map((f) => f.importe)).toEqual([1000, 385]);
    expect(hoja.filas.map((f) => f.precioConDescuento)).toEqual(["Discount: 20%", null]);
    expect(html).toContain("$1,000.00");
    expect(html).toContain("Discount: 20%");
    expect(html).not.toContain("Discount price");
    expect(html).not.toContain("$800.00");
  });
  it("el porcentaje va con un decimal si lo tiene, y es el mismo que ve el vendedor", () => {
    const h = hojaDelCliente(borrador({ lines: [{ ...conDescuento, price_per_sf: 12, lower_price_per_sf: 11 }] }));
    expect(h.filas[0].precioConDescuento).toBe("Discount: 8.3%");
  });
  it("subtotal regular 1,385.00 → ahorro 200.00 → impuesto 8.25 % sobre 1,185.00 = 97.76 → total 1,282.76", () => {
    expect(hoja.textoSubtotal).toBe("Subtotal: $1,385.00");
    expect(hoja.textoAhorro).toBe("Savings: −$200.00");
    expect(hoja.textoImpuesto).toBe("Tax 8.25%: $97.76");
    expect(hoja.total).toBe(1282.76);
    expect(hoja.textoTotal).toBe("Estimated Material Total: $1,282.76");
    for (const txt of [hoja.textoSubtotal, hoja.textoAhorro!, hoja.textoImpuesto, hoja.textoTotal]) expect(html).toContain(txt);
  });
  it("ni el $/SF regular ni el de descuento (D-413: el precio unitario nunca se imprime)", () => {
    for (const p of ["$10.00", "$8.00", "10.00/SF", "8.00/SF", "/SF"]) {
      expect(JSON.stringify(hoja), p).not.toContain(p);
      expect(html, p).not.toContain(p);
    }
  });
  it("sin precio más bajo no hay línea de ahorro", () => {
    const sin = hojaDelCliente(borrador({ lines: [{ ...conDescuento, lower_price_per_sf: null }, sinDescuento] }));
    expect(sin.textoAhorro).toBeNull();
    expect(renderToStaticMarkup(createElement(HojaCliente, { hoja: sin }))).not.toContain("Savings");
    expect(sin.filas.every((f) => f.precioConDescuento === null)).toBe(true);
    expect(renderToStaticMarkup(createElement(HojaCliente, { hoja: sin }))).not.toContain("Discount price");
  });
  it("un precio más bajo igual o mayor que el regular no es descuento: ni «−%» ni ahorro, y el importe es el regular", () => {
    for (const bajo of [10, 12]) {
      const h = hojaDelCliente(borrador({ lines: [{ ...conDescuento, lower_price_per_sf: bajo }] }));
      expect(h.filas[0].precioConDescuento).toBeNull();
      expect(h.textoAhorro).toBeNull();
      expect(h.filas[0].importe).toBe(1000);
    }
  });
});

describe("la hoja impresa, sobre la captura del dueño del 2026-09-29 (D-451)", () => {
  const html = (q: QuoteDraft, tienda: string | null = null) =>
    renderToStaticMarkup(createElement(HojaCliente, { hoja: hojaDelCliente(q, tienda) }));

  it("«Valid through» sale UNA vez: la de junto al total; la de arriba se quitó", () => {
    const h = html(borrador());
    expect(h.match(/valid through/gi) ?? []).toHaveLength(1);
    expect(h).toContain("QUOTE VALID THROUGH SEPTEMBER 8, 2026");
    expect(h).not.toContain("Valid through:");
  });

  it("el cargo de entrega se nombra UNA vez: «Delivery charges» solo en «Delivery: Available…»", () => {
    const h = html(borrador());
    expect(h.match(/delivery charges/gi) ?? []).toHaveLength(1);
    expect(h).not.toContain("are not included");
  });

  it("después de «Delivery: Available upon request…» no va NADA", () => {
    const h = html(borrador());
    const i = h.indexOf(TEXTO_DE_ENTREGA);
    expect(i).toBeGreaterThan(-1);
    // Lo que queda detrás del texto son solo cierres de etiqueta.
    expect(h.slice(i + TEXTO_DE_ENTREGA.length)).toMatch(/^(<\/[a-z]+>)*$/);
    for (const quitado of ["Quantity Note", "not an invoice", "promotional or Final Sale", "subject to verification at time of purchase. Certain products"]) {
      expect(h).not.toContain(quitado);
    }
  });

  it("recogiendo, tampoco hay notas al final: la hoja acaba en la validez", () => {
    const h = html(borrador({ delivery: { ...borrador().delivery, mode: "pickup" } }));
    expect(h).not.toContain("Delivery");
    expect(h).not.toContain("Quantity Note");
    expect(h).not.toContain("not an invoice");
  });

  it("la tienda donde se creó sale como «Store: …», y sin tienda no sale la línea", () => {
    expect(hojaDelCliente(borrador(), "  RDZ McAllen ").tienda).toBe("RDZ McAllen");
    expect(html(borrador(), "RDZ McAllen")).toContain("<span>Store:</span> RDZ McAllen");
    expect(hojaDelCliente(borrador()).tienda).toBeNull();
    expect(html(borrador())).not.toContain("Store:");
    expect(html(borrador(), "   ")).not.toContain("Store:");
  });

  it("la tienda de la hoja: la de la cotización guardada; si no hay, la de quien prepara", () => {
    expect(tiendaDeLaHoja("RDZ Pharr", "RDZ McAllen")).toBe("RDZ Pharr");
    expect(tiendaDeLaHoja(null, "RDZ McAllen")).toBe("RDZ McAllen");
    expect(tiendaDeLaHoja("  ", " RDZ McAllen ")).toBe("RDZ McAllen");
    expect(tiendaDeLaHoja(null, null)).toBeNull();
  });

  it("la pantalla le pasa a la hoja la tienda guardada (la de la cotización abierta) o la del perfil", () => {
    const pantalla = leer("src/app/estimator/Estimador.tsx");
    expect(pantalla).toContain("const tiendaHoja = tiendaDeLaHoja(tiendaGuardada, me?.store);");
    expect(pantalla).toContain("setTiendaGuardada(c.valor.store);");
  });
});

describe("el descuento en la pantalla es un PRECIO opcional (D-451)", () => {
  // El dueño, 2026-09-29: «descuento is a price not a percentage and has to be an optional field».
  const pantalla = leer("src/app/estimator/Estimador.tsx");
  it("el campo se llama precio con descuento y dice (opcional), por SF y por unidad", () => {
    expect(pantalla).toContain('t("Discount price $/SF (optional)", "Precio con descuento $/SF (opcional)")');
    expect(pantalla).toContain('t("Discount unit price (optional)", "Precio unitario con descuento (opcional)")');
    expect(pantalla).not.toContain("Lower $/SF");
  });
  it("vacío = sin descuento: ni precio con descuento en la hoja, ni ahorro, ni falta nada por ello", () => {
    const q = borrador({ delivery: { ...borrador().delivery, mode: "pickup" } });
    const h = hojaDelCliente(q);
    expect(h.filas.every((f) => f.precioConDescuento === null)).toBe(true);
    expect(h.textoAhorro).toBeNull();
    expect(loQueFalta(q, "propia", "2026-09-08")).toEqual([]);
  });
  it("la línea de la pantalla enseña primero el precio con descuento; el % queda como dato entre paréntesis", () => {
    expect(pantalla).toContain('{t("Discount price", "Precio con descuento")}: <b data-total-bajo>{dinero(tot)}</b> <span className="hint">({numero(pct)}% {t("off", "menos")})</span>');
  });
});
