import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import PizZip from "pizzip";
import {
  camposDeDocx, camposDeXml, claveDeEntrada, marcadorDeCampo, marcaCamposAXml, marcaCamposDocx, type CampoDetectado,
} from "./campos-de-documento";
import { htmlDeDocx } from "./imprimir-documento";
import {
  ayudaDeCampo, escapaHtml, isoDeMDY, mdyDeIso, numerosDeMarcadores, pagoConSigno, pagoSinSigno, progresoDeCampos, sustituyeMarcadores,
} from "./vista-de-documento";

const fixture = () => readFileSync(join(process.cwd(), "src/lib/recruiting/__fixtures__/politica-comisiones-jr.docx"));

const campo = (id: number, etiqueta: string, clave: CampoDetectado["clave"], original = "x"): CampoDetectado => ({
  id: `p0-g${id}`, original, etiqueta, clave,
});

describe("el marcador ⟦Fn⟧ en el XML", () => {
  // Un párrafo con dos campos amarillos y un texto normal entre ellos.
  const xml = `<w:body><w:p><w:r><w:t xml:space="preserve">Effective Date: </w:t></w:r>` +
    `<w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>____</w:t></w:r>` +
    `<w:r><w:t xml:space="preserve"> y </w:t></w:r>` +
    `<w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>Junior</w:t></w:r></w:p></w:body>`;

  it("cada campo amarillo queda con su marcador, y sin el amarillo", () => {
    const salida = marcaCamposAXml(xml);
    expect(salida).toContain(`<w:t xml:space="preserve">${marcadorDeCampo(1)}</w:t>`);
    expect(salida).toContain(`<w:t xml:space="preserve">${marcadorDeCampo(2)}</w:t>`);
    expect(salida).not.toContain("w:highlight");
    expect(salida).toContain("Effective Date: ");
  });

  it("el número de cada marcador es el de su campo en camposDeXml (mismo orden)", () => {
    const campos = camposDeXml(xml);
    const marcados = marcaCamposAXml(xml);
    campos.forEach((c, i) => {
      expect(marcados).toContain(marcadorDeCampo(i + 1));
      expect(c.original).toBeTruthy();
    });
    expect(campos.map((c) => c.original)).toEqual(["____", "Junior"]);
  });

  it("en el .docx real salen cinco marcadores, y el texto de los campos desaparece del XML", () => {
    const marcado = marcaCamposDocx(fixture());
    const zip = new PizZip(marcado);
    const doc = zip.file("word/document.xml")!.asText();
    for (let n = 1; n <= 5; n++) expect(doc).toContain(marcadorDeCampo(n));
    expect(doc).not.toContain(">Junior Sales Representative<");
    expect(camposDeDocx(fixture())).toHaveLength(5);
  });
});

describe("mammoth convierte el .docx marcado y los marcadores llegan al HTML en orden", () => {
  it("htmlDeDocx conserva los cinco marcadores, en el orden de los campos", async () => {
    const html = await htmlDeDocx(new Uint8Array(fixture()), { today: "16 de noviembre de 2026" });
    expect(numerosDeMarcadores(html)).toEqual([1, 2, 3, 4, 5]);
    expect(html).toContain("<p");
  });
});

describe("sustituyeMarcadores: marcador → chip", () => {
  const campos: CampoDetectado[] = [
    campo(0, "Effective Date", "start_date"),
    campo(1, "Applies to", "position"),
    campo(2, "Position", "position"),
    campo(3, "Employment Type", "weekly_hours"),
    campo(4, "Base Pay", "pay_rate"),
  ];

  it("un valor puesto sale como chip con su clave de entrada, y el marcador desaparece", () => {
    const html = `<p>Fecha ${marcadorDeCampo(1)}</p>`;
    const salida = sustituyeMarcadores(html, campos, { start_date: "07/15/2026" });
    expect(salida).toBe(`<p>Fecha <span class="docs-campo" data-entrada="start_date" title="Effective Date">07/15/2026</span></p>`);
  });

  it("un campo sin valor es un hueco con la etiqueta (y el rótulo es lo que la impresión oculta)", () => {
    const salida = sustituyeMarcadores(marcadorDeCampo(5), campos, { pay_rate: "" });
    expect(salida).toContain(`class="docs-campo docs-campo-vacio" data-entrada="pay_rate"`);
    expect(salida).toContain(`<span class="docs-campo-rotulo">Base Pay</span>`);
  });

  it("las dos casillas de «Applies to» y «Position» comparten el valor de la clave position", () => {
    const html = `${marcadorDeCampo(2)} / ${marcadorDeCampo(3)}`;
    const salida = sustituyeMarcadores(html, campos, { position: "Junior Sales Representative" });
    const chips = salida.match(/data-entrada="position"[^>]*>Junior Sales Representative</g) ?? [];
    expect(chips).toHaveLength(2);
    expect(salida).toContain(`title="Applies to / Position"`);
  });

  it("el valor se escapa: lo que escribe RR. HH. no puede abrir HTML", () => {
    const salida = sustituyeMarcadores(marcadorDeCampo(4), campos, { weekly_hours: `<img src=x onerror=alert(1)>` });
    expect(salida).not.toContain("<img");
    expect(salida).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("un marcador sin campo se quita, y el texto alrededor no cambia", () => {
    expect(sustituyeMarcadores(`a ${marcadorDeCampo(9)} b`, campos, {})).toBe("a  b");
  });

  it("escapaHtml cubre las comillas (van a un atributo title)", () => {
    expect(escapaHtml(`"A" & 'B' <C>`)).toBe("&quot;A&quot; &amp; &#39;B&#39; &lt;C&gt;");
  });
});

describe("valores de los campos en la casilla", () => {
  it("fecha: MM/DD/YYYY ↔ YYYY-MM-DD del calendario", () => {
    expect(isoDeMDY("07/15/2026")).toBe("2026-07-15");
    expect(isoDeMDY("____")).toBe("");
    expect(mdyDeIso("2026-07-15")).toBe("07/15/2026");
    expect(mdyDeIso("")).toBe("");
  });

  it("pago: el «$» es adorno; el documento recibe «$11»", () => {
    expect(pagoConSigno("11")).toBe("$11");
    expect(pagoConSigno(" $11.50 ")).toBe("$11.50");
    expect(pagoConSigno("  ")).toBe("");
    expect(pagoSinSigno("$11")).toBe("11");
  });

  it("progreso: cuántas claves tienen valor", () => {
    expect(progresoDeCampos(["start_date", "position", "weekly_hours", "pay_rate"], { start_date: "x", position: "  ", pay_rate: "$11" }))
      .toEqual({ hechos: 2, total: 4 });
  });

  it("la ayuda cambia por clave, y las horas y el pago siguen diciendo que se escriben a mano", () => {
    const t = (en: string) => en;
    expect(ayudaDeCampo("weekly_hours", t)).toContain("Typed by hand each time");
    expect(ayudaDeCampo("pay_rate", t)).toContain("Typed by hand each time");
    expect(claveDeEntrada({ id: "p0-g1", clave: "otro" })).toBe("p0-g1");
  });
});
