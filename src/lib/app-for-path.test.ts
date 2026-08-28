import { describe, it, expect } from "vitest";
import { appForPath } from "@/lib/app-for-path";
import { APP_VERSIONS } from "@/lib/app-versions";

// El sello enseña la version del modulo en el que estas (D-087: cada app lleva su propio
// contador). Equivocar el prefijo significa enseñar el numero de otra app, que es peor que
// no enseñar ninguno: alguien reporta un fallo citando una version que no es la suya.
describe("appForPath", () => {
  it("reconoce cada modulo por su prefijo", () => {
    expect(appForPath("/recruiting")).toBe("recruiting");
    expect(appForPath("/recruiting/candidates/7")).toBe("recruiting");
    expect(appForPath("/timetracker")).toBe("timetracker");
    expect(appForPath("/timetracker/reports")).toBe("timetracker");
    expect(appForPath("/timetracker/clock-in/clock")).toBe("clockin");
    // Fichaje vive DENTRO de time tracker: gana el prefijo mas especifico.
    expect(appForPath("/timetracker/clock-in/dashboard")).toBe("clockin");
    expect(appForPath("/clock-in/clock")).toBe("clockin");   // ruta vieja, aun redirigiendo
    expect(appForPath("/erp/catalog")).toBe("erp");
  });

  it("el hub, el login y las pantallas de deliveries son deliveries", () => {
    expect(appForPath("/")).toBe("deliveries");
    expect(appForPath("/home")).toBe("deliveries");
    expect(appForPath("/home/users")).toBe("deliveries");
    expect(appForPath("/login")).toBe("deliveries");
    expect(appForPath("/driver")).toBe("deliveries");
    expect(appForPath("/warehouse")).toBe("deliveries");
    expect(appForPath(null)).toBe("deliveries");
  });

  it("no confunde una ruta que solo EMPIECE parecido", () => {
    // /erp-algo no es el ERP; sin el separador, startsWith se lo tragaria.
    expect(appForPath("/erpxyz")).toBe("deliveries");
    expect(appForPath("/timetracker-legacy")).toBe("deliveries");
    expect(appForPath("/clock-in-old")).toBe("deliveries");
    // Esta es la que muerde ahora que fichaje vive dentro: /timetracker/clock-in-old NO
    // es fichaje, pero sí es time tracker — el separador decide una cosa y el orden otra.
    expect(appForPath("/timetracker/clock-in-old")).toBe("timetracker");
  });

  it("todo prefijo conocido tiene numero que enseñar", () => {
    for (const p of ["/", "/recruiting", "/timetracker", "/timetracker/clock-in", "/erp"]) {
      expect(APP_VERSIONS[appForPath(p)]).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});
