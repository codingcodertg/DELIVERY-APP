import { describe, expect, it } from "vitest";
import {
  claveDeTelefono, clavesDeLeads, filaDeLlamadaDeLead, telefonosDeLead, tocaBarrer, type RegistroDeLlamadaDeLead,
} from "./llamadas-rc";

const LEAD = {
  owner_phone: "(956) 555-0123",
  owner_phone_manual: null,
  tenant_phone: null,
  tenant_phone_manual: null,
};

describe("claveDeTelefono: los 10 dígitos con los que se empareja", () => {
  it("quita el formato, el 1 de EE. UU. y la extensión", () => {
    expect(claveDeTelefono("(956) 555-0123")).toBe("9565550123");
    expect(claveDeTelefono("956.555.0123")).toBe("9565550123");
    expect(claveDeTelefono("+1 956-555-0123")).toBe("9565550123");
    expect(claveDeTelefono("956-555-0123 ext. 4")).toBe("9565550123");
    expect(claveDeTelefono("956-555-0123 x 12345")).toBe("9565550123");
    expect(claveDeTelefono("956-555-0123 #7")).toBe("9565550123");
  });
  it("sin 10 dígitos no sirve para emparejar", () => {
    expect(claveDeTelefono("555-0123")).toBeNull();
    expect(claveDeTelefono("")).toBeNull();
    expect(claveDeTelefono(null)).toBeNull();
    expect(claveDeTelefono(undefined)).toBeNull();
  });
});

describe("telefonosDeLead: contratista y propietario, a mano y del Excel", () => {
  it("el de mano va antes que el del Excel, y cada lado dice cuál es", () => {
    const l = { ...LEAD, owner_phone_manual: "(956) 555-9999", tenant_phone: "956.555.7777" };
    expect(telefonosDeLead(l)).toEqual([
      { lado: "contratista", clave: "9565559999" },
      { lado: "contratista", clave: "9565550123" },
      { lado: "propietario", clave: "9565557777" },
    ]);
  });
  it("un mismo número repetido en el mismo lado cuenta una vez", () => {
    expect(telefonosDeLead({ ...LEAD, owner_phone_manual: "9565550123" })).toEqual([{ lado: "contratista", clave: "9565550123" }]);
  });
  it("un lead sin teléfonos no tiene claves", () => {
    expect(telefonosDeLead({ owner_phone: null, owner_phone_manual: null, tenant_phone: null, tenant_phone_manual: null })).toEqual([]);
  });
  it("el conjunto de claves junta todos los leads", () => {
    const claves = clavesDeLeads([LEAD, { ...LEAD, owner_phone: "(956) 555-1111" }]);
    expect([...claves].sort()).toEqual(["9565550123", "9565551111"]);
  });
});

const llamada = (o: Partial<RegistroDeLlamadaDeLead> & { direction: string }): RegistroDeLlamadaDeLead => ({
  id: 555,
  startTime: "2026-11-19T15:00:00.000Z",
  duration: 184.4,
  result: "Accepted",
  from: { phoneNumber: "+19565550123", name: "Ana Demo", extensionNumber: "101" },
  to: { phoneNumber: "+19565559999", name: "Oficina", extensionNumber: "200" },
  recording: { id: 9, contentUri: "https://platform.ringcentral.com/rec/9" },
  ...o,
});

describe("filaDeLlamadaDeLead: solo las llamadas de teléfonos de leads", () => {
  const claves = new Set(["9565550123"]);

  it("una saliente: la otra parte es «to»; el vendedor es «from»", () => {
    const f = filaDeLlamadaDeLead(llamada({ direction: "Outbound", from: { phoneNumber: "+19565559999", name: "Ana Demo", extensionNumber: "101" }, to: { phoneNumber: "+19565550123" } }), claves);
    expect(f).toEqual({
      rc_call_id: "555", direction: "out", started_at: "2026-11-19T15:00:00.000Z", duration_s: 184, result: "Accepted",
      phone_key: "9565550123", rep_extension: "101", rep_name: "Ana Demo",
      recording_uri: "https://platform.ringcentral.com/rec/9", recording_pending: true,
    });
  });

  it("una entrante: la otra parte es «from»; el vendedor es «to»", () => {
    const f = filaDeLlamadaDeLead(llamada({ direction: "Inbound", from: { phoneNumber: "+19565550123" }, to: { name: "Beto Demo", extensionNumber: "102" } }), claves);
    expect(f?.direction).toBe("in");
    expect(f?.phone_key).toBe("9565550123");
    expect(f?.rep_name).toBe("Beto Demo");
    expect(f?.rep_extension).toBe("102");
  });

  it("una llamada de un teléfono que no es de ningún lead NO se guarda", () => {
    expect(filaDeLlamadaDeLead(llamada({ direction: "Outbound", to: { phoneNumber: "+19565550000" } }), claves)).toBeNull();
  });

  it("sin dirección conocida no se guarda", () => {
    expect(filaDeLlamadaDeLead(llamada({ direction: "Internal", to: { phoneNumber: "+19565550123" } }), claves)).toBeNull();
  });

  it("sin grabación no queda pendiente; sin nombre ni extensión, el vendedor va en null", () => {
    const f = filaDeLlamadaDeLead(llamada({ direction: "Outbound", recording: null, from: {}, to: { phoneNumber: "+19565550123" } }), claves);
    expect(f?.recording_uri).toBeNull();
    expect(f?.recording_pending).toBe(false);
    expect(f?.rep_name).toBeNull();
    expect(f?.rep_extension).toBeNull();
    expect(f?.duration_s).toBe(184);
  });
});

describe("tocaBarrer: el barrido de las llamadas es cada 2 horas", () => {
  const ahora = new Date("2026-11-19T18:00:00.000Z");
  const hace = (min: number) => new Date(ahora.getTime() - min * 60 * 1000).toISOString();

  it("nunca corrió: sí", () => {
    expect(tocaBarrer(null, ahora)).toBe(true);
    expect(tocaBarrer("no es fecha", ahora)).toBe(true);
  });
  it("hace menos de casi 2 horas: no", () => {
    expect(tocaBarrer(hace(60), ahora)).toBe(false);
    expect(tocaBarrer(hace(110), ahora)).toBe(false);
  });
  it("hace casi 2 horas (con el margen del cron): sí", () => {
    expect(tocaBarrer(hace(115), ahora)).toBe(true);
    expect(tocaBarrer(hace(130), ahora)).toBe(true);
  });
});
