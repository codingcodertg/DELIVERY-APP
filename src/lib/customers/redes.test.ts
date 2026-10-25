import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { FichaEnVentana } from "@/app/customers/FichaDeCliente";
import { almacenDemo, CLIENTES_DEMO } from "./demo";
import { filasDeLaEmpresa } from "./empresas";
import { hayRedes, NOMBRE_DE_RED, normalizaRedes, parcheDeRedes, REDES, redesDe, redesEnEdicion, textoDeRed, urlDeRed } from "./redes";
import { clienteDeLaBase, valorDeColumna, type Cliente } from "./reglas";

/* D-682 (197). Roberto, 2026-10-25: «Lets add a Socials tab for their Facebook, Instagram, YouTube, TikTok, Twitter,
 * Alignable, LinkedIn». */
const t = (_en: string, es: string) => es;

describe("las redes", () => {
  it("las siete del pedido, en su orden, cada una con su nombre", () => {
    expect(REDES).toEqual(["facebook", "instagram", "youtube", "tiktok", "twitter", "alignable", "linkedin"]);
    expect(REDES.map((k) => NOMBRE_DE_RED[k])).toEqual(["Facebook", "Instagram", "YouTube", "TikTok", "X (Twitter)", "Alignable", "LinkedIn"]);
  });
  it("normaliza: solo las conocidas, recortadas, sin vacías; lo que no es un objeto, nada", () => {
    expect(normalizaRedes({ facebook: " rtg ", tiktok: "", myspace: "x", linkedin: 3 })).toEqual({ facebook: "rtg" });
    expect(normalizaRedes(null)).toEqual({});
    expect(normalizaRedes(["facebook"])).toEqual({});
    expect(normalizaRedes("rtg")).toEqual({});
    expect(redesDe({ socials: { instagram: "@rtg" } })).toEqual({ instagram: "@rtg" });
    expect(redesDe(null)).toEqual({});
    expect(hayRedes({})).toBe(false);
    expect(hayRedes({ youtube: "rtg" })).toBe(true);
  });
  it("abre la URL tal cual, el dominio sin esquema con https, y un usuario (con o sin @) en su red", () => {
    expect(urlDeRed("facebook", "https://www.facebook.com/rdztile")).toBe("https://www.facebook.com/rdztile");
    expect(urlDeRed("facebook", "facebook.com/rdztile")).toBe("https://facebook.com/rdztile");
    expect(urlDeRed("instagram", "@rdztile")).toBe("https://www.instagram.com/rdztile");
    expect(urlDeRed("youtube", "rdztile")).toBe("https://www.youtube.com/@rdztile");
    expect(urlDeRed("tiktok", "rdztile")).toBe("https://www.tiktok.com/@rdztile");
    expect(urlDeRed("twitter", "rdztile")).toBe("https://x.com/rdztile");
    expect(urlDeRed("alignable", "rdz-tile")).toBe("https://www.alignable.com/rdz-tile");
    expect(urlDeRed("linkedin", "rdz-tile-group")).toBe("https://www.linkedin.com/company/rdz-tile-group");
    expect(textoDeRed("https://www.facebook.com/rdztile")).toBe("facebook.com/rdztile");
    expect(textoDeRed("@rdztile")).toBe("@rdztile");
  });
  it("el parche: solo si algo cambió, y limpio; vaciar una red la quita", () => {
    const antes = { facebook: "rtg", linkedin: "rtg" };
    expect(parcheDeRedes(antes, redesEnEdicion(antes))).toEqual({});
    expect(parcheDeRedes(antes, { ...redesEnEdicion(antes), facebook: " rtg " })).toEqual({});
    expect(parcheDeRedes(antes, { ...redesEnEdicion(antes), tiktok: "@rtg" })).toEqual({ socials: { facebook: "rtg", tiktok: "@rtg", linkedin: "rtg" } });
    expect(parcheDeRedes(antes, { ...redesEnEdicion(antes), linkedin: "" })).toEqual({ socials: { facebook: "rtg" } });
    expect(redesEnEdicion({})).toEqual({ facebook: "", instagram: "", youtube: "", tiktok: "", twitter: "", alignable: "", linkedin: "" });
  });
  it("la fila de la base: el objeto se normaliza; sin la 197, null; y no es una columna de la lista", () => {
    const base = { id: 1, store: "MCA", account: "A" };
    expect(clienteDeLaBase({ ...base, socials: { facebook: "rtg", nada: 1 } }).socials).toEqual({ facebook: "rtg" });
    expect(clienteDeLaBase(base).socials).toBeNull();
    expect(valorDeColumna({ ...CLIENTES_DEMO[0], socials: { facebook: "rtg" } }, "socials")).toBeNull();
  });
});

describe("la pestaña «Socials» de la tarjeta «Contacto»", () => {
  const pinta = (c: Cliente | null, editarAlAbrir = false) => renderToStaticMarkup(createElement(FichaEnVentana, {
    cliente: c, hermanas: c ? filasDeLaEmpresa(CLIENTES_DEMO, c) : [], lista: CLIENTES_DEMO,
    onCambia: () => {}, onClose: () => {}, onGuardado: () => {}, puedeEditar: true, almacen: almacenDemo(), editarAlAbrir, t,
  }));
  const tarjeta = (html: string, g: string) => { const i = html.indexOf(`data-grupo="${g}"`); const j = html.indexOf("data-grupo=", i + 1); return html.slice(i, j < 0 ? undefined : j); };
  const galeria = CLIENTES_DEMO.find((c) => c.id === 4)!;
  const socials = { facebook: "rdztile", linkedin: "https://www.linkedin.com/company/rdz-tile-group" };
  it("con redes, una pastilla «Redes sociales» junto a las de contactos (aunque haya un solo contacto); sin redes, no", () => {
    const con = tarjeta(pinta({ ...galeria, socials }), "contacto");
    expect(con).toMatch(/<button type="button" role="tab" aria-selected="false"[^>]*data-pastilla-de-redes="true">🌐 Redes sociales<\/button>/);
    expect(con).toContain('data-contacto-elegido="0"');
    expect(tarjeta(pinta(galeria), "contacto")).not.toContain("data-pastilla-de-redes");
  });
  it("sin contacto, las redes salen solas: cada una con su nombre, abre en otra pestaña y se copia", () => {
    const sinContacto = { ...galeria, contacts: [], contact_name: null, contact_title: null, phone: null, email: null, socials };
    const html = tarjeta(pinta(sinContacto), "contacto");
    expect(html).toContain('data-redes="2"');
    expect(html).toMatch(/Facebook<\/span><a href="https:\/\/www\.facebook\.com\/rdztile" target="_blank" rel="noopener noreferrer"[^>]*data-red="facebook">rdztile<\/a>/);
    expect(html).toMatch(/LinkedIn<\/span><a href="https:\/\/www\.linkedin\.com\/company\/rdz-tile-group"[^>]*data-red="linkedin">linkedin\.com\/company\/rdz-tile-group<\/a>/);
    expect(html).not.toContain('data-red="instagram"');
    expect(html).not.toContain("Sin contacto todavía");
  });
  it("editando, las siete en su apartado, con lo guardado; en un alta, vacías", () => {
    const html = tarjeta(pinta({ ...galeria, socials }, true), "contacto");
    for (const k of REDES) expect(html).toContain(`data-red-editable="${k}"`);
    expect(html).toMatch(/data-red-editable="facebook" value="rdztile"/);
    expect(html).toMatch(/data-red-editable="instagram" value=""/);
    expect(html.indexOf("data-redes-editando")).toBeGreaterThan(html.indexOf("data-contactos-editando"));
    expect(tarjeta(pinta(null), "contacto")).toContain('data-red-editable="tiktok"');
  });
  it("puerta: lo escrito entra en el parche al guardar, y cancelar lo devuelve a lo guardado", () => {
    const c = readFileSync("src/app/customers/FichaDeCliente.tsx", "utf8");
    expect(c).toContain("...parcheDeContactos(contactosOriginales, contactos, cliente), ...parcheDeRedes(redesOriginales, redes) },");
    expect(c).toMatch(/setContactos\(enEdicion\(contactosOriginales\)\);\s+setRedes\(redesEnEdicion\(redesOriginales\)\);/);
    expect(c).toContain("redes={redes} onRedes={setRedes}");
  });
});
