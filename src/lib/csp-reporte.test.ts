import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { mensajeDeViolacion, soloHost, soloRuta, violacionesDelCuerpo } from "./csp-reporte";

// D-1206: las violaciones del CSP (Report-Only) llegan a /api/csp-report y quedan en «Fallas de la app».

describe("reportes del CSP", () => {
  it("lee el formato viejo (csp-report)", () => {
    const v = violacionesDelCuerpo({ "csp-report": {
      "document-uri": "https://rtg-hub.vercel.app/routes?fecha=2026-11-27&id=abc", "violated-directive": "script-src-elem",
      "effective-directive": "script-src-elem", "blocked-uri": "https://evil.example.com/x.js?token=1",
    } });
    expect(v).toEqual([{ directiva: "script-src-elem", bloqueado: "evil.example.com", pagina: "/routes" }]);
    expect(mensajeDeViolacion(v[0])).toBe("CSP (solo reporte): script-src-elem bloquearía evil.example.com");
  });

  it("lee el formato de la Reporting API y descarta otros tipos", () => {
    const v = violacionesDelCuerpo([
      { type: "csp-violation", body: { documentURL: "https://rtg-hub.vercel.app/", effectiveDirective: "img-src", blockedURL: "https://i.ytimg.com/vi/1/0.jpg" } },
      { type: "deprecation", body: {} },
    ]);
    expect(v).toEqual([{ directiva: "img-src", bloqueado: "i.ytimg.com", pagina: "/" }]);
  });

  it("palabras clave y esquemas sin ruta; basura no truena", () => {
    expect(soloHost("inline")).toBe("inline");
    expect(soloHost("data:image/png;base64,AAAA")).toBe("data:");
    expect(soloHost("")).toBe("desconocido");
    expect(soloRuta("no es url")).toBe("/");
    expect(violacionesDelCuerpo(null)).toEqual([]);
    expect(violacionesDelCuerpo({ otra: 1 })).toEqual([]);
  });

  it("el CSP de reporte apunta a la ruta, y sigue en Report-Only", () => {
    const c = readFileSync("next.config.mjs", "utf8");
    expect(c).toContain('"report-uri /api/csp-report",');
    expect(c).toContain('{ key: "Content-Security-Policy-Report-Only", value: cspHub },');
  });

  it("la ruta responde siempre 204, sin sesión, y va por registrar_falla con origen cliente", () => {
    const r = readFileSync("src/app/api/csp-report/route.ts", "utf8");
    expect(r).toContain('p_origen: "cliente", p_app: "csp"');
    expect(r).not.toContain("auth.getUser");
    expect(r.match(/return NADA\(\)/g)!.length).toBeGreaterThanOrEqual(3);
  });
});
