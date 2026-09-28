import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { destinoDeLaOrden, etiquetaDeOrden, nombraLaOrden } from "./etiqueta";

/** Cómo se nombra una orden en todo lo del plan de ruta (D-331): código Y factura. */

const ORDENES = [
  { id: "a", order_code: "RDZ-0012", order_no: 12, order_suffix: null, invoice_num: " F-9001 " },
  { id: "b", order_code: null, order_no: 13, order_suffix: "b", invoice_num: null },
  { id: "c", order_code: "RDZ-0014", order_no: 14, invoice_num: "   " },
];

describe("código y factura", () => {
  it("con factura: las dos cosas, en el idioma de quien mira; sin factura —o en blanco—, solo el código", () => {
    expect(etiquetaDeOrden(ORDENES[0], true)).toBe("#RDZ-0012 · Fact. F-9001");
    expect(etiquetaDeOrden(ORDENES[0], false)).toBe("#RDZ-0012 · Inv. F-9001");
    expect(etiquetaDeOrden(ORDENES[1], true)).toBe("#13b");
    expect(etiquetaDeOrden(ORDENES[2], true)).toBe("#RDZ-0014");
  });
  it("una CARGA de una orden repartida (`<id>#b`) se nombra como su orden; una que ya no está a la vista, por su referencia", () => {
    expect(nombraLaOrden(ORDENES, "a#b", true)).toBe("#RDZ-0012 · Fact. F-9001");
    expect(nombraLaOrden(ORDENES, "a", true)).toBe("#RDZ-0012 · Fact. F-9001");
    expect(nombraLaOrden(ORDENES, "11111111-2222-3333", true)).toBe("11111111");
  });
});

describe("dónde se usa", () => {
  const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n").replace(/\s+/g, " ");
  it("el panel del plan y «Mi ruta» nombran la orden con la misma función — la que lleva la factura", () => {
    expect(leer("src/components/PlanDelDia.tsx")).toContain('nombraLaOrden(deliveries, id, lang === "es")');
    expect(leer("src/app/(app)/my-route/page.tsx")).toContain('nombreDeOrden={(id, ref) => nombraLaOrden(deliveries, id ?? ref, lang === "es")}');
    // Y de ahí beben las paradas, «Fuera de este plan», la comparación con la hoja y la tarjeta del chofer.
    const panel = leer("src/components/PlanDelDia.tsx");
    for (const uso of ["<RutaDelPlan rutas={borrador!.rutas} nombreDeOrden={nombreDeOrden}", "<ComparaConLaHoja date={date} nombreDeOrden={nombreDeOrden} />", "<b>{nombreDeOrden(x.id)}</b>"]) expect(panel).toContain(uso);
    expect(leer("src/components/RutaDelPlan.tsx")).toContain("{nombreDeOrden(p.order_ref)}");
    expect(leer("src/components/MiPlanPublicado.tsx")).toContain("{nombreDeOrden(p.delivery_id, p.order_ref)}");
  });
});

describe("a dónde va cada entrega del plan (D-422)", () => {
  const conDireccion = [
    { id: "o1", order_no: 1, delivery_address: "100  Calle Falsa, Ciudad Uno, TX 78500, USA" },
    { id: "o2", order_no: 2, delivery_address: "   " },
    { id: "o3", order_no: 3 },
  ];
  it("la ciudad y la dirección salen de la orden, también para una carga partida (`id#b`)", () => {
    expect(destinoDeLaOrden(conDireccion, "o1")).toEqual({ ciudad: "Ciudad Uno", direccion: "100 Calle Falsa, Ciudad Uno, TX 78500, USA" });
    expect(destinoDeLaOrden(conDireccion, "o1#b")?.ciudad).toBe("Ciudad Uno");
  });
  it("sin dirección o sin la orden a la vista, nada (no se inventa un destino)", () => {
    expect(destinoDeLaOrden(conDireccion, "o2")).toBeNull();
    expect(destinoDeLaOrden(conDireccion, "o3")).toBeNull();
    expect(destinoDeLaOrden(conDireccion, "otra")).toBeNull();
  });
  it("el borrador de «Planificar el día» lo pinta en cada entrega sin lugar", () => {
    const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\s+/g, " ");
    const ruta = leer("src/components/RutaDelPlan.tsx");
    expect(ruta).toContain('{p.kind === "D" && !p.place && (() => { const destino = destinoDeOrden?.(p.order_ref);');
    expect(ruta).toContain("<div data-destino");
    const plan = leer("src/components/PlanDelDia.tsx");
    expect(plan).toContain("const destinoDeOrden = (id: string) => destinoDeLaOrden(deliveries, id);");
    expect(plan).toContain("destinoDeOrden={destinoDeOrden}");
  });
});
