import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { FichaEnVentana } from "@/app/customers/FichaDeCliente";
import { archivoDeLaBase, faltaElFormulario, MAX_BYTES_DE_ARCHIVO, nombreSeguro, rutaDeArchivo, tamanoLegible } from "./archivos";
import { almacenDeLaBase } from "./almacen";
import { almacenDemo, almacenDemoNuevo, CLIENTES_DEMO } from "./demo";
import { filasDeLaEmpresa } from "./empresas";
import { CAMPOS, impuestoLabel, textoDeValor, webUrl, type Cliente } from "./reglas";

/* D-672 (195). Roberto, 2026-10-24: «Need to be able to attach files like No Sales Tax Form. Need to know their tax terms
 * too and it can vary by store bc each store needs the form signed», «tax terms […] will replace the spot for Type», «Type
 * will move to Other above Notes» y «Title was removed, need it back. Also need to add Website under contact». */
const t = (_en: string, es: string) => es;

describe("los archivos", () => {
  it("el nombre en el cubo: sin carpetas, acentos ni espacios; la ruta, en la carpeta de su fila y con sello", () => {
    expect(nombreSeguro("C:\\Docs\\Exención firmada (Pharr).pdf")).toBe("Exencion_firmada_Pharr_.pdf");
    expect(nombreSeguro("../../etc/passwd")).toBe("passwd");
    expect(nombreSeguro("...")).toBe("archivo");
    expect(rutaDeArchivo(42, "Form 01.pdf", new Date("2026-10-24T20:30:15.123Z"), "abcdef1234")).toBe("42/20261024203015-abcdef12-Form_01.pdf");
  });
  it("lee la fila de la base; una clase desconocida es «otro»", () => {
    expect(archivoDeLaBase({ id: "3", customer_id: 9, kind: "raro", name: "a.pdf", path: "9/a.pdf", size_bytes: "2048", content_type: null, uploaded_at: "2026-10-24T00:00:00Z" }))
      .toEqual({ id: 3, customer_id: 9, kind: "other", name: "a.pdf", path: "9/a.pdf", size_bytes: 2048, content_type: null, uploaded_at: "2026-10-24T00:00:00Z" });
  });
  it("falta el formulario: exenta y sin «No sales tax» de ESA fila (el de otra tienda no vale)", () => {
    const pharr = { id: 1, tax_terms: "exempt" };
    expect(faltaElFormulario(pharr, [])).toBe(true);
    expect(faltaElFormulario(pharr, [{ customer_id: 2, kind: "no_sales_tax" }])).toBe(true);
    expect(faltaElFormulario(pharr, [{ customer_id: 1, kind: "other" }])).toBe(true);
    expect(faltaElFormulario(pharr, [{ customer_id: 1, kind: "no_sales_tax" }])).toBe(false);
    expect(faltaElFormulario({ id: 1, tax_terms: "taxable" }, [])).toBe(false);
    expect(faltaElFormulario({ id: 1, tax_terms: null }, [])).toBe(false);
  });
  it("tamaños legibles y el tope de 25 MB del cubo", () => {
    expect(tamanoLegible(2_400_000)).toBe("2.3 MB");
    expect(tamanoLegible(300)).toBe("1 KB");
    expect(tamanoLegible(null)).toBe("");
    expect(MAX_BYTES_DE_ARCHIVO).toBe(26214400);
    expect(readFileSync("supabase/migrations/195_clientes_impuestos_y_archivos.sql", "utf8")).toContain("values ('customer-files', 'customer-files', false, 26214400)");
  });
  it("en la base: sube al cubo privado en la carpeta de la fila, y si apuntar la fila falla, el fichero se quita (no queda huérfano)", async () => {
    const subidas: string[] = [], quitadas: string[][] = [];
    const cubo = { upload: async (path: string) => { subidas.push(path); return { error: null }; }, remove: async (p: string[]) => { quitadas.push(p); return { error: null }; } };
    const insert = () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: { code: "42501", message: "new row violates row-level security policy" } }) }) });
    const sb = { from: () => ({ insert }), storage: { from: (b: string) => { expect(b).toBe("customer-files"); return cubo; } } };
    const r = await almacenDeLaBase(sb as never).subirArchivo(42, new File(["x"], "Form.pdf"), "no_sales_tax");
    expect(r).toMatchObject({ ok: false, sinPermiso: true });
    expect(subidas).toHaveLength(1);
    expect(subidas[0]).toMatch(/^42\/\d{14}-[0-9a-f]{8}-Form\.pdf$/);
    expect(quitadas).toEqual([[subidas[0]]]);
  });
  it("el demo sube, lista por fila y quita", async () => {
    const a = almacenDemoNuevo();
    const f = new File(["hola"], "form.pdf", { type: "application/pdf" });
    const r = await a.subirArchivo(4, f, "no_sales_tax");
    expect(r.ok).toBe(true);
    expect((await a.archivos(4)).ok && (await a.archivos(4))).toMatchObject({ valor: [{ customer_id: 4, kind: "no_sales_tax", name: "form.pdf", size_bytes: 4 }] });
    expect(await a.archivos(3)).toEqual({ ok: true, valor: [] });
    if (r.ok) await a.quitarArchivo(r.valor);
    expect(await a.archivos(4)).toEqual({ ok: true, valor: [] });
  });
});

describe("impuestos y sitio web", () => {
  it("los impuestos se dicen por su nombre, y el sitio web se enlaza con su https://", () => {
    expect([impuestoLabel("taxable", t), impuestoLabel("exempt", t), impuestoLabel(null, t)]).toEqual(["Paga impuesto", "Exento de impuesto", "—"]);
    expect(textoDeValor("tax_terms", "exempt", t)).toBe("Exento de impuesto");
    expect(webUrl("acme.example.com")).toBe("https://acme.example.com");
    expect(webUrl("http://acme.example.com/x")).toBe("http://acme.example.com/x");
    expect(webUrl("no tiene")).toBeNull();
    expect(webUrl("")).toBeNull();
  });
  it("cada campo, en su tarjeta: impuestos en «Crédito y términos», sitio web en «Contacto», el «Type» en «Otros»", () => {
    const grupo = (k: string) => CAMPOS.find((c) => c.key === k)?.grupo;
    expect([grupo("tax_terms"), grupo("website"), grupo("activity_status")]).toEqual(["credito", "contacto", "otros"]);
  });
});

describe("la ficha", () => {
  const pinta = (c: Cliente | null, editarAlAbrir = false) => renderToStaticMarkup(createElement(FichaEnVentana, {
    cliente: c, hermanas: c ? filasDeLaEmpresa(CLIENTES_DEMO, c) : [], lista: CLIENTES_DEMO,
    onCambia: () => {}, onClose: () => {}, onGuardado: () => {}, puedeEditar: true, almacen: almacenDemo(), editarAlAbrir, t,
  }));
  const tarjeta = (html: string, g: string) => { const i = html.indexOf(`data-grupo="${g}"`); const j = html.indexOf("data-grupo=", i + 1); return html.slice(i, j < 0 ? undefined : j); };
  const galeria = CLIENTES_DEMO.find((c) => c.id === 4)!;
  it("«Crédito y términos» lleva los impuestos; los archivos, en su tarjeta bajo «Campos ocultos» (D-681); el sitio web se abre; el cargo sale aunque falte", () => {
    const html = pinta(galeria);
    const credito = tarjeta(html, "credito");
    expect(credito).toMatch(/data-campo="tax_terms"><span[^>]*>Impuestos<\/span><span[^>]*>Exento de impuesto<\/span>/);
    expect(credito).not.toContain("data-archivos-de-la-ficha");
    const archivos = tarjeta(html, "archivos");
    expect(archivos).toContain("data-archivos-de-la-ficha");
    expect(archivos).toContain("data-adjuntar-archivo");
    // Apilada con «Campos ocultos» en la misma celda de la rejilla: la de ocultos primero, y la de archivos justo detrás.
    expect(html.indexOf('data-grupo="archivos"')).toBeGreaterThan(html.indexOf("data-campos-ocultos"));
    expect(html.slice(html.indexOf("</details>"), html.indexOf('data-grupo="archivos"'))).not.toContain("data-grupo=");
    expect(tarjeta(html, "contacto")).toContain('href="https://demotilegallery.example.com" target="_blank" rel="noopener noreferrer"');
    const sinCargo = tarjeta(pinta(CLIENTES_DEMO.find((c) => c.id === 3)!), "contacto");
    expect(sinCargo).toMatch(/Cargo: <span[^>]*data-campo="contact_title">—<\/span>/);
  });
  it("editando, los impuestos son un desplegable; en un alta, los archivos se adjuntan después", () => {
    expect(tarjeta(pinta(galeria, true), "credito")).toMatch(/<select[^>]*data-impuestos="true">/);
    expect(pinta(galeria, true)).not.toContain("data-adjuntar-archivo");
    expect(tarjeta(pinta(null), "archivos")).toContain("Los archivos se adjuntan después de crear el cliente.");
  });
});
