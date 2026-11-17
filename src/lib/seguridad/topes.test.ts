import { describe, it, expect } from "vitest";
import {
  agrupaPorIp, cuotaDeLaHora, decideAviso, necesitaResumen, TOPE_CORREOS_HORA, TOPE_IDENTIFICADORES_POR_IP_HORA,
  TOPE_SMS_HORA, TOPE_SMS_POR_CORRIDA, type CuotaHora,
} from "./topes";
import type { Hallazgo } from "./detectores";

const vacia = (): CuotaHora => ({ correos: 0, sms: 0, resumen: false, omitidos: 0 });
const SI = { correo: true, telefonos: 2 };

describe("cuotaDeLaHora: cuenta lo que ya salió en la última hora", () => {
  it("suma correos, SMS, omitidas y marca el resumen", () => {
    const c = cuotaDeLaHora([
      { avisos: { correo: true, sms: 2 } },
      { avisos: { correo: true, sms: 0 } },
      { omitido: "correo" },
      { omitido: "sms" },
      { resumen_horario: true, omitidas: 9 },
      null,
      { bloqueo: { ip: "1.1.1.1" } },
    ]);
    expect(c).toEqual({ correos: 2, sms: 2, resumen: true, omitidos: 2 });
  });
});

describe("tope de correos: como mucho 5 alertas con correo por hora", () => {
  it("la quinta sale, la sexta se omite", () => {
    expect(decideAviso(4, { ...vacia(), correos: TOPE_CORREOS_HORA - 1 }, { correo: true, telefonos: 0 }, 0).correo).toBe(true);
    const sexta = decideAviso(4, { ...vacia(), correos: TOPE_CORREOS_HORA }, { correo: true, telefonos: 0 }, 0);
    expect(sexta).toMatchObject({ correo: false, omitido: "correo" });
  });
  it("una alerta de severidad 3 no avisa por correo nunca", () => {
    expect(decideAviso(3, vacia(), { correo: true, telefonos: 2 }, 2)).toEqual({ correo: false, sms: 0, omitido: null });
  });
});

describe("tope de SMS: 2 por corrida y 2 por hora", () => {
  it("por corrida: aunque la hora esté libre, no pasa de 2 mensajes en la corrida", () => {
    expect(TOPE_SMS_POR_CORRIDA).toBe(2);
    const d = decideAviso(5, vacia(), { correo: false, telefonos: 5 }, TOPE_SMS_POR_CORRIDA);
    expect(d.sms).toBe(2);
    expect(d.omitido).toBe("sms");
  });
  it("por hora: si ya salieron 2 en la hora, no sale ninguno más", () => {
    const d = decideAviso(5, { ...vacia(), sms: TOPE_SMS_HORA }, SI, 2);
    expect(d.sms).toBe(0);
    expect(d.omitido).toBe("sms");
  });
  it("el SMS solo es para severidad 5", () => {
    expect(decideAviso(4, vacia(), SI, 2).sms).toBe(0);
  });
  it("con un solo teléfono y cupo, manda uno y no marca omisión", () => {
    expect(decideAviso(5, vacia(), { correo: false, telefonos: 1 }, 2)).toEqual({ correo: false, sms: 1, omitido: null });
  });
});

describe("correo-resumen: una vez por hora, cuando hubo omitidas", () => {
  it("sale si hubo omitidas (en la hora o en esta corrida) y aún no salió", () => {
    expect(necesitaResumen(vacia(), 1)).toBe(true);
    expect(necesitaResumen({ ...vacia(), omitidos: 4 }, 0)).toBe(true);
  });
  it("no sale si no hubo omitidas", () => {
    expect(necesitaResumen(vacia(), 0)).toBe(false);
  });
  it("no sale otra vez si ya salió en esta hora", () => {
    expect(necesitaResumen({ ...vacia(), omitidos: 9, resumen: true }, 3)).toBe(false);
  });
});

function identificador(ip: string | null, n: number): Hallazgo[] {
  return Array.from({ length: n }, (_, i) => ({
    detector: "login-fallido-identificador", severidad: 4 as const, sujeto: `identificador:${ip}:${i}`,
    usuario_id: null, ip, resumen: "",
  }));
}

describe("tope de identificadores por IP: como mucho 3 alertas por IP y hora", () => {
  it("la cuarta cuenta de la misma IP se agrupa en vez de abrir otra alerta", () => {
    const { insertar, agrupados } = agrupaPorIp(identificador("1.1.1.1", 5), new Map());
    expect(insertar).toHaveLength(TOPE_IDENTIFICADORES_POR_IP_HORA);
    expect(agrupados.get("1.1.1.1")).toBe(2);
  });
  it("cuenta lo que la IP ya abrió antes en la hora", () => {
    const { insertar, agrupados } = agrupaPorIp(identificador("2.2.2.2", 2), new Map([["2.2.2.2", 2]]));
    expect(insertar).toHaveLength(1);
    expect(agrupados.get("2.2.2.2")).toBe(1);
  });
  it("otra IP no se ve afectada", () => {
    const mezcla = [...identificador("1.1.1.1", 5), ...identificador("3.3.3.3", 2)];
    const { insertar, agrupados } = agrupaPorIp(mezcla, new Map());
    expect(insertar.filter((h) => h.ip === "3.3.3.3")).toHaveLength(2);
    expect(agrupados.has("3.3.3.3")).toBe(false);
  });
  it("los hallazgos que no son de identificador pasan tal cual", () => {
    const otro: Hallazgo = { detector: "ratelimit-ip", severidad: 3, sujeto: "ratelimit:1.1.1.1", usuario_id: null, ip: "1.1.1.1", resumen: "" };
    const { insertar } = agrupaPorIp([otro], new Map([["1.1.1.1", 99]]));
    expect(insertar).toEqual([otro]);
  });
});
