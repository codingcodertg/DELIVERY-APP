import { describe, expect, it } from "vitest";
import { etiquetaDeOrden, textoDeEtiqueta, tituloDeEtiqueta } from "./etiqueta-de-parada";

const t = (en: string) => en;
const es = (_en: string, es: string) => es;

describe("D-NEXT: la etiqueta de una orden en el Recorrido", () => {
  it("nombra la orden por su factura cuando la tiene", () => {
    const e = etiquetaDeOrden({ invoice_num: " 70412 ", order_code: "FW171" });
    expect(e).toEqual({ texto: "70412", suplente: false, codigo: "FW171", factura: "70412" });
    expect(textoDeEtiqueta(e, t)).toBe("70412");
    // El código no se pierde: va en el título.
    expect(tituloDeEtiqueta(e, t)).toBe("Invoice 70412 · order FW171");
    expect(tituloDeEtiqueta(e, es)).toBe("Factura 70412 · orden FW171");
  });

  it("sin factura, enseña el código como suplente, dicho claramente", () => {
    const e = etiquetaDeOrden({ invoice_num: null, order_code: "FW171" });
    expect(e).toEqual({ texto: "#FW171", suplente: true, codigo: "FW171", factura: null });
    expect(textoDeEtiqueta(e, t)).toBe("#FW171 (no invoice)");
    expect(textoDeEtiqueta(e, es)).toBe("#FW171 (sin factura)");
    expect(tituloDeEtiqueta(e, t)).toBe("Order FW171 · no invoice number");
  });

  it("conserva la letra de una carga partida y el paso de un relevo, como el resto de la app", () => {
    expect(etiquetaDeOrden({ invoice_num: "500", order_code: "FA100", order_suffix: "a", relay_step: null }).texto).toBe("500a");
    expect(etiquetaDeOrden({ invoice_num: null, order_code: "FA100", order_suffix: "a", relay_step: null })).toMatchObject({ texto: "#FA100a", suplente: true });
    expect(etiquetaDeOrden({ invoice_num: "500", order_code: "FA100", order_suffix: null, relay_step: 1 }).texto).toBe("Tr-500-a");
  });

  it("una factura en blanco cuenta como sin factura", () => {
    expect(etiquetaDeOrden({ invoice_num: "   ", order_code: "FW9" }).suplente).toBe(true);
  });

  it("acepta la forma de las paradas del plan (`factura` / `codigo`)", () => {
    expect(etiquetaDeOrden({ factura: "88001", codigo: "FW186" })).toMatchObject({ texto: "88001", suplente: false, codigo: "FW186" });
    expect(etiquetaDeOrden({ factura: null, codigo: "FW186" })).toMatchObject({ texto: "#FW186", suplente: true });
  });

  it("sin factura ni código no inventa nada", () => {
    const e = etiquetaDeOrden({});
    expect(e.texto).toBe("—");
    expect(e.suplente).toBe(true);
    expect(tituloDeEtiqueta(e, t)).toBe("No invoice number");
  });

  it("el texto del globo es texto plano: lo que venga en la factura no se convierte en marcado", () => {
    // Los globos de Leaflet pasan por `soloTexto()`; aquí solo se comprueba que la cadena sale tal cual, sin escapar ni
    // interpretar: escapar sería síntoma de que alguien la pensaba interpolar como HTML.
    const e = etiquetaDeOrden({ invoice_num: "<b>123</b>", order_code: "FW1" });
    expect(textoDeEtiqueta(e, t)).toBe("<b>123</b>");
  });
});

// ---- D-NEXT: dónde se usa en el Recorrido (lectura del fuente, como `recorrido.test.ts`) ----
import { readFileSync } from "node:fs";
const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");

describe("D-NEXT: el Recorrido nombra las órdenes por su factura", () => {
  const pagina = leer("src/app/(app)/track/page.tsx");
  const plan = leer("src/components/PlanContraReal.tsx");
  it("la lista de cargas y entregas, las entregadas del día y las paradas del plan usan la etiqueta, no el código a secas", () => {
    expect(pagina).not.toContain("#${orderLabel(d)}");
    expect(pagina).toContain("<EtiquetaDeOrden orden={h.orden}");
    expect(pagina).toContain("<EtiquetaDeOrden orden={d} onAbrir={abrirOrden(d.id)}");
    expect(plan).toContain("<EtiquetaDeOrden orden={o}");
    expect(plan).not.toContain("${o.codigo}`).join");
  });
  it("los globos del mapa (paradas del plan, cargas y entregas, paradas con nombre) llevan la factura como texto plano", () => {
    expect(pagina).toContain("p.ordenes.map((o) => textoDeEtiqueta(etiquetaDeOrden(o), t))");
    expect(pagina).toContain("const etiqueta = d ? `${textoDeEtiqueta(etiquetaDeOrden(d), t)}");
    expect(pagina).toContain("label: `${textoDeEtiqueta(etiquetaDeOrden(d), t)}");
    // Leaflet trata una cadena como HTML: la etiqueta entra por `soloTexto()`.
    const mapa = leer("src/components/LeafletMap.tsx");
    expect(mapa).toContain("marker.bindTooltip(soloTexto(p.label))");
  });
  it("pulsar una orden abre su ficha en la misma pantalla", () => {
    expect(pagina).toContain('import { OrderModal } from "@/components/OrderModalLazy";');
    expect(pagina).toContain("{ordenAbierta && <OrderModal me={me as Profile} existing={ordenAbierta}");
    expect(plan).toContain("abrirOrden?.(o.id)");
  });
  it("la ruta del plan trae la factura y el id de cada orden", () => {
    expect(leer("src/lib/reportes-choferes/carga.ts")).toContain('"id, order_code, invoice_num,');
    expect(leer("src/lib/apego-a-la-ruta/apego.ts")).toContain("factura: p.factura ?? null");
  });
  it("el Panel y los Reportes de choferes no cambian", () => {
    expect(leer("src/app/(app)/page.tsx")).not.toContain("EtiquetaDeOrden");
    expect(leer("src/app/(app)/dashboard/page.tsx")).not.toContain("EtiquetaDeOrden");
  });
});
