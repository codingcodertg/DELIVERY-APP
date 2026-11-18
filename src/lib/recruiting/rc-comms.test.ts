import { describe, expect, it } from "vitest";
import { diezDigitos, elegirAgenda, filaDeLlamada, filaDeTexto, indiceDeCandidatos, type RegistroDeLlamada, type RegistroDeTexto } from "./rc-comms";

const indice = indiceDeCandidatos([
  { id: "cand-ana", phone: "+1 (956) 555-0101", created_at: "2026-10-01T10:00:00Z" },
  { id: "cand-luis", phone: "956.555.0202", created_at: "2026-10-02T10:00:00Z" },
]);

describe("diezDigitos", () => {
  it("quita el formato y el 1 de EE. UU.", () => {
    expect(diezDigitos("+1 (956) 555-0101")).toBe("9565550101");
    expect(diezDigitos("19565550101")).toBe("9565550101");
    expect(diezDigitos("956.555.0101")).toBe("9565550101");
  });

  it("devuelve null para numeros cortos o vacios", () => {
    expect(diezDigitos("555-0101")).toBeNull();
    expect(diezDigitos("")).toBeNull();
    expect(diezDigitos(null)).toBeNull();
  });

  it("toma los ultimos 10 digitos si hay mas", () => {
    expect(diezDigitos("0019565550101")).toBe("9565550101");
  });
});

describe("indiceDeCandidatos", () => {
  it("mapea el telefono normalizado al candidato", () => {
    expect(indice.get("9565550101")).toBe("cand-ana");
    expect(indice.get("9565550202")).toBe("cand-luis");
  });

  it("con telefono repetido gana el creado mas recientemente, sin importar el orden", () => {
    const viejo = { id: "viejo", phone: "9565550303", created_at: "2026-01-01T00:00:00Z" };
    const nuevo = { id: "nuevo", phone: "(956) 555-0303", created_at: "2026-06-01T00:00:00Z" };
    expect(indiceDeCandidatos([nuevo, viejo]).get("9565550303")).toBe("nuevo");
    expect(indiceDeCandidatos([viejo, nuevo]).get("9565550303")).toBe("nuevo");
  });

  it("ignora candidatos sin telefono valido", () => {
    expect(indiceDeCandidatos([{ id: "x", phone: "12" }, { id: "y", phone: null }]).size).toBe(0);
  });
});

describe("filaDeLlamada", () => {
  const base: RegistroDeLlamada = {
    id: 9001,
    startTime: "2026-11-10T15:00:00.000Z",
    duration: 184.4,
    result: "Accepted",
    direction: "Inbound",
    from: { phoneNumber: "+19565550101" },
    to: { phoneNumber: "+19565559999" },
  };

  it("entrante: la otra parte es el from", () => {
    expect(filaDeLlamada(base, indice)).toMatchObject({
      rc_id: "9001",
      kind: "call",
      candidate_id: "cand-ana",
      direction: "in",
      duration_s: 184,
      result: "Accepted",
      recording_pending: false,
      recording_uri: null,
    });
  });

  it("saliente: la otra parte es el to", () => {
    const f = filaDeLlamada({ ...base, direction: "Outbound", from: { phoneNumber: "+19565559999" }, to: { phoneNumber: "+19565550202" } }, indice);
    expect(f).toMatchObject({ candidate_id: "cand-luis", direction: "out" });
  });

  it("numero que no es de ningun candidato -> null (llamada personal)", () => {
    expect(filaDeLlamada({ ...base, from: { phoneNumber: "+19565558888" } }, indice)).toBeNull();
  });

  it("con grabacion queda pendiente y guarda la URL", () => {
    const f = filaDeLlamada({ ...base, recording: { id: 7, contentUri: "https://platform.ringcentral.com/rec/7/content" } }, indice);
    expect(f).toMatchObject({ recording_pending: true, recording_uri: "https://platform.ringcentral.com/rec/7/content" });
  });

  it("direccion desconocida -> null", () => {
    expect(filaDeLlamada({ ...base, direction: "Other" }, indice)).toBeNull();
  });
});

describe("filaDeTexto", () => {
  const base: RegistroDeTexto = {
    id: "sms-1",
    creationTime: "2026-11-10T16:00:00.000Z",
    direction: "Outbound",
    subject: "Hola, le escribe Andres de RTG",
    messageStatus: "Sent",
    from: { phoneNumber: "+19565559999" },
    to: [{ phoneNumber: "+1 956-555-0202" }],
  };

  it("enviado: la otra parte es to[0]", () => {
    expect(filaDeTexto(base, indice)).toMatchObject({
      rc_id: "sms-1",
      kind: "sms",
      candidate_id: "cand-luis",
      direction: "out",
      body: base.subject,
      result: "Sent",
      recording_pending: false,
    });
  });

  it("recibido: la otra parte es from", () => {
    const f = filaDeTexto({ ...base, direction: "Inbound", from: { phoneNumber: "9565550101" }, to: [{ phoneNumber: "+19565559999" }] }, indice);
    expect(f).toMatchObject({ candidate_id: "cand-ana", direction: "in" });
  });

  it("numero sin candidato -> null", () => {
    expect(filaDeTexto({ ...base, to: [{ phoneNumber: "+19565557777" }] }, indice)).toBeNull();
  });
});

describe("elegirAgenda", () => {
  const agendas = [{ nombre: "Careers" }, { nombre: "Andrés" }];

  it("sin nombre, la primera", () => {
    expect(elegirAgenda(agendas)).toEqual({ nombre: "Careers" });
  });

  it("por nombre, sin distinguir mayusculas", () => {
    expect(elegirAgenda(agendas, "andrés")).toEqual({ nombre: "Andrés" });
  });

  it("nombre que no existe -> la primera; lista vacia -> null", () => {
    expect(elegirAgenda(agendas, "Nadie")).toEqual({ nombre: "Careers" });
    expect(elegirAgenda([])).toBeNull();
  });
});
