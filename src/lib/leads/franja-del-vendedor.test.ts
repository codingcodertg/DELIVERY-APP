import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COLORES_DE_VENDEDOR, colorDeVendedor } from "./reglas";
import { almacenDeLaBase } from "./almacen";
import type { SupabaseClient } from "@supabase/supabase-js";

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").replace(/\r\n/g, "\n");
const css = leer("src/app/leads/leads.css");
const tsx = leer("src/app/leads/Leads.tsx");
const almacenTs = leer("src/lib/leads/almacen.ts");

describe("colorDeVendedor (franja del vendedor, migración 345)", () => {
  const mapa = new Map([["ana", 1], ["beto", 2], ["trece", 13], ["veinticinco", 25], ["doce", 12]]);

  it("son 12 colores", () => {
    expect(COLORES_DE_VENDEDOR).toBe(12);
  });

  it("sin mapa, sin id o sin puesto no hay color (null)", () => {
    expect(colorDeVendedor(null, "ana")).toBeNull();
    expect(colorDeVendedor(undefined, "ana")).toBeNull();
    expect(colorDeVendedor(mapa, null)).toBeNull();
    expect(colorDeVendedor(mapa, undefined)).toBeNull();
    expect(colorDeVendedor(mapa, "")).toBeNull();
    expect(colorDeVendedor(mapa, "nadie")).toBeNull();
    expect(colorDeVendedor(new Map(), "ana")).toBeNull();
  });

  it("el puesto 1 es el color 1, y el 12 es el 12", () => {
    expect(colorDeVendedor(mapa, "ana")).toBe(1);
    expect(colorDeVendedor(mapa, "beto")).toBe(2);
    expect(colorDeVendedor(mapa, "doce")).toBe(12);
  });

  it("la 13.ª persona reusa el color 1, y la 25.ª también", () => {
    expect(colorDeVendedor(mapa, "trece")).toBe(1);
    expect(colorDeVendedor(mapa, "veinticinco")).toBe(1);
  });
});

describe("leads.css: la paleta y la franja", () => {
  it("los 24 tokens --vendedor-N y --vendedor-N-tinta (N = 1…12) con su color hex", () => {
    for (let n = 1; n <= 12; n++) {
      expect(css).toMatch(new RegExp(`--vendedor-${n}:\\s*#[0-9a-fA-F]{6};`));
      expect(css).toMatch(new RegExp(`--vendedor-${n}-tinta:\\s*#[0-9a-fA-F]{6};`));
    }
  });

  it("el tema oscuro redefine --vendedor-1 (negro sobre fondo oscuro no se vería)", () => {
    expect(css).toMatch(/:root\[data-theme="dark"\] \.leads-app\s*\{[^}]*--vendedor-1:\s*#e5e7eb;[^}]*--vendedor-1-tinta:\s*#111827;/);
  });

  it("12 reglas de atributo pintan la franja con su color y su tinta", () => {
    for (let n = 1; n <= 12; n++) {
      expect(css).toMatch(new RegExp(
        `\\.leads-app \\.ld-franja\\[data-color-vendedor="${n}"\\]\\s*\\{\\s*background:\\s*var\\(--vendedor-${n}\\);\\s*color:\\s*var\\(--vendedor-${n}-tinta\\);\\s*\\}`,
      ));
    }
  });

  it("la franja neutra (sin puesto) tiene su propio fondo y tinta", () => {
    expect(css).toMatch(/\.leads-app \.ld-franja \{[^}]*background:\s*var\(--accent\);\s*color:\s*var\(--card\);/);
  });
});

describe("Leads.tsx: la franja solo en las tarjetas ya trabajadas", () => {
  it("la franja (data-franja-vendedor) se pinta solo cuando el lead tiene quién lo trabajó y cuándo", () => {
    expect(tsx).toContain("const trabajado = !!l.last_by && !!l.last_at;");
    expect(tsx).toMatch(/\{trabajado && \(\s*<div className="ld-franja" data-franja-vendedor data-color-vendedor=\{colorVendedor \?\? ""\}>/);
    expect(tsx).toContain('<b data-ultimo-contacto>👤 {l.last_by_name ?? "—"}</b>');
    expect(tsx).toContain("<span data-pildora-etapa-texto={etapa}>{etapaIcono(etapa)} {etapaLabel(etapa, lang)}</span>");
  });

  it("sin trabajar, la cabecera de siempre: la píldora de etapa y, si la hay, el último contacto", () => {
    expect(tsx).toMatch(/\{!trabajado && \(\s*<div className="ld-cabeza-der">\s*<PildoraEtapa e=\{etapa\} \/>/);
  });

  it("cada tarjeta recibe el color de quien hizo el último contacto", () => {
    expect(tsx).toContain("colorVendedor={colorDeVendedor(puestos, l.last_by)}");
  });
});

describe("almacen.ts: puestosDeVendedores", () => {
  it("llama a la función de la 345 por su nombre", () => {
    expect(almacenTs).toContain('supabase.rpc("leads_colores_de_vendedores")');
  });

  it("ante un error (la 345 no aplicada, por ejemplo) devuelve un mapa vacío y no lanza", async () => {
    const falso = {
      rpc: async () => ({ data: null, error: { code: "42883", message: "function does not exist" } }),
    } as unknown as SupabaseClient;
    const puestos = await almacenDeLaBase(falso).puestosDeVendedores();
    expect(puestos).toBeInstanceOf(Map);
    expect(puestos.size).toBe(0);
  });

  it("si la llamada lanza, también devuelve un mapa vacío", async () => {
    const roto = { rpc: async () => { throw new Error("red caída"); } } as unknown as SupabaseClient;
    const puestos = await almacenDeLaBase(roto).puestosDeVendedores();
    expect(puestos.size).toBe(0);
  });

  it("con datos, convierte cada fila en profile_id → puesto", async () => {
    const bien = {
      rpc: async () => ({ data: [{ profile_id: "ana", puesto: 1 }, { profile_id: "beto", puesto: "2" }], error: null }),
    } as unknown as SupabaseClient;
    const puestos = await almacenDeLaBase(bien).puestosDeVendedores();
    expect(puestos.get("ana")).toBe(1);
    expect(puestos.get("beto")).toBe(2);
  });
});
