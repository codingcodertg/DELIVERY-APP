import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { asuntoDelCorreoDeSolicitud, textoDelAviso, tituloDeLaSolicitud, AVISO_CLIENTE_NUEVA, enlaceDelAviso } from "./avisos-de-solicitud";
import { destinoDelAviso } from "@/lib/destino-del-aviso";

const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

describe("una solicitud de cliente nuevo no llega como solicitud de ayuda", () => {
  it("el título es «New customer request» / «Solicitud de cliente nuevo»", () => {
    expect(tituloDeLaSolicitud("alta", "en")).toBe("New customer request");
    expect(tituloDeLaSolicitud("alta", "es")).toBe("Solicitud de cliente nuevo");
    const t = textoDelAviso(AVISO_CLIENTE_NUEVA, { cuenta: "IDEA", clase: "alta", tiendas: "PHR", quien: "Everto" });
    expect(t.en).toContain("New customer request");
    expect(t.es).toContain("Solicitud de cliente nuevo");
    expect(`${t.en} ${t.es}`).not.toMatch(/help|ayuda/i);
  });
  it("el asunto del correo no dice Help request", () => {
    const a = asuntoDelCorreoDeSolicitud("alta", { cuenta: "IDEA", quien: "Everto", rol: "Sales rep" });
    expect(a).toBe("New customer request: IDEA from Everto (Sales rep)");
    expect(a).not.toMatch(/help/i);
    expect(asuntoDelCorreoDeSolicitud("edicion", { cuenta: "IDEA" })).toBe("Customer edit request: IDEA from ?");
  });
  it("al pulsar el aviso se abre la solicitud en el panel de Clientes, no en Ayuda", () => {
    const link = enlaceDelAviso(AVISO_CLIENTE_NUEVA, { id: 7 });
    expect(link).toBe("/customers?solicitud=7");
    expect(destinoDelAviso({ kind: AVISO_CLIENTE_NUEVA, delivery_id: null, link })).toBe("/customers?solicitud=7");
  });
  it("la ficha ya no manda el alta ni la edición por /api/help", () => {
    const ficha = leer("src/app/customers/FichaDeCliente.tsx");
    expect(ficha).not.toContain("enviaSolicitudDeAyuda");
    expect(ficha.match(/avisaAlAdminDeLaSolicitud\(r\.valor\.id\)/g)?.length).toBe(2);
  });
  it("la ruta del correo no escribe en help_requests ni se titula Help request", () => {
    const ruta = leer("src/app/api/customers/aviso-solicitud/route.ts").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(ruta).not.toMatch(/from\("help_requests"\)/);
    expect(ruta).not.toMatch(/Help request/);
    expect(ruta).toContain("asuntoDelCorreoDeSolicitud");
    expect(ruta).toContain("s.requested_by !== auth.user.id");
  });
  it("la ayuda de verdad sigue igual", () => {
    expect(leer("src/app/api/help/route.ts")).toContain("const subject = `Help request from ${who}${roleLabel}`;");
  });
  it("la 250 cambia solo el texto en español del alta y lleva su registro", () => {
    const sql = leer("supabase/migrations/250_aviso_solicitud_de_cliente_nuevo.sql");
    expect(sql).toContain("'📝 Solicitud de cliente nuevo: '");
    expect(sql).toContain("'📝 New customer request: '");
    expect(sql).toContain("'📝 Nueva solicitud de edición: '");
    expect(sql).not.toContain("'📝 Nueva solicitud de cliente: ' end");
    expect(sql).not.toMatch(/D-\d{3}|D-NEXT/);
    expect(sql).toContain("-- @ledger-below");
    expect(sql).toMatch(/values \('250_aviso_solicitud_de_cliente_nuevo\.sql', '[0-9a-f]{64}'\)/);
  });
});
