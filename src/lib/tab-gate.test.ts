import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { TABS, TAB_GATE_EXEMPT, canOpenTab, tabForPath, ROLE_INFO } from "./constants";
import type { UserRole } from "./types";

// La pestaña era la única barrera: ni `middleware.ts` ni el layout de `(app)` filtran rutas
// por rol, así que quien escribe la URL entra si la página no lo para. Y cada página tenía su
// propia idea de a quién parar — cuando la tenía.
//
// El caso que lo destapó: `accounts/page.tsx` listaba a los NEGADOS (`sales|driver|warehouse`)
// y `TABS` a los PERMITIDOS (`admin|manager`). `accounting` no estaba en ninguna de las dos:
// sin pestaña y sin bloqueo.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");

const ROLES = Object.keys(ROLE_INFO) as UserRole[];
const u = (role: UserRole, permissions: string[] = []) => ({ role, permissions });

describe("canOpenTab: una pregunta, la misma que pinta la pestaña", () => {
  it("responde por rol lo que dice TABS", () => {
    for (const tb of TABS) {
      for (const role of ROLES) {
        expect(canOpenTab(tb.id, u(role)), `${tb.id} / ${role}`).toBe(!tb.roles || tb.roles.includes(role));
      }
    }
  });

  it("una capacidad concedida a una persona abre su pestaña, como en la barra", () => {
    // Es el motivo de que `cap` exista: un admin se la da a alguien y esa persona ve la
    // pestaña. Si se le pinta y la página no abre, se ofrece una puerta y se cierra en la cara.
    expect(canOpenTab("routes", u("sales"))).toBe(false);
    expect(canOpenTab("routes", u("sales", ["route_plan"]))).toBe(true);
    expect(canOpenTab("data", u("manager", ["settings"]))).toBe(true);
  });

  it("sin sesión, o con una pestaña que no existe, es que no", () => {
    expect(canOpenTab("accounts", null)).toBe(false);
    expect(canOpenTab("accounts", undefined)).toBe(false);
    expect(canOpenTab("no-existe", u("admin"))).toBe(false);
  });

  it("el caso que lo destapó: contabilidad y Cuentas", () => {
    expect(canOpenTab("accounts", u("accounting"))).toBe(false);
    expect(canOpenTab("accounts", u("logistics"))).toBe(false);
    expect(canOpenTab("accounts", u("manager"))).toBe(true);
  });
});

describe("tabForPath: qué ruta es qué pestaña", () => {
  it("empareja la ruta exacta y sus sub-rutas", () => {
    expect(tabForPath("/accounts")?.id).toBe("accounts");
    expect(tabForPath("/accounts/")?.id).toBe("accounts");
    expect(tabForPath("/track/abc")?.id).toBe("track");
    expect(tabForPath("/")?.id).toBe("board");
  });

  it("nunca enciende una pestaña porque su ruta sea prefijo de otra", () => {
    // `/accounts` no puede contar como `/account`, que es la ficha de uno mismo y no es
    // pestaña. Si lo hiciera, el guard le aplicaría a alguien las reglas de otra pantalla.
    expect(tabForPath("/account")).toBeNull();
  });

  it("una ruta que no es pestaña no la toca el guard", () => {
    for (const r of ["/account", "/settings", "/users", "/no-access"]) {
      expect(tabForPath(r), r).toBeNull();
    }
  });
});

describe("el guard está en un solo sitio y cubre todas las pestañas", () => {
  it("el layout de (app) envuelve las páginas con TabGate", () => {
    const layout = sinComentarios(leer("src/app/(app)/layout.tsx"));
    expect(layout).toContain("<TabGate>{children}</TabGate>");
    // Las dos ramas del layout —chofer y el resto— tienen que llevarlo; si solo una lo
    // llevara, medio hub quedaría sin guard y nada avisaría.
    expect(layout.match(/<TabGate>\{children\}<\/TabGate>/g) ?? []).toHaveLength(2);
  });

  it("el guard pregunta por el rol EFECTIVO, no por el de la sesión", () => {
    // «Ver como» tiene que decidir igual que la pestaña: un admin previsualizando almacén
    // entra en /warehouse y no en /routes. `useData().me` ya es el efectivo.
    const gate = sinComentarios(leer("src/components/TabGate.tsx"));
    expect(gate).toContain("useData()");
    expect(gate).toMatch(/canOpenTab\(tab\.id, me\)/);
    expect(gate).not.toContain("realRole");
  });

  it("ninguna página de una pestaña conserva su propia lista de roles", () => {
    // Es el fallo original: dos fuentes. Se mira solo lo que DEVUELVE pantalla — el tablero
    // tiene otra lista de roles (`:46`) que decide si corre el barrido de auto-cancelación,
    // y esa no es una puerta.
    const ficheroDe = (href: string) => (href === "/" ? "src/app/(app)/page.tsx" : `src/app/(app)${href}/page.tsx`);
    let revisadas = 0;
    for (const tb of TABS) {
      const f = ficheroDe(tb.href);
      if (!existsSync(join(process.cwd(), f))) continue;
      revisadas++;
      for (const linea of sinComentarios(leer(f)).split("\n")) {
        if (!/return\s*</.test(linea)) continue;
        expect(linea, `${tb.href} conserva una lista de roles`)
          .not.toMatch(/me\.role !== "\w+"|\]\.includes\(me\.role\)|me\.role === "\w+" \|\|/);
      }
    }
    // Control: si el recorrido deja de encontrar páginas, lo de arriba pasa por vacuidad.
    expect(revisadas).toBeGreaterThanOrEqual(12);
  });

  it("la barra usa la misma función, así que pestaña y puerta no pueden separarse", () => {
    const src = sinComentarios(leer("src/components/TopBar.tsx"));
    expect(src).toMatch(/TABS\.filter\(\(tb\) => canOpenTab\(tb\.id, me\)\)/);
    expect(src).not.toMatch(/tb\.roles\.includes\(me\.role\)/);
  });

  it("las exentas lo son por su id y con motivo escrito", () => {
    // Hoy solo Mi ruta: `TABS` dice que su página se abre para un admin que navegue
    // directamente, y cerrarla es otra decisión.
    expect(TAB_GATE_EXEMPT).toEqual(["myroute"]);
    const constantes = leer("src/lib/constants.ts");
    expect(constantes).toMatch(/still opens for an admin who navigates there directly/);
  });

  it("las dos páginas con un `TABS` LOCAL no cuentan como que preguntan al de verdad", () => {
    // `warehouse/page.tsx` y `driver/page.tsx` declaran su propia constante `TABS` para sus
    // sub-pestañas. Una prueba que buscara la palabra «TABS» las daría por buenas sin que
    // hicieran nada — el guard de estas dos está en el layout, como el de todas.
    for (const f of ["src/app/(app)/warehouse/page.tsx", "src/app/(app)/driver/page.tsx"]) {
      const src = sinComentarios(leer(f));
      expect(src, f).toMatch(/const TABS\b/);
      expect(src.includes("canOpenTab"), `${f} no debe traer el guard: vive en el layout`).toBe(false);
    }
  });
});
