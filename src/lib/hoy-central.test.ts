import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fechaCentral, hoyCentral, sumaDias } from "./hoy-central";

const RAIZ = join(__dirname, "..", "..");
const leer = (f: string) => readFileSync(join(RAIZ, f), "utf8");

describe("hoyCentral: el día de hoy es el de Texas, no el de UTC (auditoría 27 nov)", () => {
  it("a las 23:30 de Chicago en horario de invierno (CST, UTC-6) da el día de Chicago, aunque UTC ya sea el día siguiente", () => {
    const instante = new Date("2026-11-28T05:30:00Z"); // 27 nov, 23:30 CST
    expect(instante.toISOString().slice(0, 10)).toBe("2026-11-28"); // lo que daba el código viejo
    expect(hoyCentral(instante)).toBe("2026-11-27");
  });

  it("a las 23:30 de Chicago en horario de verano (CDT, UTC-5) da el día de Chicago", () => {
    const instante = new Date("2026-07-16T04:30:00Z"); // 15 jul, 23:30 CDT
    expect(instante.toISOString().slice(0, 10)).toBe("2026-07-16");
    expect(hoyCentral(instante)).toBe("2026-07-15");
  });

  it("a las 19:00 de Chicago (la hora que rompía el código viejo) sigue siendo el mismo día", () => {
    expect(hoyCentral(new Date("2026-11-28T01:00:00Z"))).toBe("2026-11-27"); // 19:00 CST
  });

  it("cruza la medianoche de Chicago justo a las 00:00 (CST y CDT)", () => {
    expect(hoyCentral(new Date("2026-11-28T05:59:59Z"))).toBe("2026-11-27"); // 23:59:59 CST
    expect(hoyCentral(new Date("2026-11-28T06:00:00Z"))).toBe("2026-11-28"); // 00:00 CST
    expect(hoyCentral(new Date("2026-07-15T04:59:59Z"))).toBe("2026-07-14"); // 23:59:59 CDT
    expect(hoyCentral(new Date("2026-07-15T05:00:00Z"))).toBe("2026-07-15"); // 00:00 CDT
  });

  it("el cambio de horario de marzo (2026-03-08) no mueve el día", () => {
    expect(hoyCentral(new Date("2026-03-08T07:59:00Z"))).toBe("2026-03-08"); // 01:59 CST
    expect(hoyCentral(new Date("2026-03-08T08:30:00Z"))).toBe("2026-03-08"); // 03:30 CDT
  });

  it("sin argumento usa el instante actual y devuelve AAAA-MM-DD", () => {
    expect(hoyCentral()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("fechaCentral de una fecha inválida devuelve cadena vacía", () => {
    expect(fechaCentral(new Date("no es fecha"))).toBe("");
  });
});

describe("sumaDias: aritmética de calendario sobre AAAA-MM-DD", () => {
  it("cruza fin de mes, de año y años bisiestos", () => {
    expect(sumaDias("2026-11-27", 3)).toBe("2026-11-30");
    expect(sumaDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(sumaDias("2028-02-28", 1)).toBe("2028-02-29");
    expect(sumaDias("2027-03-01", -1)).toBe("2027-02-28");
  });

  it("con cero días devuelve la misma fecha, y con negativos retrocede", () => {
    expect(sumaDias("2026-11-27", 0)).toBe("2026-11-27");
    expect(sumaDias("2026-11-27", -29)).toBe("2026-10-29");
  });
});

describe("puerta: los sitios de «hoy» ya no usan toISOString().slice(0, 10) (auditoría 27 nov)", () => {
  // Estos archivos muestran «hoy» al usuario. Si alguien vuelve a poner la fecha en UTC, la prueba falla.
  const SITIOS_DE_HOY = [
    "src/app/operaciones/conteos/hoja/page.tsx",
    "src/app/security/PanelDeSeguridad.tsx",
    "src/app/(app)/dashboard/page.tsx",
    "src/app/(app)/market/page.tsx",
    "src/app/estimator/VisualizadorDeRegadera.tsx",
    "src/components/timetracker/MySections.tsx",
    "src/app/timetracker/clock-in/actions/demo-local.ts",
    "src/lib/export.ts",
    "src/lib/erp/listas-de-conteo-demo.ts",
  ];

  it.each(SITIOS_DE_HOY)("%s no fija el día en UTC", (f) => {
    const src = leer(f);
    expect(src).not.toMatch(/toISOString\(\)\s*\.\s*(?:slice\(\s*0\s*,\s*10\s*\)|split\(\s*"T"\s*\)\s*\[0\])/);
    expect(src).toMatch(/hoyCentral\(/);
  });

  it("los tres citos de la auditoría usan hoyCentral() del módulo compartido", () => {
    for (const f of [
      "src/app/operaciones/conteos/hoja/page.tsx",
      "src/app/security/PanelDeSeguridad.tsx",
      "src/app/(app)/dashboard/page.tsx",
    ]) {
      expect(leer(f), f).toMatch(/from "@\/lib\/hoy-central"/);
    }
  });
});
