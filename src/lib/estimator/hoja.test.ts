import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HojaCliente } from "@/app/estimator/HojaCliente";
import {
  AVISO_JUNTO_AL_TOTAL, DESCARGO_FINAL, ENCABEZADO, NOTA_DE_CANTIDAD, NOTA_DE_ENTREGA_EXCLUIDA, SUBTITULO, TEXTO_DE_ENTREGA,
  cantidadParaElCliente, descripcionParaElCliente, hojaDelCliente,
} from "./hoja";
import { borradorVacio, lineaSfVacia, lineaUnidadVacia, totalDeMateriales, type QuoteDraft, type SfLine } from "./modelo";

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
      company: INTERNO.empresa, phone: INTERNO.telefono, address: INTERNO.direccion,
    },
    delivery: { mode: "delivery", street: INTERNO.calle, city: INTERNO.ciudad, state: "TX", zip: INTERNO.zip, charge: 150 },
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
      "avisoJuntoAlTotal", "encabezado", "entrega", "filas", "notas", "preparadoPara", "referencia", "representante",
      "resumen", "subtitulo", "textoTotal", "total", "validaHasta", "validezConspicua",
    ]);
    for (const f of hojaDelCliente(borrador()).filas) expect(Object.keys(f).sort()).toEqual(["cantidad", "descripcion", "importe"]);
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
  it("con cargo de entrega, el total es el de las líneas", () => {
    const q = borrador();
    const hoja = hojaDelCliente(q);
    expect(hoja.total).toBe(totalDeMateriales(q.lines));
    expect(hoja.total).toBe(2769.05);
    expect(hoja.textoTotal).toBe("Estimated Material Total: $2,769.05");
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
    expect(hoja.validaHasta).toBe("September 8, 2026");
    expect(hoja.avisoJuntoAlTotal).toBe(AVISO_JUNTO_AL_TOTAL);
    expect(AVISO_JUNTO_AL_TOTAL).toContain("otherwise designated Final Sale");
  });
  it("los descargos del final, y la nota de caja completa solo si hay cajas", () => {
    expect(hojaDelCliente(borrador()).notas).toEqual([NOTA_DE_CANTIDAD, NOTA_DE_ENTREGA_EXCLUIDA, DESCARGO_FINAL]);
    const soloLote = borrador({ lines: [borrador().lines[1]] });
    expect(hojaDelCliente(soloLote).notas).toEqual([NOTA_DE_ENTREGA_EXCLUIDA, DESCARGO_FINAL]);
    expect(DESCARGO_FINAL).toContain("is not an invoice, sales order, inventory reservation, or guarantee of availability");
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
    expect(pantalla).toContain("const hoja = useMemo(() => hojaDelCliente(draft), [draft]);");
    expect(pantalla).toContain("<HojaCliente hoja={hoja} />");
    expect(pantalla.match(/<HojaCliente /g) ?? []).toHaveLength(1);
  });
  it("el componente impreso no toca el borrador: no conoce ni sus tipos ni sus campos", () => {
    // Sin `\.` detrás: `customer?.phone` también es pedírselo al borrador (lo cazó el mutante M11).
    expect(componente).not.toMatch(/QuoteDraft|customer|item_code|internal_description|price_per_sf|delivery|phone|company|address/);
    expect(componente).toMatch(/export function HojaCliente\(\{ hoja \}: \{ hoja: HojaDelCliente \}\)/);
  });
  it("al imprimir se esconde todo lo que no sea la hoja", () => {
    const css = leer("src/app/estimator/estimator.css");
    expect(css).toMatch(/@media print \{\s*body \* \{ visibility: hidden !important; \}\s*\.hoja-cliente, \.hoja-cliente \* \{ visibility: visible !important; \}/);
    expect(leer("src/app/estimator/layout.tsx")).toContain('import "./estimator.css";');
  });
});
