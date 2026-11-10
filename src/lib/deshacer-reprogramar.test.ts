import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fotoAntesDeReprogramar, MS_AVISO_CON_DESHACER, notaDeDeshacer, planDeDeshacer } from "./deshacer-reprogramar";

const leer = (p: string) => readFileSync(p, "utf8").split("\r\n").join("\n");
const orden = { id: "o1", delivery_date: "2026-11-05T00:00:00", stage: "ready" as const, assigned_driver: "Luis", route_seq: 3, pickup_seq: 1 };

describe("«Deshacer» en el aviso de reprogramar (D-861)", () => {
  it("la foto guarda la fecha (solo el día) y lo que la 172 puede quitar", () => {
    expect(fotoAntesDeReprogramar(orden)).toEqual({ id: "o1", delivery_date: "2026-11-05", stage: "ready", assigned_driver: "Luis", route_seq: 3, pickup_seq: 1 });
    expect(fotoAntesDeReprogramar({ ...orden, delivery_date: null, assigned_driver: null, route_seq: null, pickup_seq: undefined }))
      .toMatchObject({ delivery_date: null, assigned_driver: null, route_seq: null, pickup_seq: null });
  });

  it("vuelve a la fecha de antes con una nota que dice que es un deshacer (3 letras o más, como pide la base)", () => {
    const p = planDeDeshacer(fotoAntesDeReprogramar(orden), { assigned_driver: "Luis" }, "logistics", "es");
    expect(p.fecha).toBe("2026-11-05");
    expect(p.nota).toBe(notaDeDeshacer("es"));
    expect(notaDeDeshacer("en").length).toBeGreaterThanOrEqual(3);
    expect(p.parcheDeRuta).toBeNull();
  });

  it("si la 172 la sacó de la ruta, quien asigna la devuelve con su chofer y su posición", () => {
    const foto = fotoAntesDeReprogramar(orden);
    for (const rol of ["admin", "logistics", "manager"]) {
      expect(planDeDeshacer(foto, { assigned_driver: null }, rol, "en").parcheDeRuta).toEqual({ assigned_driver: "Luis", route_seq: 3, pickup_seq: 1 });
    }
    // Ventas, almacén y oficina no asignan: solo vuelve la fecha.
    for (const rol of ["sales", "warehouse", "accounting", null]) expect(planDeDeshacer(foto, { assigned_driver: null }, rol, "en").parcheDeRuta).toBeNull();
    // Otro chofer puesto mientras tanto: no se pisa.
    expect(planDeDeshacer(foto, { assigned_driver: "Ana" }, "admin", "en").parcheDeRuta).toBeNull();
    // Sin chofer antes: nada que devolver.
    expect(planDeDeshacer({ ...foto, assigned_driver: null }, { assigned_driver: null }, "admin", "en").parcheDeRuta).toBeNull();
  });

  it("el aviso dura lo bastante para cazar el error", () => {
    expect(MS_AVISO_CON_DESHACER).toBeGreaterThanOrEqual(8000);
  });

  it("el cuadro 📅 lo ofrece y deshace por la misma función, sin la pregunta de mismo día (D-848)", () => {
    const c = leer("src/components/ReprogramarOrden.tsx");
    expect(c).toContain("const foto = fotoAntesDeReprogramar(pedido);");
    expect(c).toContain("reprogramarOrden(foto.id, foto.delivery_date, notaDeDeshacer(lang), lang, undefined, { deshacer: foto })");
    const deshacer = c.slice(c.indexOf("const deshacer = async"), c.indexOf("notify(t(`Rescheduled to"));
    expect(deshacer).not.toContain("preguntaMismoDia");
    expect(c).toContain("`Deshecho: vuelve a ${foto.delivery_date}`");
  });

  it("los dos proveedores pintan el botón del aviso y lo quitan al tocarlo", () => {
    for (const p of ["src/lib/data-provider.tsx", "src/lib/local-data-provider.tsx"]) {
      const s = leer(p);
      expect(s).toContain("const a = accionDelAviso; setAccionDelAviso(null); a.alTocar();");
      expect(s).toContain("opciones?.ms ?? 2600");
    }
    expect(leer("src/app/globals.css")).toMatch(/@media \(max-width: 640px\) \{ \.toast-accion \{ min-height: 40px; \} \}/);
  });
});
