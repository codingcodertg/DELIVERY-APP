import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { accessibleModules, knownModules, landingRoute, MODULES, MODULE_ACCESS } from "@/lib/constants";

/**
 * RTG PROMOS, fase A: que el módulo EXISTA para la app, no solo para la base.
 *
 * La migración 140 ya dejó a la base aceptando la palabra `promos` en `module_access`, pero eso no
 * basta: `knownModules()` filtra lo que se escribe contra las claves de `MODULE_ACCESS` (D-217), así
 * que un módulo que la base acepta y el registro no conoce **se tira en silencio** al conceder.
 * Estas pruebas son el otro extremo de ese cable.
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");
const enModulos = MODULES.find((m) => m.key === "promos");
const enAcceso = MODULE_ACCESS.find((m) => m.key === "promos");

describe("la tarjeta y la casilla existen", () => {
  it("es una tarjeta del hub que apunta a /promos", () => {
    expect(enModulos).toBeDefined();
    expect(enModulos!.href).toBe("/promos");
    // El rótulo es el que puso el dueño, igual en las dos lenguas.
    expect([enModulos!.label_en, enModulos!.label_es]).toEqual(["RTG PROMOS", "RTG PROMOS"]);
  });

  it("es una casilla que se otorga, y su acceso vive en module_access", () => {
    expect(enAcceso).toBeDefined();
    expect(enAcceso!.alwaysOn).toBe(false);
    expect(enAcceso!.accessColumn).toBe("module_access");
  });

  it("la palabra del código y la de la base son LA MISMA", () => {
    // Si alguien renombrara la clave aquí, la base seguiría esperando 'promos' y conceder el módulo
    // reventaría contra `profiles_module_access_known`. Se ata a la migración, no a un comentario.
    const sql = leer("supabase/migrations/140_promos.sql");
    expect(sql).toContain("'deliveries','recruiting','timetracker','erp','promos'");
    expect(enAcceso!.key).toBe("promos");
    expect(enModulos!.key).toBe("promos");
  });

  it("`knownModules` lo deja pasar — que es lo que lo haría desaparecer en silencio", () => {
    expect(knownModules(["promos"])).toEqual(["promos"]);
    expect(knownModules(["clockin", "promos"])).toEqual(["promos"]);
  });
});

describe("dónde aterriza quien lo tiene", () => {
  it("aparece en el hub solo para quien lo tenga", () => {
    expect(accessibleModules(["promos"]).map((m) => m.key)).toContain("promos");
    expect(accessibleModules(["recruiting"]).map((m) => m.key)).not.toContain("promos");
  });

  it("no desplaza a Entregas cuando las dos están otorgadas", () => {
    expect(accessibleModules(["promos", "deliveries"])[0].key).toBe("deliveries");
  });

  it("con SOLO promociones se entra directo, y con dos módulos al selector", () => {
    expect(landingRoute({ role: "manager", module_access: ["promos"] })).toBe("/promos");
    expect(landingRoute({ role: "manager", module_access: ["deliveries", "promos"] })).toBe("/home");
  });

  it("no le cambia el aterrizaje a un chofer que tenga Entregas", () => {
    expect(landingRoute({ role: "driver", module_access: ["deliveries", "promos"] })).toBe("/driver");
  });
});

describe("sin escalafón propio, y dicho en su sitio", () => {
  it("NO reclama ninguna columna de rol", () => {
    // Quién aprueba sale de `profiles.role` (Gerente de Oficina u Oficina), que es la columna de
    // Entregas: la regla de D-057 prohíbe que dos módulos apunten a la misma.
    expect(enAcceso!.roleColumn).toBeUndefined();
    expect(enAcceso!.roleKeys).toEqual([]);
  });

  it("y por eso trae su propia nota, que dice dónde se decide de verdad", () => {
    expect(enAcceso!.roleNote).toBeDefined();
    // No vale una nota cualquiera: tiene que mandar a los dos sitios donde se configura esto de
    // verdad — el rol de Entregas y el grupo de la tienda. Sin eso, el hueco del selector se lee
    // como que falta algo.
    expect(enAcceso!.roleNote!.es).toMatch(/Gerente de Oficina/);
    expect(enAcceso!.roleNote!.es).toMatch(/Datos → Tiendas/);
    expect(enAcceso!.roleNote!.en).toMatch(/Office Manager/);
    expect(enAcceso!.roleNote!.en).toMatch(/Data → Stores/);
  });

  it("el `case \"promos\"` de setModuleRole es inalcanzable, y esta prueba es lo que lo sostiene", () => {
    // Ese `case` no hace nada, y solo es correcto MIENTRAS `promos` no tenga `roleColumn`: sin
    // columna de rol, `UserDialog` no dibuja el `<select>` y nadie lo llama. El día que alguien le
    // dé un escalafón, la primera prueba de este bloque cae y apunta aquí. Se deja escrito para
    // que ese `return` vacío no se lea como un olvido.
    const dialogo = leer("src/components/UserDialog.tsx");
    expect(dialogo).toContain('case "promos":');
    expect(enAcceso!.roleColumn).toBeUndefined();
  });

  it("la casilla escribe por `updateUserPromosAccess`, no por la de otro módulo", () => {
    const dialogo = leer("src/components/UserDialog.tsx");
    expect(dialogo).toContain("updateUserPromosAccess(u.id, { granted });");
  });
});

describe("la puerta del módulo", () => {
  const layout = leer("src/app/promos/layout.tsx");

  it("comprueba el acceso en el servidor, y el admin siempre entra", () => {
    expect(layout).toContain('const tienePromos = role === "admin" || !!profile?.module_access?.includes("promos");');
    expect(layout).toContain("if (!tienePromos) {");
  });

  it("un fallo de LECTURA del perfil no redirige: sería un bucle (D-234)", () => {
    // El login vuelve aquí, así que redirigir ante un error de consulta da vueltas. Solo la fila
    // ausente —con error nulo— manda al login.
    expect(layout).toContain('if (estadoDeLectura({ data: profile, error: errorPerfil }) === "fallo") {');
    const desde = layout.indexOf('=== "fallo"');
    const hasta = layout.indexOf("const role =");
    expect(desde).toBeGreaterThan(0);
    expect(hasta).toBeGreaterThan(desde);
    expect(layout.slice(desde, hasta)).not.toContain("redirect(");
  });

  it("y la raíz del módulo existe, para que la tarjeta no lleve a un 404", () => {
    expect(() => leer("src/app/promos/page.tsx")).not.toThrow();
  });
});
