import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { iconoDeFotos, puedeVerFotos, tituloDeFotos } from "./fotos-en-la-etapa";
import { pastillaDeEtapa, RECIBIDO_COLOR } from "./recibir";
import { stageInfo } from "./constants";
import type { UserRole } from "./types";

/**
 * La cámara junto a «Entregado» (D-577). El dueño, 2026-10-18: *«For users who can see pictures that the drivers upload,
 * Id like the stage column to say Delivered and have a camera icon next to it to know when driver took pics. If no pics
 * were uploaded then itll just say Delivered with no icon»*.
 */

const leer = (ruta: string) => readFileSync(ruta, "utf8");
const plano = (s: string) => s.replace(/\s+/g, " ");

const ROLES: UserRole[] = ["admin", "manager", "sales", "warehouse", "driver", "logistics", "accounting"];
const admin = { role: "admin" as const };
const ventas = { role: "sales" as const };

describe("puedeVerFotos: la regla de la ficha, sacada a una función", () => {
  it("ventas no; todos los demás sí; sin sesión, no", () => {
    expect(ROLES.filter((role) => puedeVerFotos({ role }))).toEqual(["admin", "manager", "warehouse", "driver", "logistics", "accounting"]);
    expect(puedeVerFotos(ventas)).toBe(false);
    expect(puedeVerFotos(null)).toBe(false);
    expect(puedeVerFotos(undefined)).toBe(false);
  });

  it("la ficha la usa para la rejilla de fotos: una sola regla para la pastilla y para las fotos", () => {
    const ficha = plano(leer("src/components/OrderModal.tsx"));
    expect(ficha).toContain("{puedeVerFotos(me) && (canDeliver(me) || fotosQueCuentan.length > 0) && (");
    expect(ficha).not.toContain('me.role !== "sales" && (canDeliver(me)');
  });
});

describe("iconoDeFotos", () => {
  it("entregada, con fotos, y quien mira puede verlas → 📷", () => {
    expect(iconoDeFotos(admin, { stage: "delivered", photo_count: 2 })).toBe("📷");
    expect(iconoDeFotos({ role: "driver" }, { stage: "delivered", photo_count: 1 })).toBe("📷");
    // Cuando la fila trae las fotos, mandan ellas (`conteoDeFotos`).
    expect(iconoDeFotos(admin, { stage: "delivered", photos: ["a"], photo_count: 0 })).toBe("📷");
  });
  it("sin fotos → null (dice «Delivered» a secas)", () => {
    expect(iconoDeFotos(admin, { stage: "delivered", photo_count: 0 })).toBeNull();
    expect(iconoDeFotos(admin, { stage: "delivered" })).toBeNull();
    expect(iconoDeFotos(admin, { stage: "delivered", photos: [], photo_count: 3 })).toBeNull();
  });
  it("ventas → null aunque haya fotos: no se enseña un icono de algo que no puede abrir", () => {
    expect(iconoDeFotos(ventas, { stage: "delivered", photo_count: 5 })).toBeNull();
    expect(iconoDeFotos(null, { stage: "delivered", photo_count: 5 })).toBeNull();
  });
  it("no entregada → null, aunque tenga fotos y quien mira pueda verlas", () => {
    for (const stage of ["draft", "pending", "approved", "fulfilling", "ready", "picked_up", "rejected", "canceled"] as const) {
      expect(iconoDeFotos(admin, { stage, photo_count: 2 }), stage).toBeNull();
    }
  });
});

describe("tituloDeFotos, bilingüe y con el plural", () => {
  it("«Driver uploaded N photo(s)» / «El chofer subió N foto(s)»", () => {
    expect(tituloDeFotos(1, "en")).toBe("Driver uploaded 1 photo");
    expect(tituloDeFotos(3, "en")).toBe("Driver uploaded 3 photos");
    expect(tituloDeFotos(1, "es")).toBe("El chofer subió 1 foto");
    expect(tituloDeFotos(3, "es")).toBe("El chofer subió 3 fotos");
  });
});

describe("la pastilla de etapa lleva la cámara dentro", () => {
  it("«Delivered» + 📷 con su title, para quien puede verlas", () => {
    expect(pastillaDeEtapa({ id: "o1", stage: "delivered", photo_count: 2 }, new Set(), "en", admin))
      .toEqual({ texto: "Delivered", color: stageInfo("delivered").color, icono: "📷", titulo: "Driver uploaded 2 photos" });
    expect(pastillaDeEtapa({ id: "o1", stage: "delivered", photo_count: 1 }, new Set(), "es", admin))
      .toEqual({ texto: "Entregado", color: stageInfo("delivered").color, icono: "📷", titulo: "El chofer subió 1 foto" });
  });
  it("también en «Recibido» (D-409): es `delivered` en la base y las fotos siguen ahí", () => {
    expect(pastillaDeEtapa({ id: "o1", stage: "delivered", photo_count: 2 }, new Set(["o1"]), "en", admin))
      .toEqual({ texto: "Received", color: RECIBIDO_COLOR, icono: "📷", titulo: "Driver uploaded 2 photos" });
  });
  it("sin fotos, para ventas, o sin decir quién mira: «Delivered» a secas, sin icono ni title", () => {
    const sinIcono = { texto: "Delivered", color: stageInfo("delivered").color };
    const con = { id: "o1", stage: "delivered" as const, photo_count: 2 };
    expect(pastillaDeEtapa({ ...con, photo_count: 0 }, new Set(), "en", admin)).toStrictEqual(sinIcono);
    expect(pastillaDeEtapa(con, new Set(), "en", ventas)).toStrictEqual(sinIcono);
    expect(pastillaDeEtapa(con, new Set(), "en")).toStrictEqual(sinIcono);
    expect(pastillaDeEtapa(con, new Set(), "en", null)).toStrictEqual(sinIcono);
  });

  it("y se pinta DENTRO de la misma `.sema`, en todos los sitios que pintan la pastilla", () => {
    const icono = leer("src/components/IconoDeFotos.tsx");
    expect(icono).toContain("if (!p.icono) return null;");
    expect(icono).toContain('title={p.titulo} aria-label={p.titulo}>{p.icono}</span>');

    const tabla = plano(leer("src/components/OrdersTable.tsx"));
    expect(tabla).toContain("const p = pastillaDeEtapa(d, recibidas, lang, me);");
    expect(tabla).toContain('style={{ background: p.color, color: "#fff" }}>{p.texto}<IconoDeFotos p={p} /></span>');   // Órdenes
    expect(tabla).toContain("const s = pastillaDeEtapa(d, recibidas, lang, me);");
    expect((tabla.match(/\{s\.texto\}<IconoDeFotos p=\{s\} \/><\/span>/g) ?? []).length).toBe(2);                    // tarjeta del chofer y pila del teléfono
    expect(tabla).toContain("accion: accionDeFila, celdaDeEtapa, me, nombreDe };");

    const burbuja = plano(leer("src/components/EtapaEnLaFila.tsx"));                                                     // Almacén (D-573)
    expect(burbuja).toContain('<>{pastilla.texto}<IconoDeFotos p={pastilla} /></>');

    const almacen = plano(leer("src/app/(app)/warehouse/page.tsx"));                                                     // la ruta del día
    expect(almacen).toContain("const p = pastillaDeEtapa(d, recibidas, lang, me);");
    expect(almacen).toContain('{p.texto}<IconoDeFotos p={p} /></span>');

    const miRuta = plano(leer("src/app/(app)/my-route/page.tsx"));                                                       // la ruta del chofer
    expect(miRuta).toContain("const p = pastillaDeEtapa(d, recibidas, lang, me);");
    expect(miRuta).toContain('{p.texto}<IconoDeFotos p={p} /></span>');

    const ficha = plano(leer("src/components/OrderModal.tsx"));
    expect(ficha).toContain("pastillaDeEtapa({ id: existing.id, stage, photo_count: fotosQueCuentan.length }, idsRecibidasPorAlmacen(events), lang, me)");
    expect(ficha).toContain('{info.texto}<IconoDeFotos p={info} /></span>');
  });
});
