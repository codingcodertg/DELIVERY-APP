import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import PizZip from "pizzip";
import {
  aplicaValoresADocx, aplicaValoresAXml, camposDeDocx, camposDeXml, claveDeEntrada, claveSugerida, esRunAmarillo,
  clavesObligatorias, esHueco, etiquetasDeCampos, faltanCampos, fechaMDY, pagoFormateado, pasaValores, valoresSugeridos,
} from "./campos-de-documento";

const fixture = () => readFileSync(join(process.cwd(), "src/lib/recruiting/__fixtures__/politica-comisiones-jr.docx"));

/** Un párrafo mínimo con runs dados: [texto, amarillo?]. */
const parrafo = (runs: [string, boolean][]) =>
  `<w:p>` +
  runs.map(([t, y]) => `<w:r>${y ? '<w:rPr><w:highlight w:val="yellow"/></w:rPr>' : "<w:rPr><w:b/></w:rPr>"}<w:t xml:space="preserve">${t}</w:t></w:r>`).join("") +
  `</w:p>`;

describe("detección sobre el documento de comisiones real", () => {
  const campos = camposDeDocx(fixture());

  it("encuentra exactamente los cinco campos amarillos, y nada del gris claro", () => {
    expect(campos.map((c) => c.original)).toEqual([
      "____________________",
      "Junior Sales Representative",
      "Junior Sales Representative",
      "40",
      "$11",
    ]);
  });

  it("las dos partes amarillas de «Applies to» (Junior + Sales Representative) son UN campo", () => {
    const applies = campos.find((c) => c.etiqueta === "Applies to");
    expect(applies?.original).toBe("Junior Sales Representative");
  });

  it("las etiquetas son las que se ven antes de los dos puntos", () => {
    expect(etiquetasDeCampos(campos)).toEqual(["Effective Date", "Applies to", "Position", "Employment Type", "Base Pay"]);
  });

  it("la clave sugerida sale de la etiqueta (y «40» es horas por el texto que sigue)", () => {
    expect(campos.map((c) => c.clave)).toEqual(["start_date", "position", "position", "weekly_hours", "pay_rate"]);
  });

  it("«Applies to» y «Position» comparten el mismo valor de formulario", () => {
    const claves = campos.map((c) => claveDeEntrada(c));
    expect(claves[1]).toBe("position");
    expect(claves[2]).toBe("position");
  });
});

describe("merge de runs adyacentes", () => {
  it("runs amarillos seguidos son un solo campo", () => {
    const xml = `<w:body>${parrafo([["Applies to: ", false], ["Junior", true], [" Sales Representative", true], [" fin", false]])}</w:body>`;
    const c = camposDeXml(xml);
    expect(c).toHaveLength(1);
    expect(c[0].original).toBe("Junior Sales Representative");
  });

  it("un run gris entre dos amarillos separa dos campos", () => {
    const xml = `<w:body>${parrafo([["A: ", false], ["uno", true], [" y ", false], ["dos", true]])}</w:body>`;
    expect(camposDeXml(xml).map((c) => c.original)).toEqual(["uno", "dos"]);
  });

  it("el relleno FFFF00 de la celda cuenta igual que el resaltado amarillo", () => {
    const run = '<w:r><w:rPr><w:shd w:val="clear" w:color="auto" w:fill="FFFF00"/></w:rPr><w:t>x</w:t></w:r>';
    expect(esRunAmarillo(run)).toBe(true);
    expect(esRunAmarillo('<w:r><w:rPr><w:highlight w:val="lightGray"/></w:rPr><w:t>x</w:t></w:r>')).toBe(false);
  });
});

describe("heurística de clave", () => {
  it.each([
    ["Effective Date", "", "____", "start_date"],
    ["Applies to", "", "Junior", "position"],
    ["Position", "", "Junior Sales Representative", "position"],
    ["Employment Type", " hours per week", "40", "weekly_hours"],
    ["Base Pay", " per hour (paid hourly)", "$11", "pay_rate"],
    ["Employee Name", "", "x", "employee_name"],
    ["Store", "", "x", "store"],
    ["Tax ID", "", "x", "otro"],
  ])("«%s» → %s", (etiqueta, despues, original, esperada) => {
    expect(claveSugerida(etiqueta, despues, original)).toBe(esperada);
  });

  it("«Base Pay … per hour» es pago, no horas", () => {
    expect(claveSugerida("Base Pay", " per hour", "$11")).toBe("pay_rate");
  });
});

describe("aplicar valores", () => {
  it("reemplaza el texto amarillo, le quita el amarillo y deja lo demás igual", () => {
    const xml = `<w:body>${parrafo([["Applies to: ", false], ["Junior", true], [" Sales Representative", true], [" fin", false]])}</w:body>`;
    const nuevo = aplicaValoresAXml(xml, { position: "Senior Sales" });
    expect(nuevo).toContain("Senior Sales");
    expect(nuevo).not.toContain("Junior");
    expect(nuevo).not.toContain("Sales Representative");
    expect(nuevo).not.toContain("yellow");
    // El texto gris y su formato se conservan.
    expect(nuevo).toContain("Applies to: ");
    expect(nuevo).toContain("<w:b/>");
    expect(nuevo).toContain(" fin");
    // Sin campo de ese valor: el original se queda.
    expect(aplicaValoresAXml(xml, {})).toContain("Junior Sales Representative");
  });

  it("escapa caracteres XML en el valor", () => {
    const xml = `<w:body>${parrafo([["Tax ID: ", false], ["x", true]])}</w:body>`;
    expect(aplicaValoresAXml(xml, { "p0-g0": "A & B <c>" })).toContain("A &amp; B &lt;c&gt;");
  });

  it("sobre el documento real: fecha, puesto, horas y pago quedan escritos y sin amarillo", () => {
    const campos = camposDeDocx(fixture());
    const valores = valoresSugeridos(campos, {
      fullName: "Ana Pérez", position: "Junior Sales Representative", hireDate: "2026-11-02", payRate: 11, store: "RDZ Pharr",
    });
    // Horas y pago los escribe RR. HH. a mano.
    valores.weekly_hours = "45";
    valores.pay_rate = "$11";
    const bytes = aplicaValoresADocx(fixture(), valores);
    const xml = new PizZip(bytes).file("word/document.xml")!.asText();
    // Lo que quedó amarillo son solo marcas de párrafo (fuera de los runs), que no son campos.
    expect(camposDeXml(xml)).toHaveLength(0);
    const despues = camposDeXml(xml);
    expect(despues).toHaveLength(0);
    expect(xml).toContain("11/02/2026");
    expect(xml).toContain("$11");
    expect(xml).toContain(">45<");
    // El resto del documento (el gris claro) no se toca.
    expect(xml).toContain('w:val="lightGray"');
  });
});

describe("horas y pago se escriben a mano", () => {
  const campos = [
    { id: "p10-g0", original: "40", etiqueta: "Employment Type", clave: "weekly_hours" as const },
    { id: "p11-g0", original: "$11", etiqueta: "Base Pay", clave: "pay_rate" as const },
    { id: "p2-g0", original: "____", etiqueta: "Effective Date", clave: "start_date" as const },
  ];
  it("nunca salen del expediente: aunque el empleado tenga tarifa, quedan vacíos", () => {
    const v = valoresSugeridos(campos, { payRate: 13, hireDate: "2026-11-02" });
    expect(v.pay_rate).toBe("");
    expect(v.weekly_hours).toBe("");
    expect(v.start_date).toBe("11/02/2026");
  });
  it("todo campo amarillo es obligatorio: sin llenarlos, imprimir no se activa", () => {
    expect(clavesObligatorias(campos).sort()).toEqual(["pay_rate", "start_date", "weekly_hours"]);
    // Sin fecha de ingreso, la fecha queda vacía (la raya del documento no es un dato) y también falta.
    expect(valoresSugeridos(campos, {}).start_date).toBe("");
    expect(faltanCampos(campos, valoresSugeridos(campos, {}))).toEqual(["weekly_hours", "pay_rate", "start_date"]);
    expect(faltanCampos(campos, valoresSugeridos(campos, { hireDate: "2026-11-02" }))).toEqual(["weekly_hours", "pay_rate"]);
    expect(faltanCampos(campos, { weekly_hours: "40", pay_rate: "  ", start_date: "11/02/2026" })).toEqual(["pay_rate"]);
    expect(faltanCampos(campos, { weekly_hours: "40", pay_rate: "$11", start_date: "____" })).toEqual(["start_date"]);
    expect(faltanCampos(campos, { weekly_hours: "40", pay_rate: "$11", start_date: "11/02/2026" })).toEqual([]);
  });
  it("un campo sin clave también se pide, con su propio id", () => {
    const otro = [{ id: "p7-g0", original: "Brownsville", etiqueta: "Ciudad", clave: "otro" as const }];
    expect(clavesObligatorias(otro)).toEqual(["p7-g0"]);
    expect(faltanCampos(otro, valoresSugeridos(otro, {}))).toEqual([]);
    expect(faltanCampos(otro, { "p7-g0": " " })).toEqual(["p7-g0"]);
  });
});

describe("valores sugeridos", () => {
  const campos = [
    { id: "p2-g0", original: "____", etiqueta: "Effective Date", clave: "start_date" as const },
    { id: "p4-g0", original: "Junior", etiqueta: "Applies to", clave: "position" as const },
    { id: "p9-g0", original: "Junior Sales Representative", etiqueta: "Position", clave: "position" as const },
    { id: "p10-g0", original: "40", etiqueta: "Employment Type", clave: "weekly_hours" as const },
    { id: "p11-g0", original: "$11", etiqueta: "Base Pay", clave: "pay_rate" as const },
  ];
  it("toma los datos del empleado y deja el original cuando no hay dato", () => {
    const v = valoresSugeridos(campos, { fullName: "Ana", position: "Senior Sales", hireDate: "2026-11-02", payRate: null, store: "" });
    expect(v.start_date).toBe("11/02/2026");
    expect(v.position).toBe("Senior Sales");
    // Horas y pago: vacíos, a mano, nunca del expediente ni del original.
    expect(v.weekly_hours).toBe("");
    expect(v.pay_rate).toBe("");
  });
  it("fecha MM/DD/YYYY y pago con o sin decimales", () => {
    expect(fechaMDY("2026-01-05")).toBe("01/05/2026");
    expect(fechaMDY(null)).toBe("");
    expect(pagoFormateado(12.5)).toBe("$12.50");
    expect(pagoFormateado(13)).toBe("$13");
  });
});

describe("el mismo documento en español", () => {
  const en = [
    { id: "p2-g0", original: "____________________", etiqueta: "Effective Date", clave: "start_date" as const },
    { id: "p4-g0", original: "Junior Sales Representative", etiqueta: "Applies to", clave: "position" as const },
    { id: "p9-g0", original: "Junior Sales Representative", etiqueta: "Position", clave: "position" as const },
    { id: "p10-g0", original: "40", etiqueta: "Employment Type", clave: "weekly_hours" as const },
    { id: "p11-g0", original: "$11", etiqueta: "Base Pay", clave: "pay_rate" as const },
    { id: "p20-g0", original: "Brownsville", etiqueta: "City", clave: "otro" as const },
  ];
  const es = [
    { id: "p2-g0", original: "____________________", etiqueta: "Fecha de vigencia", clave: "start_date" as const },
    { id: "p4-g0", original: "Representante de Ventas Junior", etiqueta: "Puesto al que aplica", clave: "position" as const },
    { id: "p9-g0", original: "Representante de Ventas Junior", etiqueta: "Puesto", clave: "position" as const },
    { id: "p10-g0", original: "40", etiqueta: "Tipo de empleo", clave: "weekly_hours" as const },
    { id: "p11-g0", original: "$11", etiqueta: "Pago base", clave: "pay_rate" as const },
    { id: "p21-g0", original: "Brownsville (TX)", etiqueta: "Ciudad", clave: "otro" as const },
  ];
  const datos = { position: "Junior Sales Representative", hireDate: "2026-11-02" };

  it("la raya de escribir a mano es un hueco; un texto no", () => {
    expect(esHueco("____________________")).toBe(true);
    expect(esHueco("  ")).toBe(true);
    expect(esHueco(undefined)).toBe(true);
    expect(esHueco("$11")).toBe(false);
  });
  it("en español el puesto sale del documento (ya traducido), no del expediente", () => {
    expect(valoresSugeridos(en, datos, { idioma: "en" }).position).toBe("Junior Sales Representative");
    expect(valoresSugeridos(es, datos, { idioma: "es" }).position).toBe("Representante de Ventas Junior");
  });
  it("al cambiar de idioma pasa lo escrito (horas, pago, fecha cambiada) y lo no tocado toma lo del documento nuevo", () => {
    const sugEn = valoresSugeridos(en, datos, { idioma: "en" });
    const sugEs = valoresSugeridos(es, datos, { idioma: "es" });
    const escritos = { ...sugEn, weekly_hours: "32", pay_rate: "$13", start_date: "12/01/2026" };
    const v = pasaValores({ campos: en, valores: escritos, sugeridos: sugEn }, { campos: es, sugeridos: sugEs });
    expect(v.weekly_hours).toBe("32");
    expect(v.pay_rate).toBe("$13");
    expect(v.start_date).toBe("12/01/2026");
    // El puesto no se tocó: queda el del documento en español, no el inglés.
    expect(v.position).toBe("Representante de Ventas Junior");
    // El campo sin clave no se tocó: queda el texto del documento nuevo, con SU id.
    expect(v["p21-g0"]).toBe("Brownsville (TX)");
    expect(faltanCampos(es, v)).toEqual([]);
  });
  it("un puesto o un campo sin clave que sí se cambió, pasa (por su orden en el documento)", () => {
    const sugEn = valoresSugeridos(en, datos);
    const v = pasaValores(
      { campos: en, valores: { ...sugEn, position: "Sales Lead", "p20-g0": "Harlingen" }, sugeridos: sugEn },
      { campos: es, sugeridos: valoresSugeridos(es, datos, { idioma: "es" }) },
    );
    expect(v.position).toBe("Sales Lead");
    expect(v["p21-g0"]).toBe("Harlingen");
  });
});
