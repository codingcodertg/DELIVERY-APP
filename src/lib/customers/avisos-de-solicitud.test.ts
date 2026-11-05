import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AVISO_CLIENTE_APROBADA, AVISO_CLIENTE_NUEVA, AVISO_CLIENTE_RECHAZADA, AVISO_CLIENTE_REVISAR, AVISOS_DE_CLIENTE,
  enlaceDelAviso, enlaceSeguro, esAvisoDeCliente, mensajeDelAviso, solicitudDelEnlace, textoDelAviso,
} from "./avisos-de-solicitud";
import { destinoDelAviso } from "@/lib/destino-del-aviso";

const SQL = readFileSync(join(process.cwd(), "supabase/migrations/243_avisos_de_solicitudes_de_cliente.sql"), "utf8");

describe("textos de los avisos de solicitud de cliente (D-NEXT)", () => {
  it("nueva: cuenta, tiendas y quien pidió, en los dos idiomas", () => {
    expect(textoDelAviso(AVISO_CLIENTE_NUEVA, { cuenta: "IDEA", clase: "alta", tiendas: "PHR", quien: "Everto" }))
      .toEqual({ en: "📝 New customer request: IDEA (PHR) from Everto", es: "📝 Nueva solicitud de cliente: IDEA (PHR) de Everto" });
    expect(textoDelAviso(AVISO_CLIENTE_NUEVA, { cuenta: "IDEA", clase: "edicion", quien: "Everto" }).en).toBe("📝 New edit request: IDEA from Everto");
  });
  it("aprobada: alta y edición", () => {
    expect(textoDelAviso(AVISO_CLIENTE_APROBADA, { cuenta: "IDEA", clase: "alta" })).toEqual({ en: "✅ Customer IDEA approved", es: "✅ Cliente IDEA aprobado" });
    expect(textoDelAviso(AVISO_CLIENTE_APROBADA, { cuenta: "IDEA", clase: "edicion" }).es).toBe("✅ Edición de IDEA aprobada");
  });
  it("rechazada y por revisar llevan la nota, y sin nota no dejan «: »", () => {
    expect(textoDelAviso(AVISO_CLIENTE_RECHAZADA, { cuenta: "IDEA", clase: "alta", nota: " duplicado " }).en).toBe("❌ Request for IDEA rejected: duplicado");
    expect(textoDelAviso(AVISO_CLIENTE_RECHAZADA, { cuenta: "IDEA", clase: "alta", nota: "  " }).en).toBe("❌ Request for IDEA rejected");
    expect(textoDelAviso(AVISO_CLIENTE_REVISAR, { cuenta: "IDEA", clase: "alta", nota: "falta teléfono" }))
      .toEqual({ en: "⚠️ Request for IDEA needs a check: falta teléfono", es: "⚠️ Solicitud de IDEA por revisar: falta teléfono" });
  });
});

describe("enlaces y destino", () => {
  it("aprobada lleva a la ficha (la primera creada, o la editada); lo demás, a la solicitud", () => {
    expect(enlaceDelAviso(AVISO_CLIENTE_APROBADA, { id: 7, created_ids: [40, 41] })).toBe("/customers/40");
    expect(enlaceDelAviso(AVISO_CLIENTE_APROBADA, { id: 7, customer_id: 12 })).toBe("/customers/12");
    expect(enlaceDelAviso(AVISO_CLIENTE_APROBADA, { id: 7 })).toBe("/customers?solicitud=7");
    expect(enlaceDelAviso(AVISO_CLIENTE_RECHAZADA, { id: 7, customer_id: 12 })).toBe("/customers?solicitud=7");
  });
  it("solicitudDelEnlace solo acepta un entero positivo", () => {
    expect(solicitudDelEnlace("7")).toBe(7);
    expect(solicitudDelEnlace("x")).toBeNull();
    expect(solicitudDelEnlace("0")).toBeNull();
    expect(solicitudDelEnlace(null)).toBeNull();
  });
  it("solo rutas internas", () => {
    expect(enlaceSeguro("/customers/4")).toBe("/customers/4");
    expect(enlaceSeguro("//evil.com")).toBeNull();
    expect(enlaceSeguro("javascript:alert(1)")).toBeNull();
    expect(enlaceSeguro(undefined)).toBeNull();
  });
  it("destinoDelAviso: el link manda; sin link (sin la 243), lo de siempre", () => {
    expect(destinoDelAviso({ kind: AVISO_CLIENTE_APROBADA, delivery_id: null, link: "/customers/4" })).toBe("/customers/4");
    expect(destinoDelAviso({ kind: "approved", delivery_id: "d1" })).toBe("/?order=d1");
    expect(destinoDelAviso({ kind: "x", delivery_id: null })).toBeNull();
  });
  it("mensaje en español si lo hay; si no, el de siempre", () => {
    expect(mensajeDelAviso({ message: "en", message_es: "es" }, "es")).toBe("es");
    expect(mensajeDelAviso({ message: "en", message_es: "es" }, "en")).toBe("en");
    expect(mensajeDelAviso({ message: "en" }, "es")).toBe("en");
  });
  it("esAvisoDeCliente", () => {
    expect(AVISOS_DE_CLIENTE.every(esAvisoDeCliente)).toBe(true);
    expect(esAvisoDeCliente("approved")).toBe(false);
  });
});

describe("la 243 escribe lo mismo que esta librería", () => {
  it("cada kind y cada plantilla de texto están en el SQL", () => {
    for (const k of AVISOS_DE_CLIENTE) expect(SQL).toContain(`'${k}'`);
    for (const trozo of [
      "📝 New customer request: ", "📝 Nueva solicitud de cliente: ", "📝 New edit request: ", "📝 Nueva solicitud de edición: ", "' from '", "' de '",
      "'✅ Customer '", "' approved'", "'✅ Cliente '", "' aprobado'", "'✅ Edit to '", "'✅ Edición de '", "' aprobada'",
      "'❌ Request for '", "' rejected'", "'❌ Solicitud de '", "' rechazada'",
      "'⚠️ Request for '", "' needs a check'", "'⚠️ Solicitud de '", "' por revisar'",
      "'/customers?solicitud='", "'/customers/'",
    ]) expect(SQL).toContain(trozo);
  });
  it("no toca las funciones de decidir de la 242 y no lleva D-NEXT ni número de decisión", () => {
    expect(SQL).not.toMatch(/create or replace function erp\.(aprueba|rechaza|revisa)_/);
    expect(SQL).not.toMatch(/D-\d{3}|D-NEXT/);
    expect(SQL).toContain("customers_role = 'admin'");
  });
});
