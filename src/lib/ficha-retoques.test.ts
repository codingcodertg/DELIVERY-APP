import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { canEditFields, ROLE_ORDER, tieneAccesoAEntregas } from "./constants";
import { cuentasQueCoinciden } from "./account-search";
import type { UserRole } from "./types";

/**
 * Tres retoques del formulario que pidió el dueño el 2026-09-17 (D-299).
 *
 * El del vendedor —`sales` o `manager`, y con acceso a Entregas— vive en `vendedor-por-tienda.test.ts`,
 * junto a lo de D-290 que revisa. Aquí quedan los otros dos, más la pregunta de acceso que los une.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const modal = leer("src/components/OrderModal.tsx");
const constantes = leer("src/lib/constants.ts");

describe("«¿puede abrir Entregas?» se pregunta en un solo sitio", () => {
  it("es el espejo de la base: admin siempre, el resto con el módulo concedido", () => {
    expect(tieneAccesoAEntregas({ role: "admin", module_access: null })).toBe(true);
    expect(tieneAccesoAEntregas({ role: "admin", module_access: [] })).toBe(true);
    expect(tieneAccesoAEntregas({ role: "sales", module_access: ["deliveries"] })).toBe(true);
    expect(tieneAccesoAEntregas({ role: "sales", module_access: ["recruiting"] })).toBe(false);
    expect(tieneAccesoAEntregas({ role: "manager", module_access: null })).toBe(false);
    for (const rol of ROLE_ORDER.filter((r) => r !== "admin")) {
      expect([rol, tieneAccesoAEntregas({ role: rol, module_access: [] })]).toEqual([rol, false]);
    }
  });

  it("y el comentario que decía lo contrario está corregido, no borrado", () => {
    // Decía que Entregas «es implícita para todo el mundo y nunca está en module_access». Dejó de ser
    // verdad con la 083 y sostuvo una premisa equivocada en una revisión: se corrige con una nota
    // dentro, para que quien lo lea vea que cambió.
    expect(constantes).toContain("CORRECCIÓN (D-299)");
    expect(constantes).toContain("**Ya no es verdad desde la 083**");
    expect(constantes).not.toContain('// "Deliveries" itself is implicit for everyone');
  });
});

describe("el borrador se retoma desde arriba", () => {
  const tramo = modal.slice(modal.indexOf("{/* Un borrador se retoma desde arriba"), modal.indexOf('<button className="btn btn-sm" onClick={requestClose}'));

  it("hay un botón en la cabecera, y solo cuando la orden es un borrador", () => {
    expect(tramo).toContain('{!editing && existing && stage === "draft" && canEditFields(me.role, "draft") && (');
    expect(tramo).toContain("onClick={() => setEditing(true)}");
    expect(tramo).toContain('{t("Continue filling order", "Continuar la orden")}');
  });

  it("lo ve quien puede editar un borrador, que ya lo decidía D-286 — no una regla nueva", () => {
    // Si alguien cambia `canEditFields` para borradores, el botón lo sigue solo.
    expect(canEditFields("sales", "draft")).toBe(true);
    expect(canEditFields("warehouse", "draft")).toBe(false);
    for (const rol of ROLE_ORDER) {
      expect([rol, canEditFields(rol as UserRole, "draft")]).toEqual([rol, rol !== "warehouse"]);
    }
  });

  it("y no aparece en las demás etapas ni mientras se edita", () => {
    expect(tramo).toContain("!editing");
    expect(tramo).not.toContain('stage === "pending"');
  });
});

describe("el desplegable de cuentas se puede filtrar", () => {
  const CUENTAS = ["Acme Tile", "Ángel Construcción", "Bravo Homes", "Delta Flooring", "Omega Design"];

  it("filtra por lo escrito, sin importar acentos ni mayúsculas", () => {
    expect(cuentasQueCoinciden(CUENTAS, "an")).toEqual(["Ángel Construcción"]);
    expect(cuentasQueCoinciden(CUENTAS, "ANGEL")).toEqual(["Ángel Construcción"]);
    expect(cuentasQueCoinciden(CUENTAS, "ángel")).toEqual(["Ángel Construcción"]);
    expect(cuentasQueCoinciden(CUENTAS, "o")).toEqual(["Ángel Construcción", "Bravo Homes", "Delta Flooring", "Omega Design"]);
  });

  it("busca en cualquier parte del nombre, no solo al principio", () => {
    expect(cuentasQueCoinciden(CUENTAS, "tile")).toEqual(["Acme Tile"]);
    expect(cuentasQueCoinciden(CUENTAS, "flooring")).toEqual(["Delta Flooring"]);
  });

  it("sin filtro están todas, y en el mismo orden en que llegaron", () => {
    expect(cuentasQueCoinciden(CUENTAS, "")).toEqual(CUENTAS);
    expect(cuentasQueCoinciden(CUENTAS, "   ")).toEqual(CUENTAS);
    expect(cuentasQueCoinciden(CUENTAS, null)).toEqual(CUENTAS);
    // Ordenar por «lo que más se parece» movería la misma cuenta de sitio según lo tecleado.
    expect(cuentasQueCoinciden(CUENTAS, "e")).toEqual(CUENTAS.filter((c) => c.toLowerCase().includes("e")));
  });

  it("la cuenta que la orden ya tiene no desaparece aunque no coincida (D-267)", () => {
    expect(cuentasQueCoinciden(CUENTAS, "zzz", "Bravo Homes")).toEqual(["Bravo Homes"]);
    expect(cuentasQueCoinciden(CUENTAS, "acme", "Bravo Homes")).toEqual(["Acme Tile", "Bravo Homes"]);
    // Y sin valor guardado, un filtro que no encuentra nada deja la lista vacía, que es la verdad.
    expect(cuentasQueCoinciden(CUENTAS, "zzz")).toEqual([]);
  });

  it("el formulario lo usa encima del selector, sin convertirlo en campo de texto", () => {
    expect(modal).toContain("const visibles = cuentasQueCoinciden(options, filtro, current);");
    expect(modal).toContain("{visibles.map((o) => <option key={o} value={o}>{o}</option>)}");
    expect(modal).toContain('placeholder={t("Type to filter…", "Escriba para filtrar…")}');
    // El autorrellenado sigue colgando del `onChange` del `select`, no de cada tecla.
    const combo = modal.slice(modal.indexOf("function AccountCombo"), modal.indexOf("function AccountCombo") + 2600);
    expect(combo).toContain("onChange={(e) => setFiltro(e.target.value)}");
    expect(combo).toContain("if (e.target.value === NEW_ACCOUNT) { setManual(true); on(\"\"); return; }");
  });
});
