import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contactoVacio } from "./contactos";
import { redesEnEdicion } from "./redes";
import {
  borraBorradorDelAlta, borradorDe, claveDelBorradorDelAlta, cuandoSeGuardo, guardaBorradorDelAlta, hayAlgoEscrito, huellaDelBorrador,
  leeBorradorDelAlta, type BorradorDelAlta,
} from "./borrador-del-alta";

/**
 * Solicitud de ayuda 3914768b (Roberto Rodriguez Jr, admin, 2026-11-04, captura de «New customer» con el hueco junto a
 * «Cancel» marcado): «need a save draft». El alta se guarda a medias en el navegador, por persona.
 */
const memoria = () => {
  const m = new Map<string, string>();
  return { m, almacen: () => ({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }) };
};
const borrador = (cambios: Partial<BorradorDelAlta> = {}): BorradorDelAlta => ({
  guardado: "2026-11-04T18:48:00.000Z",
  form: { account: "ACME TILE", terms: "", store: "MCA" },
  contactos: [{ ...contactoVacio(), name: "OMAR", address: "123 TEST DR RGV" }],
  redes: redesEnEdicion({}),
  tiendas: ["MCA"],
  ...cambios,
});

describe("borrador del alta", () => {
  it("la clave lleva el id de la persona", () => {
    expect(claveDelBorradorDelAlta("u1")).toBe("rtg_customers_new_draft_u1");
    expect(claveDelBorradorDelAlta("u1")).not.toBe(claveDelBorradorDelAlta("u2"));
  });
  it("guardar y leer devuelve lo mismo; borrar lo quita; otra persona no lo ve", () => {
    const { m, almacen } = memoria();
    expect(guardaBorradorDelAlta(almacen, "u1", borrador())).toBe(true);
    expect(leeBorradorDelAlta((k) => almacen().getItem(k), "u1")).toEqual(borrador());
    expect(leeBorradorDelAlta((k) => almacen().getItem(k), "u2")).toBeNull();
    borraBorradorDelAlta(almacen, "u1");
    expect(m.size).toBe(0);
    expect(leeBorradorDelAlta((k) => almacen().getItem(k), "u1")).toBeNull();
  });
  it("un navegador que niega el almacenamiento (o lleno) no rompe: guardar dice false, leer da null, borrar no lanza", () => {
    const roto = () => { throw new Error("SecurityError"); };
    expect(guardaBorradorDelAlta(roto, "u1", borrador())).toBe(false);
    expect(guardaBorradorDelAlta(() => ({ setItem: () => { throw new Error("QuotaExceededError"); } }), "u1", borrador())).toBe(false);
    expect(leeBorradorDelAlta(roto, "u1")).toBeNull();
    expect(() => borraBorradorDelAlta(roto, "u1")).not.toThrow();
  });
  it("basura, otra versión o un borrador vacío no son un borrador", () => {
    const lee = (v: string) => leeBorradorDelAlta(() => v, "u1");
    expect(lee("{no es json")).toBeNull();
    expect(lee(JSON.stringify({ ...borrador(), v: 99 }))).toBeNull();
    expect(lee(JSON.stringify({ v: 1, guardado: "x", form: { store: "MCA" }, contactos: [contactoVacio()], redes: {}, tiendas: ["MCA"] }))).toBeNull();
  });
  it("lo leído se limpia campo a campo: tipos raros fuera, huecos de teléfono y correo repuestos, las siete redes", () => {
    const b = borradorDe({ v: 1, guardado: "g", form: { account: "ACME", n: 5 }, contactos: [{ name: "OMAR", phones: [], emails: ["a@b.co", 3] }, "x", null], redes: { facebook: "acme", raro: "y" }, tiendas: ["MCA", 7] });
    expect(b).not.toBeNull();
    expect(b!.form).toEqual({ account: "ACME" });
    expect(b!.contactos).toEqual([{ name: "OMAR", title: "", note: "", website: "", address: "", phones: [""], emails: ["a@b.co"] }]);
    expect(b!.redes).toEqual({ ...redesEnEdicion({}), facebook: "acme" });
    expect(b!.tiendas).toEqual(["MCA"]);
  });
  it("hayAlgoEscrito: no cuenta lo que la ficha pone sola (tienda, vendedor del vendedor)", () => {
    const vacio = { form: { account: "", store: "MCA", rep_id: "yo" }, contactos: [contactoVacio()], redes: redesEnEdicion({}) };
    expect(hayAlgoEscrito(vacio, { store: "MCA", rep_id: "yo" })).toBe(false);
    expect(hayAlgoEscrito({ ...vacio, form: { ...vacio.form, account: "A" } }, { rep_id: "yo" })).toBe(true);
    expect(hayAlgoEscrito({ ...vacio, form: { ...vacio.form, rep_id: "otro" } }, { rep_id: "yo" })).toBe(true);
    expect(hayAlgoEscrito({ ...vacio, contactos: [{ ...contactoVacio(), phones: ["956"] }] }, { rep_id: "yo" })).toBe(true);
    expect(hayAlgoEscrito({ ...vacio, redes: { ...redesEnEdicion({}), linkedin: "acme" } }, { rep_id: "yo" })).toBe(true);
  });
  it("la huella no depende de la hora", () => {
    expect(huellaDelBorrador(borrador())).toBe(huellaDelBorrador(borrador({ guardado: "2030-01-01T00:00:00.000Z" })));
    expect(huellaDelBorrador(borrador())).not.toBe(huellaDelBorrador(borrador({ tiendas: ["BRO"] })));
  });
  it("cuandoSeGuardo: fecha legible, o vacío si no se lee", () => {
    expect(cuandoSeGuardo("2026-11-04T18:48:00.000Z", "en")).toMatch(/Nov/);
    expect(cuandoSeGuardo("no", "es")).toBe("");
    expect(cuandoSeGuardo("", "en")).toBe("");
  });
});

describe("borrador del alta: la ventana", () => {
  const ficha = readFileSync(join(process.cwd(), "src/app/customers/FichaDeCliente.tsx"), "utf8");
  it("el botón «Guardar borrador» va junto a «Cancelar», solo en el alta, bilingüe", () => {
    expect(ficha).toContain('{t("Save draft", "Guardar borrador")}');
    expect(ficha.indexOf("data-guardar-borrador")).toBeLessThan(ficha.indexOf('{t("Cancel", "Cancelar")}</Button>'));
    expect(ficha).toContain("const conBorrador = nuevo && Boolean(yo);");
  });
  it("al abrir el alta con un borrador, se ofrece recuperarlo o descartarlo; al crear o pedir el alta, se borra", () => {
    expect(ficha).toContain("data-recuperar-borrador");
    expect(ficha).toContain("data-descartar-borrador");
    expect(ficha.match(/olvidarBorrador\(\);/g)?.length).toBe(2);
    expect(ficha).toContain('t("Draft saved ✓');
  });
});
