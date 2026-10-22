import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { MODULES } from "./constants";

// D-622 (2026-10-21) · el dueño: «el ERP quiero que se cambie de ERP a inventory, el name, y quiero que lo que es el
// nuevo inventory y el customer se cambien al tema que ya tenemos en deliveries app […] al igual que el time tracker.
// Todo eso quiero que hagamos una transformación de todo eso para que todo sea estandarizado e igual».

const leer = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("Inventario (antes ERP): el nombre", () => {
  it("la tarjeta del hub y el módulo de Usuarios dicen Inventory / Inventario; la clave y la ruta siguen siendo erp", () => {
    const m = MODULES.find((x) => x.key === "erp")!;
    expect(m.label_en).toBe("Inventory");
    expect(m.label_es).toBe("Inventario");
    expect(m.href).toBe("/erp/catalog");
    expect(leer("src/lib/constants.ts")).toContain('key: "erp", label_en: "Inventory", label_es: "Inventario",');
  });

  it("ninguna pestaña del navegador dice ya «RTG ERP»", () => {
    expect(leer("src/app/erp/layout.tsx")).toContain('title: "RTG Inventory",');
    expect(leer("src/app/erp/catalog/page.tsx")).toContain('title: "Catalog — RTG Inventory"');
    const barra = leer("src/components/erp/side-nav.tsx");
    expect(barra).toContain('t("RTG Inventory", "RTG Inventario")');
    expect(barra).not.toContain('"RTG ERP"');
  });
});

describe("Inventario y Clientes llevan la barra superior de Entregas", () => {
  const barra = leer("src/components/erp/side-nav.tsx");

  it("la barra es `.topbar` con `.tabs` y el menú del nombre, no una barra lateral fija", () => {
    // La `.topbar` la pone `BarraDeApp` (D-643), la barra de todas las apps.
    expect(barra).toContain("<BarraDeApp nombre={marca}");
    expect(barra).toContain('<nav className="tabs">');
    expect(barra).toContain('className={"tab" + (i.href === encendida ? " active" : "")}');
    expect(barra).toContain("<MenuDeCuenta nombre={fullName ?? email}>");
    expect(barra).not.toContain("<aside");
    expect(barra).not.toMatch(/\blg:/);
    expect(barra).not.toContain("useErpNav");
  });

  it("en el teléfono se parte en dos filas con las MISMAS clases que Entregas (D-545)", () => {
    // Las clases las pone `BarraDeApp` (D-643).
    expect(leer("src/components/BarraDeApp.tsx")).toContain('className="entregas-marca"');
    expect(leer("src/components/BarraDeApp.tsx")).toContain('className={"entregas-barra-resto"');
    expect(leer("src/app/globals.css")).toContain(".topbar .entregas-barra-resto { display: contents; }");
  });

  it("el hueco de la barra lateral se fue con ella: sin ErpNavProvider en ningún layout", () => {
    expect(existsSync("src/components/erp/nav-state.tsx")).toBe(false);
    expect(leer("src/app/erp/layout.tsx")).toContain('return <div data-app="erp">{children}</div>;');
    expect(leer("src/app/customers/layout.tsx")).toContain('const cascaron = <div data-app="erp">{children}</div>;');
  });
});

describe("Inventario se pinta con las variables del hub", () => {
  const css = leer("src/app/erp/erp.css");

  it("la rampa slate/clay apunta a globals.css (claro y oscuro de golpe), y la rampa invertida a mano se fue", () => {
    for (const linea of [
      "--color-slate-200: var(--line);",
      "--color-slate-500: var(--gray);",
      "--color-slate-900: var(--text);",
      "--color-clay-50: var(--accent-soft);",
      "--color-clay-500: var(--accent);",
      "--color-red-50: var(--red-soft);",
      "--color-emerald-700: var(--green);",
    ]) expect(css).toContain(linea);
    expect(css).not.toContain("--color-slate-50: #161d29;");
    expect(css).not.toContain("#b05a3c");
  });

  it("tipografía y esquinas de Entregas: Inter a 14 px, Archivo en títulos, 8 px en campos y 12 px en tarjetas", () => {
    expect(css).toContain("--font-sans: 'Inter', system-ui, sans-serif;");
    expect(css).toContain("font-family: 'Inter', system-ui, sans-serif;\n    font-size: 14px;");
    expect(css).toContain("font-family: 'Archivo', system-ui, sans-serif;");
    expect(css).toContain("--radius-md: 8px;");
    expect(css).toContain("--radius-lg: 12px;");
  });

  it("bg-white es la tarjeta del hub en los dos temas; text-white sigue blanco", () => {
    expect(css).toContain('[data-app="erp"] .bg-white {\n  background-color: var(--card);\n}');
    expect(css).toContain("--color-white: #ffffff;");
    expect(css).not.toContain('.bg-white {\n  background-color: #131a24;');
  });
});

describe("Time Tracker se pinta con las variables del hub", () => {
  const css = leer("src/app/timetracker/timetracker.css");

  it("cada --tt-* apunta a la variable de Entregas, sin paleta propia ni bloque claro aparte", () => {
    expect(css).toContain("--tt-bg:var(--paper); --tt-panel:var(--card); --tt-panel2:var(--paper); --tt-line:var(--line);");
    expect(css).toContain("--tt-txt:var(--text); --tt-muted:var(--gray); --tt-accent:var(--accent); --tt-accent2:var(--green);");
    expect(css).toContain("--tt-danger:var(--red); --tt-warn:var(--amber); --tt-ok:var(--green); --tt-chip:var(--accent-soft);");
    expect(css).not.toContain(':root[data-theme="light"] .timetracker-module{');
    expect(css).not.toMatch(/--tt-accent:#/);
  });

  it("tipografía y esquinas de Entregas", () => {
    expect(css).toContain(".timetracker-module{margin:0;font-family:'Inter',system-ui,sans-serif;");
    expect(css).toContain("font-size:14px;line-height:1.45;min-height:100vh}");
    expect(css).toContain(".timetracker-module .card{background:var(--tt-panel);border:1px solid var(--tt-line);border-radius:12px;");
    expect(css).toContain("border-radius:8px;padding:9px 11px;font-size:14px;font-family:inherit}");
    expect(css).toContain(".timetracker-module button{cursor:pointer;border:none;border-radius:8px;");
  });
});
