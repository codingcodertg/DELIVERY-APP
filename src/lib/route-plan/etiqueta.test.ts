import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { etiquetaDeOrden, idDeLaOrden, nombraLaOrden } from "./etiqueta";

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
    // Salvo la columna ID del plan (D-434), que lleva SOLO el id: la factura tiene allí su columna (ver abajo).
    for (const uso of ["<ComparaConLaHoja date={date} nombreDeOrden={nombreDeOrden} />", ">{nombreDeOrden(x.id)}</button> : nombreDeOrden(x.id)}</b>"]) expect(panel).toContain(uso);
    expect(leer("src/components/MiPlanPublicado.tsx")).toContain("{nombreDeOrden(p.delivery_id, p.order_ref)}");
  });
});

describe("a dónde va cada entrega del plan (D-422, reemplazada en parte por D-434)", () => {
  // D-422 ponía «📍 ciudad · dirección» bajo cada entrega. Desde D-434 la dice la columna «Dirección de entrega», y la línea
  // repetida se quitó: el dueño, «deja direcion de entrega y ventana».
  it("la tabla del plan ya no pinta la línea 📍 bajo las entregas, ni el panel se la pasa", () => {
    const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\s+/g, " ");
    expect(leer("src/components/RutaDelPlan.tsx")).not.toContain("data-destino");
    expect(leer("src/components/RutaDelPlan.tsx")).not.toContain("destinoDeOrden");
    expect(leer("src/components/PlanDelDia.tsx")).not.toContain("destinoDeOrden");
  });
});

describe("abrir la orden desde el plan, y atajos de fecha del Gestor (D-428)", () => {
  const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\s+/g, " ");
  it("en el borrador, la orden y su factura abren la ficha completa (paradas y «Fuera de este plan»)", () => {
    const ruta = leer("src/components/RutaDelPlan.tsx");
    // D-NEXT: lo que se pulsa es la FACTURA (el ID, en gris, si la orden no tiene).
    expect(ruta).toContain("onClick={() => abrirOrden(p.order_ref)}>{n.principal}</button>");
    const plan = leer("src/components/PlanDelDia.tsx");
    expect(plan).toContain("abrirOrden={onAbrirOrden}");
    expect(plan).toContain("onClick={() => onAbrirOrden(x.id)}>{nombreDeOrden(x.id)}</button>");
    const gestor = leer("src/app/(app)/routes/page.tsx");
    // Una carga partida (`id#b`) abre su orden.
    expect(gestor).toContain('onAbrirOrden={(id) => { const d = deliveries.find((x) => x.id === id.split("#")[0]); if (d) setOpenOrder(d); }}');
  });
  it("Ayer, Hoy y Mañana siempre a la vista, relativos a HOY (no al día que se mira), y el que se mira sale marcado", () => {
    const gestor = leer("src/app/(app)/routes/page.tsx");
    expect(gestor).toContain('[[-1, t("Yesterday", "Ayer")], [0, t("Today", "Hoy")], [1, t("Tomorrow", "Mañana")]]');
    expect(gestor).toContain("const dia = shiftDateISO(todayISO(), dias);");
    expect(gestor).toContain('className={"btn btn-sm " + (date === dia ? "btn-primary" : "btn-ghost")}');
  });
});

describe("la columna ID del plan: solo el id (D-434; reemplaza en parte D-431)", () => {
  // D-431 puso la orden antes de «Recoger / Entregar». El dueño, después: «quiero que haya una columna solo para el id». La
  // acción ya la dice la etiqueta P/D, que la lleva como título; la factura va en su columna.
  const ruta = readFileSync(join(process.cwd(), "src/components/RutaDelPlan.tsx"), "utf8").replace(/\s+/g, " ");
  it("el id sin la factura, también para una carga partida; una orden fuera de la vista, por su referencia", () => {
    expect(idDeLaOrden(ORDENES, "a")).toBe("#RDZ-0012");
    expect(idDeLaOrden(ORDENES, "a#b")).toBe("#RDZ-0012");
    expect(idDeLaOrden(ORDENES, "b")).toBe("#13b");
    expect(idDeLaOrden(ORDENES, "11111111-2222-3333")).toBe("11111111");
  });
  it("D-NEXT: la celda fija pinta la FACTURA con el ID debajo (era solo el id), y el panel le pasa `facturaYIdDeLaOrden`", () => {
    expect(ruta).toContain("<th>#</th><th data-columna-factura");
    expect(ruta).toContain("{t(\"Invoice #\", \"Factura #\")}</th>");
    expect(ruta).toContain("const n = facturaDeOrden(p.order_ref);");
    expect(ruta).toContain("{n.id && <div className=\"hint\" data-id-de-la-orden");
    expect(ruta).not.toContain("data-columna-id");
    expect(ruta).not.toContain("data-accion-parada");
    expect(ruta).not.toContain("{nombreDeOrden(");
    expect(ruta).toContain("<td title={p.kind === \"P\" ? t(\"Pick up\", \"Recoger\") : t(\"Deliver\", \"Entregar\")}><b>{p.label}</b>");
    const panel = readFileSync(join(process.cwd(), "src/components/PlanDelDia.tsx"), "utf8").replace(/\s+/g, " ");
    expect(panel).toContain("const idDeOrden = (id: string) => idDeLaOrden(deliveries, id);");
    expect(panel).toContain("const facturaDeOrden = (id: string) => facturaYIdDeLaOrden(deliveries, id);");
    expect(panel).toContain("<RutaDelPlan rutas={borrador!.rutas} facturaDeOrden={facturaDeOrden}");
  });
  it("la pastilla Builder y el lugar ya no van junto al id: los dicen «Tipo de cliente» y «Ciudad de recogida»", () => {
    expect(ruta).not.toContain("p.builder &&");
    expect(ruta).not.toContain("{p.place &&");
  });
});
