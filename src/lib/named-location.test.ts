import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { registroDeLugar } from "./named-location";
import type { NamedLocation } from "./types";

const tienda = (extra: Record<string, unknown> = {}): NamedLocation =>
  ({ name: "Tienda A", address: "100 Calle Uno", ...extra }) as NamedLocation;

describe("editar un lugar no borra lo que el formulario no enseña", () => {
  it("una clave que el formulario no conoce sobrevive a editar el nombre", () => {
    const prev = tienda({ clave_futura: "no tocar" });
    const rec = registroDeLugar(prev, { ...prev, name: "Tienda A2" }, { autoApprove: true });
    expect((rec as unknown as Record<string, unknown>).clave_futura).toBe("no tocar");
  });

  it("el código de directorio sobrevive a editar la dirección", () => {
    const prev = tienda({ directory_code: "XYZ" });
    const rec = registroDeLugar(prev, { ...prev, address: "200 Calle Dos" }, { autoApprove: true });
    expect((rec as unknown as Record<string, unknown>).directory_code).toBe("XYZ");
  });
});

describe("lo que el formulario sí enseña se guarda como antes", () => {
  it("el nombre y la dirección se recortan", () => {
    const rec = registroDeLugar(undefined, { name: "  Nueva  ", address: "  1 Calle  " }, {});
    expect(rec).toEqual({ name: "Nueva", address: "1 Calle" });
  });

  it("la aprobación automática se conserva al editar el nombre de una tienda", () => {
    const prev = tienda({ auto_approve: true });
    expect(registroDeLugar(prev, { ...prev, name: "Otra" }, { autoApprove: true }).auto_approve).toBe(true);
  });

  it("el pin verificado se conserva si la dirección no cambia", () => {
    const prev = tienda({ lat: 26.1, lng: -97.5 });
    const rec = registroDeLugar(prev, { ...prev, name: "Otra" }, {});
    expect([rec.lat, rec.lng]).toEqual([26.1, -97.5]);
  });

  it("y se BORRA si la dirección cambia: el de antes ya apuntaría a otro sitio", () => {
    const prev = tienda({ lat: 26.1, lng: -97.5 });
    const rec = registroDeLugar(prev, { ...prev, address: "999 Otra Calle" }, {});
    expect("lat" in rec || "lng" in rec).toBe(false);
  });
});

describe("el código de directorio, en las tiendas", () => {
  it("se guarda recortado", () => {
    const prev = tienda();
    const rec = registroDeLugar(prev, { ...prev, directory_code: "  ABC " }, { directoryCode: true });
    expect(rec.directory_code).toBe("ABC");
  });

  it("vaciarlo quita la clave, no guarda una cadena vacía", () => {
    const prev = tienda({ directory_code: "ABC" });
    const rec = registroDeLugar(prev, { ...prev, directory_code: "   " }, { directoryCode: true });
    expect("directory_code" in rec).toBe(false);
  });

  it("en una lista que no lo enseña, ni se toca: se conserva tal cual", () => {
    const prev = tienda({ directory_code: "ABC" });
    const rec = registroDeLugar(prev, { ...prev, directory_code: "" }, { directoryCode: false });
    expect(rec.directory_code).toBe("ABC");
  });
});

describe("la extensión de directorio, en las tiendas (D-273)", () => {
  it("se guarda recortada", () => {
    const prev = tienda();
    const rec = registroDeLugar(prev, { ...prev, directory_ext: " 900 " }, { directoryCode: true });
    expect(rec.directory_ext).toBe("900");
  });

  it("vaciarla quita la clave, no guarda una cadena vacía", () => {
    const prev = tienda({ directory_ext: "900" });
    const rec = registroDeLugar(prev, { ...prev, directory_ext: "   " }, { directoryCode: true });
    expect("directory_ext" in rec).toBe(false);
  });

  it("en una lista que no enseña los campos del directorio, se conserva tal cual", () => {
    const prev = tienda({ directory_ext: "900" });
    const rec = registroDeLugar(prev, { ...prev, directory_ext: "" }, { directoryCode: false });
    expect(rec.directory_ext).toBe("900");
  });

  it("editar el código no toca la extensión, ni al revés", () => {
    const prev = tienda({ directory_code: "ABC", directory_ext: "900" });
    const rec = registroDeLugar(prev, { ...prev, directory_code: "XYZ" }, { directoryCode: true });
    expect([rec.directory_code, rec.directory_ext]).toEqual(["XYZ", "900"]);
  });
});

describe("el grupo de promociones, en las tiendas (RTG PROMOS, migración 140)", () => {
  it("EDITAR OTRA COSA NO SE LO LLEVA — que es el camino por el que se perdería en silencio", () => {
    // No el de editar el grupo: ese se ve al instante. El que nadie mira es abrir una tienda que ya
    // tiene grupo, cambiarle la dirección, guardar, y descubrir semanas después que su gerente dejó
    // de poder aprobar. Es exactamente el fallo que D-261 vino a cerrar, con un campo más.
    const prev = tienda({ promo_group: "NORTE" });
    const rec = registroDeLugar(prev, { ...prev, address: "200 Calle Dos" }, { autoApprove: true, directoryCode: true });
    expect(rec.promo_group).toBe("NORTE");
  });

  it("se guarda recortado", () => {
    const prev = tienda();
    const rec = registroDeLugar(prev, { ...prev, promo_group: "  NORTE " }, { directoryCode: true });
    expect(rec.promo_group).toBe("NORTE");
  });

  it("vaciarlo quita la clave, no guarda una cadena vacía", () => {
    // `promo_group_of_user()` hace `nullif(trim(...), '')`, así que «» y ausente dan lo mismo en la
    // base. Se quita la clave igual que con los otros tres para que nadie tenga que saber eso.
    const prev = tienda({ promo_group: "NORTE" });
    const rec = registroDeLugar(prev, { ...prev, promo_group: "   " }, { directoryCode: true });
    expect("promo_group" in rec).toBe(false);
  });

  it("en una lista que no enseña los campos de tienda, se conserva tal cual", () => {
    // Los puntos de recolección y los sitios de entrega no son tiendas y no traen estos campos.
    const prev = tienda({ promo_group: "NORTE" });
    const rec = registroDeLugar(prev, { ...prev, promo_group: "" }, { directoryCode: false });
    expect(rec.promo_group).toBe("NORTE");
  });

  it("es el TERCER campo de agrupar, y tocar uno no toca los otros dos", () => {
    const prev = tienda({ directory_code: "ABC", group: "OESTE", promo_group: "NORTE" });
    const rec = registroDeLugar(prev, { ...prev, promo_group: "SUR" }, { directoryCode: true });
    expect([rec.directory_code, rec.group, rec.promo_group]).toEqual(["ABC", "OESTE", "SUR"]);
  });
});

describe("el editor de Datos usa esta función, y no una copia", () => {
  // Sin esto, la prueba de arriba protegería una función que la pantalla podría dejar de llamar.
  const leer = (r: string) => readFileSync(r, "utf8");
  const pagina = leer("src/app/(app)/data/page.tsx");

  it("importa `registroDeLugar` y la llama al confirmar", () => {
    expect(pagina).toContain('import { registroDeLugar } from "@/lib/named-location";');
    expect(pagina).toContain("const rec = registroDeLugar(prev, draft, { autoApprove, directoryCode });");
  });

  it("y el formulario de tiendas tiene el campo de la extensión", () => {
    expect(pagina).toContain("value={draft.directory_ext ?? \"\"}");
    expect(pagina).toContain("onChange={(e) => setDraft({ ...draft, directory_ext: e.target.value })}");
  });

  it("y el del grupo de promociones, que si no no habría dónde ponerlo", () => {
    // La prueba de arriba protege que `registroDeLugar` lo conserve; esta, que exista un sitio
    // donde escribirlo. Sin las dos, el campo sería un tipo que nadie rellena.
    expect(pagina).toContain("value={draft.promo_group ?? \"\"}");
    expect(pagina).toContain("onChange={(e) => setDraft({ ...draft, promo_group: e.target.value })}");
  });

  it("y ya no construye el registro de cero", () => {
    expect(pagina).not.toContain("const rec: NamedLocation = { name, address: draft.address.trim() };");
  });
});
