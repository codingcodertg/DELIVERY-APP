import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CAMPOS_EN_MAYUSCULAS, correoDeCliente, estandarizaCliente, formatoDeCampo, nombreDeCliente, telefonoDeCliente } from "./formato";
import { telefonoEstandar } from "@/lib/recruiting/formato";
import { formDe, parcheDe } from "./reglas";

describe("formato de un cliente (D-635)", () => {
  it("los nombres en MAYÚSCULAS, con un solo espacio y recortados; los acentos y la ñ se quedan", () => {
    expect(nombreDeCliente("Villarreal  homes ")).toBe("VILLARREAL HOMES");
    expect(nombreDeCliente("CITY OF McALLEN.")).toBe("CITY OF MCALLEN.");
    expect(nombreDeCliente("Juan R. Briseño")).toBe("JUAN R. BRISEÑO");
    expect(nombreDeCliente(null)).toBe("");
    expect([...CAMPOS_EN_MAYUSCULAS]).toEqual(["account", "unified_account", "contact_name", "contact_title"]);
  });
  it("el teléfono: los formatos medidos salen «(956) 340-5910»; dos números o un nombre se quedan como están", () => {
    for (const t of ["956-572-6342", "956*572*6342", "956 572-6342", "9565726342", "+1 956.572.6342", "(956)572-6342"]) {
      expect(telefonoDeCliente(t), t).toBe("(956) 572-6342");
    }
    expect(telefonoDeCliente("956-708-0518 / 956-378-3332")).toBe("956-708-0518 / 956-378-3332");
    expect(telefonoDeCliente("JOSE  LLORENTE")).toBe("JOSE LLORENTE");
    expect(telefonoDeCliente("956-686-772")).toBe("956-686-772");
    // Un número con texto no se toca: el texto dice a quién llamar (medido: «956-246-6915 - Viya, A/P»).
    expect(telefonoDeCliente("956-246-6915 - Viya, A/P")).toBe("956-246-6915 - Viya, A/P");
    expect(telefonoDeCliente("956-784-1118 - Denisse - owner 100%")).toBe("956-784-1118 - Denisse - owner 100%");
    expect(telefonoDeCliente("  ")).toBe("");
  });
  it("es el MISMO teléfono que RR. HH. y Entregas (la copia no se separa de `telefonoEstandar`)", () => {
    const casos = ["956-572-6342", "19565726342", "29565726342", "956 572 634", "abc", "", " 956*789*2929 ", "1 (956) 340-5910 ext 2", "12345678901", "956-246-6915 - Viya, A/P", "956 340 5910 Ñ"];
    for (const t of casos) expect(telefonoDeCliente(t), t).toBe(telefonoEstandar(t));
  });
  it("el correo en minúsculas y recortado; varios separados por «;» siguen juntos", () => {
    expect(correoDeCliente(" Ana@Acme.COM ")).toBe("ana@acme.com");
    expect(correoDeCliente("Janeth@Royal.com;Info@X.com")).toBe("janeth@royal.com;info@x.com");
  });
  it("formatoDeCampo: cada campo con su regla; los demás (términos, vendedores, notas) solo recortados", () => {
    expect(formatoDeCampo("account", "acme  llc")).toBe("ACME LLC");
    expect(formatoDeCampo("unified_account", "acme")).toBe("ACME");
    expect(formatoDeCampo("contact_name", "jose")).toBe("JOSE");
    expect(formatoDeCampo("contact_title", "owner")).toBe("OWNER");
    expect(formatoDeCampo("phone", "9563405910")).toBe("(956) 340-5910");
    expect(formatoDeCampo("email", "A@B.CO")).toBe("a@b.co");
    expect(formatoDeCampo("terms", " Net 30 ")).toBe("Net 30");
    expect(formatoDeCampo("notes", "hola Mundo")).toBe("hola Mundo");
  });
  it("estandarizaCliente devuelve solo lo que cambia; lo que ya está en formato o es null no sale", () => {
    expect(estandarizaCliente({ account: "Acme", phone: "(956) 340-5910", email: null, contact_name: "JOSE" })).toEqual({ account: "ACME" });
    expect(estandarizaCliente({ account: "ACME", phone: "956-340-5910", email: "A@B.co" })).toEqual({ phone: "(956) 340-5910", email: "a@b.co" });
    expect(estandarizaCliente({ contact_title: "  " })).toEqual({ contact_title: null });
    expect(estandarizaCliente({})).toEqual({});
  });
});

describe("al guardar desde el cajón (parcheDe)", () => {
  const base = formDe(null);
  it("lo que se escribe se guarda en formato", () => {
    const { parche, errores } = parcheDe({ ...base, store: "phr", account: "acme  homes", phone: "956*340*5910", email: "Ana@Acme.com", contact_name: "jose" }, base, true);
    expect(errores).toEqual([]);
    expect(parche).toMatchObject({ store: "PHR", account: "ACME HOMES", phone: "(956) 340-5910", email: "ana@acme.com", contact_name: "JOSE" });
  });
  it("si en formato es lo que ya había, no hay cambio; una fila vieja sin tocar tampoco cambia", () => {
    const viejo = { ...base, store: "PHR", account: "ACME", phone: "(956) 340-5910" };
    expect(parcheDe({ ...viejo, account: "acme", phone: "9563405910" }, viejo).parche).toEqual({});
    const sinFormato = { ...base, store: "PHR", account: "Acme", phone: "956-340-5910" };
    expect(parcheDe({ ...sinFormato }, sinFormato).parche).toEqual({});
    // Tocar otro campo no reescribe los que no se tocaron (no se reenvía lo leído).
    expect(parcheDe({ ...sinFormato, terms: "NET 30" }, sinFormato).parche).toEqual({ terms: "NET 30" });
  });
  it("el cajón usa el molde del teléfono de Entregas y pone los nombres en mayúsculas al escribir", () => {
    const cajon = readFileSync("src/app/customers/Clientes.tsx", "utf8");
    expect(cajon).toContain("onChange={(e) => campo(f.key, telefonoAlEscribir(e.target.value))}");
    expect(cajon).toContain("value={telefonoParaVer(form[f.key])}");
    expect(cajon).toContain("placeholder={MOLDE_DEL_TELEFONO}");
    expect(cajon).toContain("(CAMPOS_EN_MAYUSCULAS as readonly string[]).includes(f.key) ? e.target.value.toUpperCase() : e.target.value");
  });
});
